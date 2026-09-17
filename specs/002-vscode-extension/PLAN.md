# PLAN: Interactive Whymark in VS Code

## Goal
Open `.whymark` files and live Git comparisons in VS Code using the existing review UI. Compare staged against HEAD, unstaged against the index, worktree against HEAD, branch merge-base against HEAD, or a commit against its parent. Preserve explanations as explicit stubs for new comparisons.

## Out of scope
Marketplace publication, automatic command execution from annotations, staging/unstaging, cloud services, browser-only VS Code, and AI-generated claims.

## Context the agent must read first
- `src/lib/whymark/git.ts`, `edit.ts`, `inline.ts`: comparison and mutation contracts.
- `src/components/whymark/review-view.tsx`: shared interactive surface.
- `src/lib/view-model.ts`: highlighting, annotation and evidence state.
- VS Code custom editor, webview and workspace trust documentation.

## Stack decisions
Bundled TypeScript workspace extension and React webview. Custom text editor owns review documents; the extension host performs guarded operations. No Next.js server, CDN, or npm runtime installation. Git generation runs in a terminable worker. Source edits use VS Code WorkspaceEdit and remain undoable/unsaved.

## Files to change
| File | Operation | Purpose |
| --- | --- | --- |
| `extensions/vscode/` | create | Manifest, host, message protocol, webview, build, packaging, docs and acceptance tests |
| `src/components/whymark/review-view.tsx` | modify | Inject platform operations instead of importing server actions |
| `src/components/whymark/web-review-view.tsx` | create | Preserve web server action adapter |
| `src/lib/review-actions.ts` | create | Shared platform operation types |
| `src/app/r/[slug]/page.tsx`, `actions.ts` | modify | Web adapter wiring |
| `package.json`, lockfile, ESLint config | modify | API types and official packaging/testing tools |
| `tests/vscode.test.ts` | create | Protocol, containment and real Git comparison cases |
| `README.md` | modify | Local VSIX installation and scope |

## Sequence
1. Inspect baseline and APIs; add platform adapter.
2. Implement editor host, comparisons, refresh/save/source navigation and guarded editing.
3. Bundle assets and package VSIX.
4. Exercise real extension host and browser interactions; run existing checks sequentially.

## Tests & verification
Protocol rejection, traversal/symlink refusal, stale and dirty-buffer edit protection, literal content rendering, trusted/untrusted behavior, staged/unstaged separation, save/reopen, refresh, actual VSIX contents. Run npm test/typecheck/lint and existing browser suite. Test installed VS Code on macOS; distinguish unavailable platforms from verified ones.

## Risks & rollout
Review paths and webview messages are untrusted. Gate edits and Git on workspace trust; resolve paths within the selected repository; compare newSha to both disk and editor content before WorkspaceEdit. Do not execute annotation commands. Restrict webview resources and scripts with CSP. Existing web behavior retains server actions through adapter. Installation is a local VSIX; no publication or commits.

## Open questions
None blocking. Initial extension targets desktop/remote filesystem workspaces; compare refresh is explicit and review source changes refresh automatically.

## Distribution follow-up

Bundle the tested VSIX plus identity/version/SHA-256 metadata in the npm tarball.
Add an explicit `whymark vscode install` command with a preview, launcher override,
isolated profile paths and optional Marketplace ID installation. Build the VSIX
in prepack and verify a real offline tarball consumer can install it into a clean
VS Code profile. Provide an explicit publish command for the already-tested VSIX
and a publisher/authentication guide. Publication and publisher provisioning are
outside this implementation request.
