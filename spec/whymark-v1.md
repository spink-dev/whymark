# whymark v1 — a diff, marked with why

**File extension:** `.whymark` · **Media type:** `text/vnd.whymark` · **Encoding:** UTF-8, LF

whymark is a plain-text file format for reviewing code changes. The left side of a
whymark file is an ordinary unified diff. The right side is a set of structured
**annotations** addressed to specific line ranges of that diff: why the change
was made, what evidence backs it, how it was verified, and what is still
uncertain.

The name states the format's one rule. A diff already shows *what* changed, so a
mark that repeats it is worth nothing; every mark here exists to say why.

It exists because reading an AI-authored diff is cheap but *trusting* it is
expensive. A whymark file carries the reasoning and the receipts next to the code
they belong to, so a reviewer spends their time judging decisions instead of
reconstructing them.

Three properties drove the design:

1. **An agent can write it directly.** No column alignment, no escaping rules,
   no JSON string-quoted source code. Annotations are addressed by line number,
   not by position on a rendered page — a model cannot get the alignment wrong.
2. **A tool can generate the skeleton.** The diff half comes straight from
   `git diff`, so a whymark file can be produced for unstaged, staged, branch, or
   commit changes and then annotated.
3. **Claims are checkable.** Verification claims name the exact command they
   came from, and file sections carry git blob hashes, so a reader can re-run the
   claims and detect a review that has gone stale.

---

## 1. Document structure

```
┌─ YAML frontmatter ─────────── metadata, summary, global checks
├─ @note …                      document-level annotations (optional)
└─ @file …                      one section per changed file
   ├─ @@ … @@                   unified diff hunk
   │  + - and context lines
   └─ @note …                   annotations addressed to lines in this file
```

A minimal but complete document:

```whymark
---
whymark: 1
title: Cache the user lookup in the session middleware
author: claude-opus-5 (cursor)
date: 2026-09-15T12:04:00Z
scope: staged
base: main@47abc20
summary: |
  Session middleware hit the database on every request. This memoises the
  lookup for the lifetime of a request.
---

@file src/middleware/session.ts modified +6 -1 newsha=9f2a1c4
@@ -12,7 +12,12 @@ export async function loadSession(req: Request) {
   const token = req.headers.get("authorization");
   if (!token) return null;
-  return db.users.findByToken(token);
+  const cached = perRequestCache.get(req);
+  if (cached) return cached;
+  const user = await db.users.findByToken(token);
+  perRequestCache.set(req, user);
+  return user;
 }

@note +15..18 kind=intent risk=low confidence=0.9
why: `loadSession` is called by four separate handlers per request, so the
  same token was resolved up to four times against the database.
source: file:src/handlers/*.ts — four call sites confirmed by grep
source: file:src/lib/per-request-cache.ts:8 — existing WeakMap cache, reused
verify: cmd `npm test -- session` => pass (12 assertions)
verify: manual "4 handlers, 1 query" => pass (checked query log locally)
The cache is keyed on the `Request` object via `WeakMap`, so entries are
released with the request. It deliberately does **not** cache negative
lookups — see the note below.

@note +17 kind=assumption confidence=0.5
why: A `null` user is stored and returned as a cache hit. If a token is
  granted mid-request this returns stale `null`.
source: inference — no requirement found either way in the codebase.
verify: none
todo: confirm with the auth owner whether mid-request grants are possible.
```

### 1.1 Line kinds

Every line in a whymark document is exactly one of:

| Line | Meaning |
| --- | --- |
| `---` | Frontmatter fence (first line of file, and its closing fence) |
| `@file …` | Starts a file section |
| `@@ … @@` | Starts a diff hunk |
| ` `, `+`, `-`, `\` prefixed | Diff content, only inside a hunk |
| `@note …` | Starts an annotation |
| `@check …` | A document-level verification run |
| `key: value` | A field, only inside an annotation |
| `#` at column 0 | Comment, ignored (only outside hunks) |
| empty | Separator, or a context line inside a hunk (§3.3) |

Directives are recognised only at column 0, and diff content always carries a
one-character prefix, so a diff of a whymark file cannot be misparsed.

