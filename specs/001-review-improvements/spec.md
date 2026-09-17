# Review improvements: requirements and delivery roadmap

Status: initial delivery implemented; see `verification.md`. Date: 2026-09-17.
Baseline inspected: `28e5280`; working trees were clean before this documentation work.
Classification: Large — viewer interaction, a format extension, npm distribution,
and evidence ingestion need separate, independently verifiable deliveries.

## Goal

Make AI-authored changes easier to inspect without losing the distinction between
what an author claims and what tools actually checked. Support several precise
annotations on the same code, compact disclosure, stable diff colors, synchronized
split scrolling, an npm-delivered agent skill, and deterministic quality checks.

## Scope and assumptions

- “Comments” initially means existing line-addressed `@note` annotations. Multiple
  annotations on a range are required; discussion replies and browser authoring are
  a separate proposal below, because they need authorship and persistence semantics.
- “Estimated accuracy” means explicitly labeled author confidence. Do not invent a
  measured accuracy percentage from coverage, passing tests, citations, or lint.
- Urgency is distinct from risk: priority to act versus blast radius if wrong.
- Retain v1 reading and existing line/part/hunk apply behavior.
- The initial task registered Vault context; the subsequent implementation request
  authorized the deliveries below. Publishing, deployment, commits and global skill
  installation remain separate actions.
- No new hosted backend, accounts, AI service, or automatic code rewrite in this scope.

## Observed baseline and files to read

| Files | Current behavior and implication |
| --- | --- |
| `spec/whymark-v1.md`, `src/lib/whymark/types.ts`, `parse.ts`, `serialize.ts` | Repeated `@note` selectors already work; confidence and risk exist, urgency does not. |
| `src/lib/whymark/align.ts`, `src/lib/view-model.ts` | Rows carry `noteIds[]`; `layoutRail` inserts code padding to align cards. |
| `src/components/whymark/file-panel.tsx` | Row hover/click uses `noteIds[0]`; `rowTint` replaces diff tone with category tone. Split panes scroll independently. |
| `src/components/whymark/note-card.tsx`, `pills.tsx`, `meta.tsx` | Expanded cards, type/risk/confidence badges; no per-card disclosure. |
| `src/components/whymark/review-view.tsx`, `src/components/ui/dialog.tsx` | Existing navigation, filters and review state; reuse installed dialog primitives for settings. |
| `src/components/whymark/code-line.tsx`, `src/lib/whymark/inline.ts`, `edit.ts` | Shared inline parts are the contract between highlighting and file writes. |
| `src/lib/whymark/stats.ts`, `verify.ts`, `validate-tree.ts` | Passing claims count toward verified coverage; CLI reruns shell commands; blob hashes detect stale files. |
| `src/cli/whymark.ts`, `src/cli/help.ts`, `package.json`, `bin/whymark.mjs` | Existing CLI and npm packaging; package allowlist excludes `.agents/skills/whymark`. |
| `.agents/skills/whymark/SKILL.md`, `prompts/whymark-author.md` | Existing guidance already asks for tight ranges, real sources, and honest verification. |
| `tests/parse.test.ts`, `tests/review.test.ts`, `tests/cli.test.ts`, `tests/e2e/viewer.mjs` | Extend existing unit/CLI/browser patterns; preserve edit/apply regressions. |

The hover cause is supported by source inspection. This planning task has not
reproduced the reported interaction in a browser; capture that baseline before fixing it.

## Delivery sequence

| Order | Package | Depends on | Completion boundary |
| --- | --- | --- | --- |
| 1 | WM-01: semantic diff colors | none | Category hover cannot turn an addition into a red deletion-like row. |
| 2 | WM-02: multiple compact comments | WM-01 | Every overlapping note reachable; disclosure removes padding pressure. |
| 3 | WM-03: settings and split scrolling | WM-02 | Bidirectional horizontal sync, accessible settings, independent mode. |
| 4 | WM-04: npm skill distribution | WM-02 contract | Packed artifact installs the skill without Git access. |
| 5 | WM-05: trustworthy evidence presentation | none; integrate after WM-02 | Claims, fresh execution, stale evidence and inference distinguished. |
| 6 | WM-06: deterministic quality findings | WM-05 | Versioned findings tied to the reviewed source, with baseline comparison. |

Each package should be a small reviewable change with its own passing checks.
WM-04 can proceed independently once the annotation contract and guidance settle.
Do not wait for the scanner to ship the UI fixes.

## WM-01 — preserve diff meaning during hover

**Change:** modify `file-panel.tsx`, `code-line.tsx` only if necessary, and
`src/app/globals.css`; extend `tests/e2e/viewer.mjs`.

