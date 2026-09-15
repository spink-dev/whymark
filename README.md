# crev — read AI-written code with the reasoning attached

Reading a diff an agent produced is cheap. Deciding whether to trust it is not.
The diff shows what changed; it never shows why that shape was chosen, what the
agent read before writing it, which parts it invented, or what it actually ran to
check. So you reconstruct all of that by hand, on every review.

**CREV** is a file format that carries those answers next to the lines they
belong to, plus the tooling to generate, check, and read them.

A `.crev` file is a unified diff with **line-addressed annotations**:

```crev
---
crev: 1
title: Rate limit the public search API
author: claude-opus-5 (cursor)
scope: branch
base: main@8f1c2ab
summary: |
  One partner was issuing ~40 search requests a second, which saturated the
  read replica. This caps keyed traffic at 100/min in Redis.
checks:
  - cmd: npm test -- rate-limit
    status: pass
---

@file src/lib/rate-limit.ts added +34 newsha=1a9c4e2
@@ -0,0 +1,34 @@
+const LIMIT = 100;
+const WINDOW_SECONDS = 60;
...

@note +16..24 kind=intent risk=medium confidence=0.85
why: A fixed window was chosen over a token bucket because INCR/EXPIRE are
  atomic on the Redis side, so no lock or Lua script is needed and the limiter
  stays correct across the four app instances.
source: url:https://redis.io/docs/latest/commands/incr — INCR is atomic
source: file:src/lib/redis.ts:12 — the shared client already pipelines
verify: cmd `npm test -- rate-limit` => pass (11 tests)
alt: sliding window log — rejected, one sorted-set entry per request is far
  more memory than a limit this coarse needs
```

Four fields carry the weight:

| Field | Answers |
| --- | --- |
| `why` | Why the code is that way — the trade-off, not the mechanics |
| `source` | What evidence backs it: a file, a doc, a spec, your own words — or `inference`, the honest label for "the model made this up from context" |
| `verify` | What actually checked it, naming the exact command, so it can be re-run |
| `risk` / `confidence` | How much it matters if this is wrong, and how sure the author is |

`inference` is why the format works. An agent that must label its guesses
produces a review where the guesses are visible, and you can spend your
attention there instead of reading all 400 lines equally.

## Getting started

```bash
npm install
npm run dev            # the reviewer, at http://localhost:43917
```

Generate a review of changes you already have:

```bash
npm run crev -- new --staged     --author "claude-opus-5 (cursor)"
npm run crev -- new --unstaged   # includes files git does not track yet
npm run crev -- new --branch main
npm run crev -- new --commit HEAD
```

That writes `reviews/<slug>.crev` containing the real diff and one annotation
stub per hunk. An agent fills the stubs in (see [Using it with an
agent](#using-it-with-an-agent)), then:

```bash
npm run crev -- validate reviews/my-change.crev --min-coverage 0.8
npm run crev -- verify   reviews/my-change.crev --write
npm run crev -- stats    reviews/my-change.crev
```

`verify` is the part that matters most: it re-runs every command the review
*claims* to have run, compares the exit code to the claimed status, and reports
each claim as **confirmed**, **contradicted**, or **unrunnable**. With `--write`
it rewrites the file with what actually happened, so a review cannot keep
claiming a passing test that fails.

## The viewer

`npm run dev` serves every `.crev` file in `reviews/`.

- **Code left, annotations right.** Cards sit at the vertical position of the
  lines they explain, with a coloured bracket over the exact line range and a
  leader line into the card. Colliding cards push down instead of overlapping.
- **Unified or side-by-side** (`u`), with intraline highlighting so a
  one-character change does not read as a rewritten line.
- **Step through annotations** with `j`/`k`. Hovering a card tints its lines;
  clicking a line selects the annotation that covers it.
- **Filter** by annotation kind, or narrow to what is unverified or inferred —
  the two things worth your time first.
- **An evidence panel** with line coverage, verified share, sourced vs inferred
  counts, unverified high-risk annotations, open questions, and the status of
  every recorded check.
- **Staleness warnings.** File sections record a git blob hash, so the viewer
  and `validate` both tell you when the code has moved on since the review was
  written.

`/inspect` renders a `.crev` document pasted straight from a chat, without
saving it. `/format` renders the specification.

## Using it with an agent

The same instructions are installed for every agent that reads a skill
directory:

- **Cursor** — `.cursor/skills/crev/SKILL.md`
- **Codex** (and any `.agents`-aware tool) — `.agents/skills/crev/SKILL.md`
- **Anything else** — `prompts/crev-author.md`, or generate a filled-in prompt
  with the diff already embedded:

```bash
npm run crev -- prompt --staged | pbcopy
```

Ask for it in plain language once the skill is installed: *"write a crev review
of this branch"*.

### In CI

`validate` exits non-zero on structural errors and below-threshold coverage;
`verify` exits non-zero when a claim is contradicted.

```bash
npm run crev -- validate reviews/*.crev --min-coverage 0.8 --strict
npm run crev -- verify reviews/my-change.crev
```

## CLI

| Command | Does |
| --- | --- |
| `crev new [scope]` | Build a skeleton from a git diff |
| `crev prompt [scope]` | Print an authoring prompt with the diff embedded |
| `crev validate <file…>` | Structure, selector drift, staleness, coverage, stubs |
| `crev verify <file>` | Re-run every `verify: cmd` claim (`--write` to record) |
| `crev stats <file>` | Coverage and evidence metrics |
| `crev fmt <file>` | Rewrite in canonical form |

Scopes: `--unstaged`, `--staged`, `--worktree`, `--branch [base]`,
`--commit <rev>`. Also `--path <pathspec>`, `--stubs hunk|file|none`,
`--check <cmd>`, `--context <n>`, `--no-untracked`, `--json`.

## Repository layout

```
spec/crev-v1.md              the format: grammar, selectors, field vocabulary
src/lib/crev/                parser, serializer, git importer, metrics,
                             validator, verification runner  (no framework deps)
src/cli/crev.ts              the CLI
src/app, src/components      the viewer (Next.js, Tailwind, shadcn/ui, shiki)
.agents/skills/crev/         the skill, canonical copy
.cursor/skills/crev/         the same skill for Cursor
prompts/crev-author.md       copy-paste prompt for any other agent
reviews/*.crev               reviews the viewer lists
tests/                       parser, alignment, metrics, validation
```

The library in `src/lib/crev` has no dependency on React or Next and only uses
`yaml`, so it can be lifted into any other tool.

## Why not just a good PR description?

A PR description sits far from the code and rots on the first force-push. CREV
annotations are addressed to line ranges, so `validate` can tell you an
annotation has drifted off its code, and to blob hashes, so it can tell you the
review is stale. And a description cannot be re-executed — `verify` can.

## Development

```bash
npm test           # vitest
npm run typecheck
npm run lint
npm run build
npm run test:ui    # interaction checks, against a running npm run dev
```

`test:ui` drives a real browser because the viewer has a failure mode that looks
fine in a screenshot: if the client bundle does not load, the page still renders
every card in its server-computed position while the toggles, filters, and
keyboard shortcuts silently do nothing. It asserts that cards line up with the
code they explain, that none overlap, and that each control responds.

The format is versioned: every document declares `crev: 1`, and a parser warns
rather than fails when it meets a version it does not implement.
