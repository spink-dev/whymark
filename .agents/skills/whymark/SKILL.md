---
name: whymark
description: Write a whymark (.whymark) review of code changes — a diff with line-addressed annotations giving why each change was made, what evidence backs it, and how it was verified. Use when asked to explain, document, justify, or hand off your own changes for review, or when asked for a code review, change walkthrough, or "what did you do and why".
---

# Writing a whymark review

A `.whymark` file is a diff with annotations addressed to individual lines. It
answers the three questions a reviewer actually has about code an agent wrote:

1. **Why is it like this?** — not what it does; the code already says that.
2. **Where did it come from?** — a file you read, a doc, the user's own words,
   or nothing at all (say so).
3. **What checked it?** — the exact command you ran and what it printed.

The format is specified in `spec/whymark-v1.md`. Read it if you need the full
grammar; the rules below are enough for normal use.

## Workflow

Always generate the skeleton from git rather than typing a diff by hand — the
diff bytes and line numbers must be exact, and a generated skeleton cannot be
wrong about them.

```bash
# pick the scope that matches what you are reviewing
npm run whymark -- new --staged    --author "<your model name>"   # git diff --cached
npm run whymark -- new --unstaged  --author "<your model name>"   # git diff
npm run whymark -- new --worktree  --author "<your model name>"   # git diff HEAD (+ untracked)
npm run whymark -- new --branch main --author "<your model name>" # whole branch
npm run whymark -- new --commit HEAD --author "<your model name>" # one commit
```

That writes `reviews/<slug>.whymark` containing the real diff plus one annotation
stub per hunk. Then:

1. Fill in `summary` in the frontmatter. Write it for someone who has not seen
   the branch, in a paragraph or two.
2. Replace every stub. Delete stubs that would say nothing, and add annotations
   the generator did not think to create.
3. Record the commands you actually ran under `checks:`.
4. Check your work:

```bash
npm run whymark -- validate reviews/<slug>.whymark   # structure, staleness, coverage
npm run whymark -- verify   reviews/<slug>.whymark --write   # re-runs every `verify: cmd`
npm run whymark -- stats    reviews/<slug>.whymark
```

`verify --write` re-runs each command you claimed and rewrites the file with the
real result. Run it. If a claim is contradicted, fix the code or the claim
before handing the review over.

Aim for **≥80% line coverage** and zero stubs. Then tell the user to open the
review at `/r/<slug>` (`npm run dev`).

## Annotating

```
@note <selector> [kind=…] [risk=…] [confidence=…]
why: …
source: …
verify: …
```

**Selectors** use the file's own line numbers as shown in the diff: `+42` for
new-side line 42, `+42..57` for a range, `-30` for a line you deleted, `file`
for the whole file, `doc` for the whole change. Never invent a line number —
`whymark validate` fails on a selector that does not appear in the diff.

Group lines by *reason*, not by hunk. One annotation should cover the lines that
exist for a single decision, even if that is 15 lines; two decisions in one hunk
means two annotations.

**`kind`** — `intent` (default choice), `source`, `verify`, `risk`,
`assumption`, `alternative`, `todo`, `question`, `security`, `perf`, `test`,
`generated`, `note`.

**`risk`** = blast radius if you are wrong (`low`/`medium`/`high`).
**`confidence`** = 0..1, honest. Low confidence with a `question:` is far more
useful to a reviewer than false certainty.

### `why`

The single most important field. It states the reason the code is the way it is,
and ideally the thing a reader could not have worked out alone.

- Good: `why: loadSession runs four times per request, so the same token was resolved four times against the database.`
- Good: `why: Constants rather than config because this service has no runtime config mechanism, and adding one would have dwarfed the fix.`
- Useless: `why: adds a cache to improve performance` — that is the diff, restated.
- Useless: `why: improves readability and maintainability`.

### `source` — provenance

```
source: <type>:<locator> — <why it matters>
```

Types: `file` `url` `doc` `spec` `commit` `pr` `issue` `test` `dep`
`convention` `prompt` `inference`.

- `source: file:src/config.ts:14 — WINDOW_MS already existed, reused it`
- `source: url:https://redis.io/commands/incr — INCR is atomic, so no lock`
- `source: prompt:"cap it at 100 a minute" — the number came from you`
- `source: convention:src/lib/*.ts — every module here exports a factory`
- `source: inference — no source; pattern-matched from the module next door`

