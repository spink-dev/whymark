# Review improvements — implementation evidence

Date: 2026-09-17. Baseline: `28e5280` plus the previous task's uncommitted
AGENTS.md/CLAUDE.md and roadmap. No commits or publication.

## Disposition

| Package | Delivered boundary | Evidence |
| --- | --- | --- |
| WM-01 | Diff backgrounds survive category hover/focus; annotation selection uses outlines/gutters. | New browser regression failed before the fix: green `lab(... / 0.11)` became security red `oklch(... / 0.13)`. It passes after the fix. |
| WM-02 | All overlapping notes selectable; disclosure shows type, urgency and author confidence; compact rail keeps code rows contiguous. | Parser/round-trip tests; browser filtering, collapse/expand, precise side selection, layout and deep links. |
| WM-03 | Settings modal; bidirectional per-file scrolling, independent mode, clamping without snap-back; persistent preferences with session fallback. | Browser interaction, focus return, reload, unequal widths, independent files, storage write failure and 390px layout. |
| WM-04 | Bundled Codex/Claude skill installer with preview, conflict protection, repeatability and symlink rejection. | Unit tests plus actual npm tarballs installed offline into a clean temporary consumer; installed skill/reference read back. Skill validator passed using the existing specify-cli Python environment. |
| WM-05 | Claimed coverage distinguished from execution records; source/output identity, stale/unavailable/contradicted states; local locator checks. | Execution, mutation, stale test fixture, missing output, conflicting claims and imported-command tests. |
| WM-06 | ESLint JSON and configured checks, complexity/depth suggestions, import, clean-base comparison, expiring suppressions, cancellable watch mode and viewer findings. | Real ESLint process on a temporary repository; committed-base/shifted-line comparison; malformed paths/reports, timeouts/output bounds, cancellation, latest-only watch publication and no command execution during import. |

## Verification commands

Run in the repository, sequentially when the browser suite is involved:

- `npm test` — 102 tests across 13 files, including package installation.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `node tests/e2e/improvements.mjs` — new feature browser acceptance suite.
- `npm run test:ui` — 38 existing real-browser checks, including file/part apply,
  stale-write protection, restoration of `examples/retry.ts`, and zero browser errors.
- `npm run build -- --webpack` — production build passed, including on Node 22.23.2.
- `git diff --check` — passed.
- `quick_validate.py .agents/skills/whymark` — passed with
  `~/.local/share/uv/tools/specify-cli/bin/python` (its environment includes PyYAML).

Node 22.23.2 and Node 24.20.0 were exercised on macOS. Chromium was used for UI
checks. Linux/Windows runtime behavior and live agent discovery were not exercised.
The source-only skill validator is distinct from packed installation and live discovery.
The generated handoff review records executable checks and source fingerprints.

## Review and limitations

Source pass: traced parser/serializer compatibility, frontend versus Node import
boundaries, code/apply part sharing, local path handling, evidence freshness,
installer destinations, and scanner cancellation/baseline semantics.
Behavior pass: negative fixtures and public CLI/browser boundaries above. These are
separate self-review passes, not an independent-agent audit. The execution records
in `reviews/review-improvements.whymark` bind the rerun checks to source bytes.

- Urgency is canonically emitted as a body field, not a new header attribute:
  the baseline v1 formatter demonstrably preserved `urgency: urgent` but drops
  unknown header attributes. Updated readers accept both.
- Added `dist/**` to ESLint's generated-output exclusions; source remains linted.
- A first overlapping run of unit and browser tests saw the browser's temporary
  retry-file edit and failed. Rerunning sequentially after restoration passed.
  Do not run the mutating browser suite concurrently with unit tests.
- Default Turbopack build encountered environment failures (Google Fonts access,
  then a subprocess port-binding restriction). The supported webpack build passed;
  Turbopack production packaging is not claimed as verified in this environment.
- Evidence is unauthenticated, even when hashes match. Fingerprints exclude ignored
  files, artifacts and review outputs under `reviews/`, and cannot prove dependency
  bytes or external services. Bounds: 50,000 paths, 32 MB/file, 128 MB total; over-limit
  source identity is unavailable rather than silently partial.
- Baseline comparison requires a clean relevant source checkout, matching resolved
  base revision and identical tool commands/versions. No baseline means uncompared
  findings. Duplicate identical diagnostics remain potentially ambiguous.
- First quality adapter delivery is ESLint plus configured pass/fail checks. Knip,
  Semgrep, dependency-audit, coverage/SARIF adapters, authenticated attestations and
  human reply threads remain later work, as proposed in the roadmap.
- npm installation works from the locally packed artifact. This version has not been
  published; no global agent installation or deployment was performed.