- Addition/deletion backgrounds remain green/red during hover, selection and focus.
- Indicate the annotation using a gutter marker or outline; keep category color on
  its badge/card. Do not replace diff backgrounds or syntax-token colors.
- Preserve distinct restored, rejected and partially reverted states.
- Test a security note on an addition, a deletion and unchanged context in unified
  and split views, including overlapping annotations and keyboard focus.
- Capture before/after screenshots and computed style assertions. The existing
  part-revert/apply tests must still show exactly the bytes that will be written.

## WM-02 — multiple comments, disclosure and tighter layout

**Change:** `note-card.tsx`, `file-panel.tsx`, `review-view.tsx`, `pills.tsx`,
`align.ts`, relevant types/parser/serializer/validator, format documentation,
author prompt, skill, `tests/parse.test.ts`, `tests/review.test.ts`, and browser tests.
Add focused `tests/align.test.ts` if existing tests cannot cover layout cleanly.

- Keep all matching note IDs, with stable document order. A line shows a count;
  selecting it exposes all applicable notes, with keyboard-selectable entries.
  Filtering must not leave a hidden first note intercepting selection.
- Each card has a real disclosure button with `aria-expanded` and `aria-controls`.
  Collapsed cards retain type, urgency and author confidence; missing values show
  “unspecified”/“unknown”. Keep the line selector visible for orientation.
- Proposed new optional header: `urgency=info|normal|urgent|blocking`. Never infer
  blocking from `kind=security`, and never reinterpret existing `risk` as urgency.
- Add urgency across spec, types, parser, serializer, validation, examples, skill and
  author prompt together. Preserve legacy input and unknown values without data loss;
  fixture-test old readers' behavior before choosing an additive v1 release. If they
  cannot preserve it, decide versioning before shipping the extension.
- Keep disclosure state separate from code acceptance/rejection and note selection.
  Clicking a link or disclosure must not reject code. Keyboard navigation to a
  collapsed note reveals it. Provide collapse-all/expand-all with per-note override.
- Proposed default: compact collapsed notes; selecting a note expands that note.
- Group notes sharing an anchor. Use measured collapsed/expanded heights and a
  compact rail that does not insert blank code rows to accommodate long comments.
  Connect displaced cards to their exact range; allow explicit selection to bring
  code and card into view. Keep both code columns vertically aligned.
- At 1600px, a fixture with three long notes on adjacent lines must retain the
  ordinary 21px code-line rhythm; expanding a note must not create card overlap.
  At 390px, notes remain reachable with no page-wide horizontal overflow.
- Author guidance: one claim/reason per note, narrowest meaningful range, first
  sentence states the decision and consequence, evidence explains why the source
  supports the claim. Do not fill every line with repetitive commentary to game coverage.
- Tests: three notes on one line, partially overlapping old/new ranges, file/doc notes,
  unknown urgency, missing confidence, round-trip preservation, filtering, deep links,
  resize, keyboard navigation and disclosure after changing view mode.

## WM-03 — settings modal and synchronized split scrolling

**Change:** `review-view.tsx`, `file-panel.tsx`, new
`src/components/whymark/review-settings.tsx`, new `src/lib/review-preferences.ts`,
and browser tests. Reuse `src/components/ui/dialog.tsx`.

- Settings button opens a labeled modal with focus containment, Escape dismissal,
  keyboard switches and focus return to the opener.
- First settings: synchronize horizontal scrolling (default on), default comment
  disclosure, and compact versus expanded annotation presentation. Add reset defaults.
- Synchronize only the two sides of the same file in either direction. Equal pixel
  offsets are preferable to percentages because code columns should line up. Clamp
  the destination to its available range without moving the originating pane back.
- Avoid feedback loops from programmatic scroll events, handle resize/short panes,
  and clean up handlers. No coupling between files or forced vertical scrolling.
- Disabling sync lets each pane move independently. Re-enabling aligns to the last
  user-scrolled pane. Switching unified/split preserves the preference.
- Persist only harmless viewer preferences in existing browser-local storage style,
  with versioning and an in-memory fallback for blocked/corrupt storage. Review text,
  evidence and code decisions must not enter the preferences object.
- Test both directions, unequal widths, no overflow, rapid alternating scrolls,
  toggling off/on, multiple files, reload, blocked storage and modal accessibility.

## WM-04 — install the agent skill using npm

**Change:** `package.json`, `src/cli/whymark.ts`, `src/cli/help.ts`,
`.agents/skills/whymark/SKILL.md`, `prompts/whymark-author.md`, `README.md`,
`tests/cli.test.ts`; add `tests/package.test.ts` and a small installer module if useful.