**Never invent a source.** If you did not read it, do not cite it. When the code
came from your own judgement, write `inference` and say what you generalised
from. Tools count and display inference-only annotations separately: an honest
`inference` costs you nothing, a fabricated citation destroys the review's
value.

### `verify` — evidence

```
verify: <method> [`detail`] => <status> [(comment)]
```

Methods: `cmd` (put the exact command in backticks), `test`, `type`, `lint`,
`manual` (say what you observed), `review` (you only read it), `none`.
Status: `pass` `fail` `unknown` `skipped`.

- `verify: cmd \`npm test -- rate-limit\` => pass (11 tests)`
- `verify: type => pass`
- `verify: manual "429 after the 101st request" => pass`
- `verify: none => unknown (needs a load test)`

**Only claim `pass` for something you actually ran in this session.** `whymark
verify` re-runs every `cmd` claim, so a false claim is caught mechanically and
is worse than admitting `none`.

### Other fields

`alt: <rejected option> — <reason>` (repeatable) · `todo:` · `question:` ·
`ref:` · `impact:` · `what:` (only when the mechanics are genuinely obscure).

Anything after the fields, until the next `@note`, is free-form markdown for a
longer explanation.

## What to annotate

Cover every added line, but say something worth reading:

- Any non-obvious decision, and every trade-off you made.
- Anything you were unsure about — mark it `assumption` or `question` with low
  confidence. This is the highest-value annotation you can write.
- Security, auth, data-loss, and money-handling paths, always with `risk=`.
- Anything you copied or adapted, with a `source`.
- Mechanical or vendored blocks: one `kind=generated` annotation over the range
  rather than pretending you reasoned about each line.
- What you did **not** do: tests you skipped, cases you left unhandled.

The reviewer can act on your annotations: hovering a changed line offers to drop
it, and a reviewer working locally applies those decisions straight to their
working tree. Address a note to the tightest range that carries its point. A
debug line you should not have left in, or a status you widened on a hunch, is
worth its own single-line note — that is the line someone will reject, and a note
spanning twenty lines gives them nothing to act on.

## Anti-patterns

- Narrating the code (`what:` on every line) instead of explaining it.
- One giant `file`-level annotation instead of line-addressed ones. It games
  nothing — coverage only counts line ranges.
- Citing a plausible URL you did not open.
- Claiming `pass` on a command you did not run.
- Leaving the generated `TODO` text in place. `validate` reports those as stubs.
- Editing the diff body. The diff must stay byte-identical to git's output; if
  the code needs changing, change the code and regenerate.

## Writing one without git

If there is no repository (a review of a snippet, or a change you are proposing
rather than have made), write the file by hand: frontmatter, then `@file`, then
a `@@ -a,b +c,d @@` hunk with `+`/`-`/space-prefixed lines, then `@note`s. Line
numbers must be consistent with the hunk header. Save it under `reviews/` and
run `validate`.

## Minimal complete example

```whymark
---
whymark: 1
title: Reject expired invite tokens
author: <model> (<harness>)
date: 2026-09-15T12:04:00Z
scope: staged
base: main@8f1c2ab
summary: |
  Invite acceptance trusted any token that existed, so a six-month-old invite
  still worked. This adds an expiry check at the boundary.
checks:
  - cmd: npm test -- invites
    status: pass
---

@file src/invites/accept.ts modified +4 -1 newsha=3c1f9ab
@@ -18,7 +18,10 @@ export async function acceptInvite(token: string) {
   const invite = await db.invites.findByToken(token);
   if (!invite) throw new NotFound("invite");
-  return db.members.create({ orgId: invite.orgId, userId: invite.userId });
+  if (invite.expiresAt < new Date()) {
+    throw new Gone("invite expired");
+  }
+  return db.members.create({ orgId: invite.orgId, userId: invite.userId });
 }

@note +21..23 kind=security risk=high confidence=0.85
why: Invites were valid forever, so anyone holding an old link could still join
  an org that had since removed the invitee.
source: file:src/invites/create.ts:31 — expiresAt is already written on create
source: prompt:"invites should stop working after a week" — your words
verify: cmd `npm test -- invites` => pass (adds the expired-token case)
alt: deleting expired rows in a cron — rejected, it destroys the audit trail

`Gone` maps to HTTP 410 in the error middleware, so a client can tell "expired"
from "never existed".

@note +24 kind=assumption confidence=0.4
why: The server clock is trusted for this comparison.
source: inference — this codebase has no clock-skew convention
verify: none => unknown
question: should expiry be evaluated in the database so replicas agree?
```