---

## 2. Frontmatter

Strict YAML between two `---` fences at the very start of the file.

| Key | Req | Type | Notes |
| --- | --- | --- | --- |
| `whymark` | ✔ | int | Format version. `1`. |
| `title` | ✔ | string | One line, imperative. What the change does. |
| `author` |  | string | Model and/or human. `claude-opus-5 (cursor)`. |
| `date` |  | ISO 8601 | When the review was written. |
| `scope` |  | enum | `unstaged` `staged` `worktree` `branch` `commit` `manual` |
| `base` |  | string | `<ref>@<sha>` the diff is against. |
| `head` |  | string | `<ref>@<sha>` or `working-tree`. |
| `repo` |  | string | Repository name or URL. |
| `summary` |  | markdown | The change in a paragraph. Written for a reviewer who has not seen the branch. |
| `tags` |  | string[] | Free-form, e.g. `[auth, perf]`. |
| `checks` |  | Check[] | Whole-change verification runs (§2.1). |
| `review` |  | Review | Human review state (§2.2). |
| `stats` |  | object | Optional cache of `files`/`added`/`removed`; recomputed by tools. |

Unknown keys are preserved and reported as warnings by `whymark validate`.

### 2.1 `checks`

Commands that were run against the whole change, as opposed to a claim about one
line range.

```yaml
checks:
  - cmd: npm run typecheck
    status: pass
  - cmd: npm test
    status: fail
    detail: "1 failing: rate-limit clears window on tick"
    ran: 2026-09-15T12:03:11Z
```

`status` is `pass` | `fail` | `unknown` | `skipped`. `whymark verify` re-runs every
`cmd` and rewrites `status`, `detail`, and `ran` with what actually happened.

### 2.2 `review`

```yaml
review:
  status: pending        # pending | approved | changes-requested
  by: alex
  at: 2026-09-15T13:00:00Z
```

---

## 3. File sections

```
@file <path> [status] [+A] [-R] [from=<old path>] [oldsha=<sha>] [newsha=<sha>] [lang=<id>] [binary]
```

`path` is repo-relative and may be quoted if it contains spaces. Everything
after it is order-independent. `status` is one of `added` `modified` `deleted`
`renamed` `context`; `context` marks a file included only for background, with
no changes of its own.

`newsha` is the git blob hash of the file's new content (`git hash-object`).
`whymark validate` compares it against the working tree and reports the review as
**stale** when they differ — the change moved on and the annotations may no
longer describe it. `oldsha` does the same for the base side.

`lang` overrides syntax-highlight detection, which otherwise comes from the
extension.

### 3.1 Hunks

Standard unified diff hunk headers:

```
@@ -<oldStart>,<oldLines> +<newStart>,<newLines> @@ [section heading]
```

The counts are used to bound the hunk body, but a parser MUST fall back to
reading until the next directive when they disagree with the content, emitting a
warning rather than failing. `@@` with no ranges is accepted for hand-written
files; line numbers then continue from the previous hunk, or start at 1.

### 3.2 Diff content lines

| Prefix | Meaning |
| --- | --- |
| `+` | Added — exists on the new side only |
| `-` | Removed — exists on the old side only |
| (space) | Context — exists on both sides |
| `\` | `\ No newline at end of file` |

### 3.3 Empty lines in a hunk

A context line for an empty source line should be a single space, but editors
and models strip trailing whitespace. An empty line inside a hunk is therefore
read as an empty context line, and trailing empty context lines are dropped when
the hunk closes. This makes a blank line before a `@note` safe to write.

---

## 4. Annotations

```
@note <selector> [key=value …]
<field>: <value>
  <continuation, indented>
<field>: <value>