- Keep the existing package; explicitly include the canonical skill and required
  references in its npm file allowlist. Do not depend on cloning the private repo.
- Proposed command (not implemented): `npx whymark@<version> skill install`.
  Project-local installation is default; explicit agent and global options select
  destinations. Start with Codex and Claude Code, then extend documented targets.
- Resolve bundled files relative to the installed package, not the current checkout.
  All relative skill links must resolve in the installed skill. Include a minimal
  working review example and the relevant format reference with the installation.
- Preview destinations; identical installs are idempotent. Refuse to overwrite
  customized files without explicit replacement. Detect unsafe symlink destinations.
  Do not modify unrelated `AGENTS.md`/`CLAUDE.md` or run postinstall mutations.
- Keep `init` as its existing alias for `new` (review skeleton generation); document
  `skill install` separately so installation cannot replace that command's behavior.
- Packaging gate: build CLI, `npm pack`, inspect tarball, install into a temporary
  consumer with no repository credentials, then execute the packaged installer.
  Test project/global targets using an isolated test home, repeats and conflicts.
- Public npm content is public even if the repository is private; review the tarball
  allowlist before release. Publishing remains a separate authorized action.
- `npx skills` does support private repositories using configured authentication,
  but that still requires repository access. npm delivery avoids that requirement.

## WM-05 — evidence a reviewer can inspect

**Change:** `src/lib/whymark/stats.ts`, `verify.ts`, `validate-tree.ts`, `types.ts`,
`src/components/whymark/review-view.tsx`, `pills.tsx`, and new evidence model/tests.
Any persisted evidence schema also updates parser, serializer, spec and skill.

- Rename current “verified” presentation to “claimed verified” unless backed by a
  recorded execution bound to this source state. Preserve old reports as legacy claims.
- Show distinct states: author claim, execution record, stale record, contradicted,
  unavailable, skipped. A pass plus a failure cannot render as unqualified success.
- Record command, cwd relative to repo, tool version, execution time, exit code,
  output artifact/hash, and source fingerprint including relevant uncommitted files.
  Record the reviewed base/head and test/config/lockfile inputs as well as diff hashes.
- Hash mismatch invalidates freshness; hashes establish identity, not who ran a check.
  Imported results remain externally supplied evidence unless independently rerun or
  authenticated. Do not call a successful check proof of correctness.
- Show source locator plus the supported claim. Validate local file/line/commit/dep
  references against the recorded revision. A reachable URL is not proof it supports
  the explanation; semantic relevance remains a reviewer judgment.
- Sources stay clickable but are not automatically fetched by the server. Optional
  link checking must be separate, bounded, and protect private/internal network targets.
- Viewing/importing a review never executes its embedded commands. The existing CLI
  verifier runs shell text; show exact commands and require explicit execution intent
  before adding any UI runner. Use trusted configured checks for automation.
- Tests: fabricated pass with no run, stale tests with unchanged production file,
  pass/fail conflict, missing output, timeout, skipped tool, inference-only source,
  missing local reference, and hostile imported command that is never auto-executed.

## WM-06 — automatic checks without AI

**Change:** new `src/lib/quality/types.ts`, `src/lib/quality/import.ts`,
`src/lib/quality/baseline.ts`, `src/lib/quality/run.ts`, quality tests,
CLI/help, new `src/components/whymark/quality-panel.tsx`, and optional
`whymark.config.json` for explicitly configured local checks.

Start with existing scripts and an ESLint JSON adapter, then add adapters as separate
deliveries. Do not add all tools as mandatory runtime dependencies.

| Signal | Tool / approach | Limitation |
| --- | --- | --- |
| Type and rule violations | Existing TypeScript and ESLint; configurable complexity/depth/size warnings | Cannot establish domain correctness or subjective readability. |
| Unused exports/files/dependencies | Optional Knip adapter | Requires project-aware configuration and allowances for dynamic usage. |
| Security patterns | Optional Semgrep CE with pinned local rules | Rule-dependent; findings require triage, not automatic rejection. |
| Dependency advisories | Optional npm audit import | Registry-backed/networked; not an offline scan or exploitability proof. |
| Test evidence | Existing test runner and coverage report import | Line coverage is not assertion quality or behavioral completeness. |

- Normalize tool/version, rule ID, severity, message, file/range, help URL,
  fingerprint, source revision, status and artifact reference. Validate import size,
  paths and malformed reports; never treat tool output as instructions.
