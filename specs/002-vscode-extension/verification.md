# VS Code extension — delivery evidence

Implemented against baseline `d5ba7ce`, initially clean working tree. Changes are
uncommitted; no push, Marketplace publication, or installation into the user's
normal VS Code profile was performed.

## Acceptance disposition

| ID | Requirement | Evidence | Status |
| --- | --- | --- | --- |
| VSC-01 | Interactive `.whymark` custom editor without a server | Real VS Code loads the bundled webview and sends its ready message; Chromium exercises the bundled controls under CSP | Verified |
| VSC-02 | Distinct staged, unstaged, worktree, branch and commit comparisons | Real Git fixture asserts HEAD/index/worktree separation; installed host exercises staged and unstaged commands; remaining scopes reuse existing Git collector coverage | Verified within listed coverage |
| VSC-03 | Hash-checked undoable source edits, index untouched | Installed host checks stale disk, stale review revision, invalid paths/lines, dirty buffers, native undo and unchanged disk/index | Verified |
| VSC-04 | Save/reopen and live raw-review changes | Installed host creates exact bytes, refuses an existing filename, reopens custom editor and observes refresh from raw TextDocument edits | Verified |
| VSC-05 | Safe webview and read-only mode | Literal HTML rendering, typed message rejection, symlink/traversal cases, restricted UI and keyboard checks; trust gates inspected in host | Verified for tested boundaries; real restricted-mode host not exercised |
| VSC-06 | Installable package and web compatibility | VSIX installed into isolated VS Code profile and exercised; existing 38 browser checks plus improvements suite pass | Verified |

## Checks

- `npm test` on Node 22.23.2: 105 tests / 14 files passed.
- `npm run typecheck`, `npm run lint`: passed.
- `npm run package:vscode`: bundled VSIX, about 1.8 MB compressed; host, worker,
  webview JavaScript/CSS, manifest, README and license included. No external runtime
  modules or development server are required.
- `WHYMARK_VSIX=.artifacts/whymark-vscode.vsix npm run test:vscode`: installed package
  passes real VS Code 1.138.0 extension-host checks on macOS.
- `node tests/e2e/vscode.mjs`: bundled React controls, apply messages, split mode,
  settings, source/save/refresh messages, literal content, restricted UI/keyboard,
  and no JavaScript errors. Its VS Code message bridge is simulated; the separate
  installed-host checks exercise actual WorkspaceEdit, custom editor and Git.
- `npm run test:ui`: 38 existing real-browser checks passed, zero console errors.
- `node tests/e2e/improvements.mjs`: all feature checks passed.
- `npm run build -- --webpack`: production web build passed.
- `git diff --check`: passed; browser suite restored `examples/retry.ts`.

Final reruns and output identities are recorded in `reviews/vscode-extension.whymark`.
The `.artifacts/vscode/` directory contains the bundled-webview screenshot and source
fingerprint. Evidence represents separate source-driven and behavior-driven
self-review passes, not an independent-agent audit.

## Corrections and limits

The first baseline run under Node 24/npm 12 failed in the existing npm pack test;
rerunning under the project's declared Node 22 passed all 102 baseline tests.
The extension acceptance run caught macOS path aliases opening separate document
identities; canonical lookup now respects existing unsaved buffers and rejects
multiple aliases. The source review also closed the read-only keyboard decision
path, covered by the bundled-webview test. Initial test setup used an outdated
macOS executable filename and an unavailable cleanup command; both were corrected.

Comparisons use saved filesystem content. Branch mode compares merge-base to HEAD;
it does not include uncommitted changes. Source edits change editor buffers and
must be saved by the user; they do not stage/unstage or modify the index. Imported
execution evidence is not independently re-run by this extension. Generated notes
remain explicit stubs. Review files are limited to 8 MB and 1,000 files; Git workers
are cancellable and limited to 30 seconds. Refreshing a generated comparison
regenerates its snapshot; edit a saved review's source to retain authored notes.

Windows, Linux, remote hosts, VS Code 1.96 minimum-version runtime, real untrusted
workspace host, branch/commit input dialogs and Save As dialog interaction were
not exercised. API typing uses 1.96; installed-host testing uses 1.138. The save
operation behind the dialog is tested with real VS Code APIs. The desktop/remote
filesystem extension does not support browser-only virtual workspaces.

## npm / Marketplace distribution follow-up

The npm file allowlist now includes the built VSIX and identity/digest metadata;
`prepack` rebuilds them. `whymark vscode install` invokes the editor CLI with separate
arguments and checks the bundled digest before installation. `--dry-run` performs
no installation; `--marketplace` selects the extension ID for use after publication.
The explicit `publish:vscode` script publishes an already-built VSIX only when run.

Verification: 106 tests / 15 files, typecheck and lint passed on Node 22. An actual
npm tarball and local yaml tarball were installed offline into a clean consumer;
that consumer's CLI installed the bundled VSIX into an isolated VS Code profile,
and VS Code listed `spink-dev.whymark@0.1.0`. The normal editor profile was unchanged.
Unit checks cover argument boundaries, paths with spaces/metacharacters, preview,
missing launchers, nonzero editor exits, Marketplace target selection and corrupt
bundled bytes. Windows launcher behavior is implemented but not runtime-tested.

The distribution changes were inspected in separate source and behavior passes.
Existing staged changes from the extension implementation were preserved. Publisher
ownership, authenticated Marketplace publication and end-user Marketplace download
are not verified. Neither npm nor Marketplace was published.