<free-form markdown body>
```

An annotation ends at the next `@note`, `@file`, `@@`, `@check`, or end of file.

### 4.1 Selectors

A selector says which lines the annotation is about. Line numbers are the
**file's own** line numbers as shown in the diff — not offsets into the hunk.

| Selector | Means |
| --- | --- |
| `+42` | New-side line 42 |
| `+42..57` | New-side lines 42 through 57 |
| `-30` | Old-side line 30 (something that was removed) |
| `-30..35` | Old-side range |
| `file` | The file as a whole |
| `doc` | The whole change (only valid before the first `@file`) |

`+42..+57` is accepted as a synonym of `+42..57`. Ranges are inclusive. A
selector that names lines absent from the diff is a validation error — this is
the main defence against an annotation that has drifted off its code.

### 4.2 Header attributes

| Attribute | Values | Meaning |
| --- | --- | --- |
| `kind` | see §4.3 | What sort of annotation this is. Default `note`. |
| `risk` | `low` `medium` `high` | Blast radius if this is wrong. |
| `confidence` | `0`–`1` | How sure the author is. Be honest; low confidence is a feature. |
| `id` | slug | Stable anchor for deep links. Auto-assigned (`n1`, `n2`, …) if absent. |

### 4.3 Kinds

| `kind` | Use it for |
| --- | --- |
| `intent` | Why this code exists and what it is for. The default choice for a real explanation. |
| `source` | Where the approach came from, when provenance is the point. |
| `verify` | Evidence that it works. |
| `risk` | A known hazard. |
| `assumption` | Something taken on faith that a reviewer should confirm. |
| `alternative` | A different design considered and rejected, and why. |
| `todo` | Deliberately unfinished work. |
| `question` | A decision the author could not make alone. |
| `security` | An authz/authn/injection/secret-handling consequence. |
| `perf` | A complexity or allocation consequence. |
| `test` | What the test covers, and what it does not. |
| `generated` | Mechanically generated or vendored code that was not reasoned about. |
| `note` | Anything else. |

### 4.4 Fields

Repeatable fields (`source`, `verify`, `alt`, `todo`, `question`, `ref`) may
appear many times in one annotation. A value continues onto following lines
while they are indented by at least two spaces.

A field is `name:` followed by whitespace, or — for the field names in the table
below only — `name:` with no space at all, since `why:text` is a natural thing to
write. Restricting the tight form to known names keeps a body line that starts
with `https://…` from parsing as a field called `https`.

| Field | Repeat | Meaning |
| --- | --- | --- |
| `why` | – | Why the code is the way it is. The most important field. |
| `what` | – | What the code does, when it is genuinely non-obvious. Do not narrate. |
| `source` | ✔ | Evidence and provenance (§4.5). |
| `verify` | ✔ | Verification claim (§4.6). |
| `alt` | ✔ | `<rejected option> — <reason>` |
| `todo` | ✔ | Follow-up work. |
| `question` | ✔ | Question for the reviewer. |
| `ref` | ✔ | Related location, `file:path:line` or a URL. |
| `impact` | – | What else changes because of this. |

### 4.5 `source` — evidence

```
source: <type>:<locator> — <why it matters>
```

The em dash (or ` - `) and the trailing note are optional but strongly
encouraged: a bare link is not evidence, it is homework for the reviewer.

| Type | Locator | Example |
| --- | --- | --- |
| `file` | `path[:line[-line]]` | `file:src/config.ts:14 — WINDOW_MS already existed` |
| `url` | URL | `url:https://redis.io/commands/incr — INCR is atomic` |
| `doc` | path or name | `doc:docs/auth.md#tokens — token lifetime is 15m` |
| `spec` | name/section | `spec:rfc6585#4 — 429 semantics` |
| `commit` | sha | `commit:a1b2c3d — the bug this fixes was introduced here` |
| `pr` / `issue` | id or URL | `issue:#412 — reported by a customer` |
| `test` | path/name | `test:tests/limiter.test.ts:31 — pins the boundary` |
| `dep` | `name@version` | `dep:ioredis@5.4.1 — pipeline API used below` |
| `convention` | path | `convention:src/lib/*.ts — every module exports a factory` |
| `prompt` | quote | `prompt:"cap it at 100 requests a minute" — the number came from you` |
| `inference` | – | `inference — no source; pattern-matched from surrounding code` |

`inference` is the honest label for "the model made this up from context". It is
not a failure — most code is written that way — but it must be visible, and
tools surface it separately from sourced claims.