- Compare against the base revision to separate new findings from existing debt.
  Run tools with full project/dependency context and filter presentation to changed
  lines plus related findings; do not assume linting changed files proves the project.
- Stable identities account for shifted lines and renames. Expose unanchored findings
  at file/project level rather than dropping them. A crashed/missing tool is unavailable,
  never a clean scan. Baseline failure means comparison unavailable, not no new issues.
- Initially advisory. Later opt-in CI policy can block new errors/high-severity findings,
  with explicit, reviewable suppressions carrying reason and expiry.
- Automatic mode runs only trusted repository-configured tools after explicit setup,
  debounces changes, cancels superseded jobs and prevents stale results replacing newer
  ones. Imported `.whymark` commands cannot define that configuration.
- Tests: pre-existing/new/resolved finding, rename, line shift, deleted file, missing
  baseline, scanner failure, excessive output, suppression expiry and out-of-order jobs.

## Further features worth considering

1. Reviewer checklist: inspect high-risk changes, unresolved assumptions, missing tests
   and stale evidence before marking a review complete; no universal trust score.
2. Reviewed/unreviewed state tied to file hashes, so changed code reopens review work.
3. Regression and mutation-test evidence for critical paths, with cost controls;
   optional later, because mutation testing can be slow and environment-sensitive.
4. Change impact from imports/callers and linked tests, explicitly labeled as a static
   approximation. Useful for spotting a correct local change with missed consumers.
5. Human replies and resolution history, if needed: stable thread IDs, author/time,
   export/persistence rules, and reopen-on-code-change behavior before adding the UI.
6. Structured JSON/SARIF import/export once the first native adapter is stable; avoid
   making every finding an AI-authored annotation or inflating explanation coverage.

## Verification and rollout

- Every package: `npm test`, `npm run typecheck`, `npm run lint`.
- Viewer packages: run `npm run dev`, then `npm run test:ui`; inspect screenshots,
  browser errors, keyboard behavior, narrow layout, and unchanged apply safeguards.
- Viewer build changes: `npm run build`. CLI/package changes: `npm run build:cli`
  plus installation from the actual packed tarball, not only source tests.
- Format changes: old/new fixtures, parse/serialize round trips, unknown-field recovery
  and installed-skill examples all agree. Never silently discard newer metadata.
- Add deterministic fail-before/pass-after coverage for the color/selection defects.
  New capabilities get acceptance coverage rather than invented baseline failures.
- Use the Vault implement-verify harness, record unavailable checks, and perform final
  source and behavior passes on unchanged code. Static checks alone do not finish UI work.
- Ship incrementally. Preserve old review files and fail closed on stale apply targets.
  Preferences have safe defaults; scanner adapters remain opt-in until calibrated.

## Spec Kit handoff

Use this document as the requirements input to `/speckit.specify`, then
`/speckit.clarify`, `/speckit.plan`, `/speckit.tasks`, and `/speckit.analyze` for the
selected delivery package. Keep one feature workspace rather than creating a second
parallel plan. Read `~/.vault/skills/implement-verify/SKILL.md` before implementation.
The implementation consumed this approved roadmap directly with the Vault
implement-verify harness. No Spec Kit scaffolding or additional planning suite was
introduced. See `verification.md` for delivered scope and deviations.

Recommended first implementation: WM-01, followed by WM-02. Have a fresh-context
reviewer check the resulting diff against the package's acceptance criteria; resolve
correctness gaps rather than expanding into stylistic cleanup.

## Open decisions (proposed defaults allow planning to proceed)

- Accept `info|normal|urgent|blocking` urgency, or choose a team priority vocabulary.
- Confirm that “multiple comments” means independent annotations initially; human
  reply threads and browser editing remain later work unless explicitly requested.
- Accept compact collapsed notes as the default, with selection expanding one note.
- First installer targets: Codex and Claude Code; npm package stays public as currently
  configured. Confirm separately before release if package access should change.
- Which repositories/languages should the first quality adapters support beyond this
  TypeScript project? Start with TypeScript/ESLint; add language-specific adapters later.

## External references checked for this plan

- [npm package file allowlist and publishing configuration](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/).
- [Skills CLI private-repository authentication and local sources](https://github.com/vercel-labs/skills#private-repositories).
- [ESLint complexity rule](https://eslint.org/docs/latest/rules/complexity).
- [Knip setup and project configuration](https://knip.dev/overview/getting-started).
- [Semgrep Community Edition](https://semgrep.dev/products/community-edition/).

These sources inform proposed integrations; no third-party tool installation or scan
was performed, and no measured code-accuracy claim is made.
