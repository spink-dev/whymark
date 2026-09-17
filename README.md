# whymark — read AI-written code with the reasoning attached

Reading a diff an agent produced is cheap. Deciding whether to trust it is not.
The diff shows what changed; it never shows why that shape was chosen, what the
agent read before writing it, which parts it invented, or what it actually ran to
check. So you reconstruct all of that by hand, on every review.

**whymark** is a file format that carries those answers next to the lines they
belong to, plus the tooling to generate, check, and read them.

The name is the rule. A diff already shows what changed, so a mark that repeats
it is worth nothing; every mark in a `.whymark` file exists to say why, and to
show what backs the claim.

A `.whymark` file is a unified diff with **line-addressed annotations**:

```whymark
---
whymark: 1
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

Read a review in the browser — nothing is uploaded:

**[whymark.x47.dev](https://whymark.x47.dev)** · drop or paste a `.whymark` file.
History stays in that browser; you can clear it from the page.

The CLI runs from any git repository with `npx` — no install, no clone:

```bash
npx whymark help
npx whymark new --staged     --author "claude-opus-5 (cursor)"
npx whymark new --unstaged   # includes files git does not track yet
npx whymark new --branch main
npx whymark new --commit HEAD
```

That writes `reviews/<slug>.whymark` containing the real diff and one annotation
stub per hunk. An agent fills the stubs in (see [Using it with an
agent](#using-it-with-an-agent)), then:

```bash
npx whymark validate reviews/my-change.whymark --min-coverage 0.8
npx whymark verify   reviews/my-change.whymark --write
npx whymark stats    reviews/my-change.whymark
```

`verify` is the part that matters most: it re-runs every command the review
*claims* to have run, compares the exit code to the claimed status, and reports
each claim as **confirmed**, **contradicted**, or **unrunnable**. With `--write`
it rewrites the file with what actually happened, so a review cannot keep
claiming a passing test that fails.

## The viewer

**Hosted:** [whymark.x47.dev](https://whymark.x47.dev) — drop a file. Parsing,
highlighting, and history run in your browser. The hosted site cannot write to a
working tree. Terms: [/terms](https://whymark.x47.dev/terms). Privacy:
[/privacy](https://whymark.x47.dev/privacy).

**Local:** this repository, when you want to apply decisions to files on disk:

```bash
npm install
npm run dev            # http://localhost:43917
```

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

The home page is the drop target. `/format` renders the specification. `/terms`
and `/privacy` describe the hosted site. `/inspect` redirects home.

### Deciding, and editing, without leaving the page

Reading a review usually ends in a judgement: most of this is fine, that line is
not. Since the viewer is already running against your checkout, it can act on
that judgement directly instead of sending you to a pull request page.

- **Discard a line.** Every changed line carries a control at its left edge:
  `×` drops an added line, `↩` puts a removed one back. The line is struck
  through until you apply. `x` does the same for everything the selected
  annotation covers, so `j` `x` `j` `x` works as a review pass.
- **Revert one part of a line.** A line is often too coarse: the same line can
  carry a rename worth keeping and a constant that is not. Replaced lines are
  compared word by word, and each differing part is its own control — click the
  highlighted `250` and it shows `200` in place, which is what will be written.
  The rest of the line, and the rest of the change, stay as the AI wrote them.
- **Restore a removal on its own.** `↩` on a removed line brings it back
  whether or not you keep the code that replaced it; the two decisions are
  independent.
- **Discard a hunk**, or **edit** it: `edit` opens the hunk's new text in an
  editor and writes your version to the file.
- **Apply** collects the decisions across every file and writes them, then tells
  you what changed on disk.

Two guards keep that safe. The path must resolve inside the repository, and the
file must still hash to exactly the version the review recorded — a file that
changed underneath you is shown `read-only` rather than silently overwritten.
Nothing is written until you press apply, and nothing is committed for you.

Reverting a part edits inside a line, so it can leave code that does not
compile — the same as any hand edit. The line on screen always reads exactly as
the line that will be written, so what you get is what you saw.

`reviews/retry-backoff.whymark` is a live example: it reviews a real change to
`examples/retry.ts`, and three parts of that change are deliberately worth
rejecting — a leftover debug log, a widened list of retryable statuses, and a
default nudged from 200ms to 250ms on the same line as a rename worth keeping.
`git checkout examples/` undoes whatever you apply.

## Using it with an agent

The same instructions are installed for every agent that reads a skill
directory:

- **Cursor** — `.cursor/skills/whymark/SKILL.md`
- **Codex** (and any `.agents`-aware tool) — `.agents/skills/whymark/SKILL.md`
- **Anything else** — `prompts/whymark-author.md`, or generate a filled-in prompt
  with the diff already embedded:

```bash
npx whymark prompt --staged | pbcopy
```

Ask for it in plain language once the skill is installed: *"write a whymark review
of this branch"*.

### In CI

`validate` exits non-zero on structural errors and below-threshold coverage;
`verify` exits non-zero when a claim is contradicted.

```bash
npx whymark validate reviews/*.whymark --min-coverage 0.8 --strict
npx whymark verify reviews/my-change.whymark
```

## CLI

`npx whymark help` and `npx whymark help <command>` cover flags, scope, and how
to fill `why` / `source` / `verify`. `npx whymark help annotate` is the field
guide.

| Command | Does |
| --- | --- |
| `npx whymark new [scope]` | Build a skeleton from a git diff |
| `npx whymark prompt [scope]` | Print an authoring prompt with the diff embedded |
| `npx whymark validate <file…>` | Structure, selector drift, staleness, coverage, stubs |
| `npx whymark verify <file>` | Re-run every `verify: cmd` claim (`--write` to record) |
| `npx whymark stats <file>` | Coverage and evidence metrics |
| `npx whymark fmt <file>` | Rewrite in canonical form |
| `npx whymark view` | How to open the visual reviewer |
| `npx whymark help [command]` | Usage, options, and annotating rules |

Scopes: `--unstaged`, `--staged`, `--worktree`, `--branch [base]`,
`--commit <rev>`. Also `--path <pathspec>`, `--stubs hunk|file|none`,
`--check <cmd>`, `--context <n>`, `--no-untracked`, `--json`.

## Repository layout

```
spec/whymark-v1.md              the format: grammar, selectors, field vocabulary
src/lib/whymark/                parser, serializer, git importer, metrics,
                             validator, verification runner, decision engine
                             (no framework deps)
src/cli/whymark.ts              the CLI
src/app, src/components      the viewer (Next.js, Tailwind, shadcn/ui, shiki)
.agents/skills/whymark/         the skill, canonical copy
.cursor/skills/whymark/         the same skill for Cursor
prompts/whymark-author.md       copy-paste prompt for any other agent
reviews/*.whymark               reviews the viewer lists
examples/                    a real file to review, so the reviewer has
                             something it can actually edit
tests/                       parser, alignment, metrics, validation, decisions
tests/e2e/viewer.mjs         browser checks: layout, alignment, apply path
```

The library in `src/lib/whymark` has no dependency on React or Next and only uses
`yaml`, so it can be lifted into any other tool.

## Why not just a good PR description?

A PR description sits far from the code and rots on the first force-push. whymark
annotations are addressed to line ranges, so `validate` can tell you an
annotation has drifted off its code, and to blob hashes, so it can tell you the
review is stale. And a description cannot be re-executed — `verify` can.

## Hosting on Vercel

The viewer is a Next.js app. Import this GitHub repository in Vercel, then:

1. Add the production domain `whymark.x47.dev` in the Vercel project.
2. Point a DNS CNAME `whymark` (on `x47.dev`) at `cname.vercel-dns.com`.
3. Optional: set `NEXT_PUBLIC_SITE_URL=https://whymark.x47.dev`.

The hosted deployment does not write a working tree. Files a visitor opens are
parsed in the browser and stored only in that browser’s IndexedDB.

## Development

After `npm install` in this checkout, `npx whymark` is the local CLI (the same
command people run from any other repo against the published package).

```bash
npm test           # vitest
npm run typecheck
npm run lint
npm run build
npm run build:cli  # refresh dist/whymark.mjs when the CLI changes
npm run test:ui    # interaction checks, against a running npm run dev
```

`test:ui` drives a real browser because the viewer has a failure mode that looks
fine in a screenshot: if the client bundle does not load, the page still renders
every card in its server-computed position while the toggles, filters, and
keyboard shortcuts silently do nothing. It asserts that cards line up with the
code they explain, that none overlap, and that each control responds.

The format is versioned: every document declares `whymark: 1`, and a parser warns
rather than fails when it meets a version it does not implement.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how changes get reviewed here.

## Licence and provenance

MIT, plus an AI-Led Development Acknowledgement — see [LICENSE](LICENSE).

AI agents wrote most of this code, directed by a human, and every change is read
by at least one human before it merges. That review is the only assurance
offered: nothing here has been audited, formally verified, or reviewed by a
domain expert, and no liability is accepted for the code or for any claim
recorded in a review inside it. The acknowledgement adds no conditions to MIT
and takes none of its permissions away.

Stating this in the licence is the same argument the format makes. A reader
deciding whether to trust code is better served by knowing how it was produced
and where the review stopped than by an unqualified assurance.

## Agent skill from npm

The private Git repository is not required. The npm package includes the skill,
format reference and a working example embedded in the skill.

```sh
npx whymark@<version> skill install --dry-run
npx whymark@<version> skill install --agent codex --agent claude-code
# Optional: install in your user directory rather than this project
npx whymark@<version> skill install --agent codex --global
```

Replace `<version>` with the published release. These commands are implemented in
this checkout; a new release must be published before they are available from npm.
The default target is project-local Codex. Identical files are unchanged; customized
files require `--force`. Symlink destinations are refused. Installation never
changes unrelated agent instruction files. `init` still means `new`, not skill installation.

## Compact reviews and settings

A line can carry multiple comments; its count button opens a selector for each.
Comments collapse independently while type, urgency, line selector and author
confidence stay visible. Missing confidence is shown as unknown. Settings control
horizontal split-pane synchronization, default disclosure and compact layout.
Preferences stay in this browser with a session fallback when storage is blocked.

## Checks without AI

```sh
npx whymark quality init
# Inspect whymark.config.json first; --run executes its local shell commands.
npx whymark quality reviews/change.whymark --run --write
npx whymark quality reviews/change.whymark --run > reviews/baseline.quality.json
npx whymark quality reviews/change.whymark --run --baseline reviews/baseline.quality.json --write
# Debounced rescans; superseded commands are cancelled. Ctrl-C stops watching.
npx whymark quality reviews/change.whymark --run --watch --write
# Import existing output without executing anything
npx whymark quality reviews/change.whymark --import eslint.json --tool-version 9 --write
```

Start with the generated ESLint and TypeScript commands and adapt them to your
repository. The ESLint command includes configurable complexity (15) and nesting (4)
warnings. Run checks in full project context; the viewer can filter findings to
changed lines. Missing tools are unavailable, not passing. A baseline needs a clean source checkout with HEAD matching the review's base
(short review hashes are resolved through Git) and matching tool versions/commands;
create it on the base checkout with configuration already committed. Comparison separates new, existing and resolved findings, handles
Git-detected renames, and ignores line shifts. Use a `.quality.json` file under
`reviews/` or outside the checkout for snapshots, so the report does not fingerprint
itself. Findings have stable IDs; `suppressions` entries in configuration require
`id`, `reason` and a future `expires` date. Checks are advisory to repository policy;
the command exits nonzero for failed/unavailable checks and unsuppressed errors.

`verify --write` records execution metadata, output hashes and source fingerprints.
The local viewer checks source freshness and execution log hashes; imported evidence
remains unauthenticated. “Claimed verified” is an author claim, not measured code
accuracy. Fingerprints exclude ignored files, `.artifacts/`, and review outputs in
`reviews/`; they include tests/config/lockfiles but do not cover installed dependency
bytes or external services. Inspect output logs before sharing. No command runs just
by opening a review. Optional Knip, Semgrep, audit and coverage adapters remain future
integrations; the current quality adapter is ESLint plus configured pass/fail checks.

## VS Code extension

Open `.whymark` reviews interactively in VS Code, or compare staged, unstaged, all
working-tree, branch and commit changes from the Command Palette. No dev server is
required. Review comments, filter evidence, switch split/unified views, and apply
undoable edits to source buffers without changing the Git index.

```sh
npm run package:vscode
code --install-extension .artifacts/whymark-vscode.vsix
```

See [extension usage and safety boundaries](extensions/vscode/README.md). The VSIX
is local and self-contained; it has not been published to the Marketplace.

### Install the VS Code extension through npm

The next npm release includes its VSIX, so users with VS Code installed can run:

```sh
npx whymark@latest vscode install
```

Use `--dry-run` to preview, or `--code /path/to/code` if the editor launcher is not
on PATH. No GitHub access or Marketplace download is needed for this route.
After Marketplace publication, `npx whymark vscode install --marketplace` installs
`spink-dev.whymark` from the Marketplace instead. See the
[release guide](extensions/vscode/PUBLISHING.md) for publisher setup and separate
npm/Marketplace releases. These commands are implemented locally; neither updated
package has been published by this task.