### 4.6 `verify` — evidence that it works

```
verify: <method> [`detail`] => <status> [(comment)]
```

| Method | Meaning |
| --- | --- |
| `cmd` | A command that was run. Put it in backticks so it can be re-run. |
| `test` | A specific test that covers this. |
| `type` | The type checker proves it. |
| `lint` | A lint rule enforces it. |
| `manual` | A human or agent checked it by hand; say exactly what was observed. |
| `review` | Read carefully, nothing executed. |
| `none` | Not verified. Say so rather than omitting the field. |

Status is `pass` | `fail` | `unknown` | `skipped`.

```
verify: cmd `npm test -- rate-limit` => pass (8 assertions)
verify: type => pass (no `any` in the public signature)
verify: manual "429 after the 101st request" => pass
verify: none => unknown (needs a load test)
```

`whymark verify` re-runs every `cmd` claim, compares the exit code to the claimed
status, and reports each claim as **confirmed**, **contradicted**, or
**unrunnable**. A claim of `pass` on a command that now exits non-zero is the
single highest-value signal in the format.

---

## 5. `@check`

A verification run that belongs to the change as a whole, written in the body
instead of frontmatter. Same grammar as a `verify` field:

```
@check cmd `npm run typecheck` => pass
@check cmd `npm run build` => fail (Type error in src/app/page.tsx:22)
```

Tools merge `@check` lines and frontmatter `checks` into one list.

---

## 6. Derived metrics

Tools compute these; they are never stored in the file.

- **Coverage** — the share of added lines (`+`) covered by at least one
  annotation. Uncovered added lines are code that arrived with no explanation.
- **Verified coverage** — the share of added lines covered by an annotation with
  at least one `verify` claim whose status is `pass`.
- **Sourced share** — annotations with at least one `source` that is not
  `inference`.
- **Open items** — `todo` and `question` fields, plus `fail`/`unknown` claims.
- **Risk profile** — the count of `high`/`medium` risk annotations, and whether
  each high-risk annotation carries a passing verification.

---

## 7. Error recovery

The format is written by language models, so a parser must lose nothing when a
document is slightly wrong. Required recoveries, each reported as a warning:

| Input | Behaviour |
| --- | --- |
| Hunk counts disagree with the body | Read until the next directive; keep the lines |
| Selector partly outside the diff | Keep the annotation, warn; error only if *no* named line exists |
| `risk: if the CDN rule is removed…` — prose where a fixed value belongs | Keep the text as a plain field. Never drop it |
| A field after the free-form body | Resume field parsing at any documented field name |
| Blank line inside a hunk | Empty context line; trailing ones dropped at the hunk's end |
| Unknown `kind`, `risk`, or field name | Keep the value, warn, treat kind as `note` |
| Duplicate annotation `id` | Rename the later one |
| No frontmatter, or no `whymark:`/`title:` | Report an error but still parse the body |

Dropping content silently is the one unacceptable outcome: a reviewer cannot
notice a sentence that was never displayed.

## 8. Conformance

A **parser** must accept every example in this document, address annotations by
line number, and perform every recovery in §7.

A **writer** must emit `whymark: 1` and `title`, must not emit an annotation whose
selector names lines absent from the diff, and should emit `newsha` for every
file it takes from git.

A **renderer** must show each annotation against the lines its selector names,
must distinguish the verification statuses from each other, and must show
`inference` sources as distinct from external evidence.

---

## 9. Design notes

**Why line numbers instead of inline annotation?** An inline format (a trailing
`|| comment` on each line) forces the writer to align columns and to fragment a
paragraph across lines. Line-addressed annotations let one coherent explanation
span a range, let several annotations cover the same line for different reasons,
and survive a re-generated diff.

**Why keep unified diff?** Every tool already speaks it, `git diff` produces it,
and a whymark file therefore degrades gracefully: strip the annotations and it is
still a patch a reviewer can read.

**Why is provenance a first-class field?** The reviewer's real question about
AI-written code is not "what does this do" but "where did this come from and did
anything check it". `source` and `verify` answer exactly those, and `inference`
makes the absence of an answer legible instead of silent.
