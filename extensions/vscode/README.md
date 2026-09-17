# Whymark for VS Code

Read AI-written changes with the reasons, sources and verification beside the code — directly in VS Code, without starting a web server.

## Install from npm

After the next npm release ships this command:

```sh
npx whymark@latest vscode install
```

It installs the extension bundled in the npm package through VS Code's CLI, with
no GitHub access or Marketplace dependency. VS Code must already be installed.
Use `--dry-run` to preview or `--code /path/to/code` for a custom installation.
Installation is explicit; installing the npm package alone does not change VS Code.
The VSIX version is tied to that npm release. Updates through npm require rerunning
the command; the installer does not force a downgrade of a newer installed extension.

After Marketplace publication, search for **Whymark** by publisher **spink-dev**,
or run `npx whymark vscode install --marketplace`. That route installs the published
Marketplace version instead of the bundled version. Publisher availability and
publication are not yet confirmed.

## Install locally

From the repository root:

```sh
npm ci
npm run package:vscode
code --install-extension .artifacts/whymark-vscode.vsix
```

Or use **Extensions: Install from VSIX…** and select the generated file. No Marketplace publication or GitHub access is needed to install the VSIX. Requires VS Code 1.96+ on a desktop or remote filesystem workspace.

## Review changes

Open a `.whymark` file to use the interactive editor, or run a command from the Command Palette / Source Control menu:

| Command | Comparison |
| --- | --- |
| Whymark: Review Staged Changes | HEAD → Git index |
| Whymark: Review Unstaged Changes | Git index → saved working files |
| Whymark: Review All Working Changes | HEAD → saved working files |
| Whymark: Review Branch Changes | merge base of selected ref and HEAD → HEAD (committed branch changes) |
| Whymark: Review Commit | selected commit against its parent |

New Git comparisons contain explanation stubs. They do not pretend to provide AI reasoning or verified accuracy. Empty comparisons are valid. Untracked files are included for unstaged/all-working comparisons by default; disable `whymark.includeUntracked` in Settings. Unsaved editor changes are excluded from comparisons.

Use **Refresh comparison** after saving code, staging changes, or switching branches. **Save review as…** writes a new `.whymark` file (existing reviews are not overwritten). **Open review source** opens the raw format alongside the viewer so you can edit explanations normally; saved and unsaved review edits refresh the preview. For multi-root workspaces, choose a repository when prompted.

## Interactive review

- Unified/split diffs, syntax highlighting, multiple comments per line, compact disclosures and filters.
- Settings for synchronized horizontal scrolling and annotation layout.
- Keyboard navigation: `j` / `k` for comments, `u` for split/unified, `x` for rejection, `?` for help.
- Open a reviewed file in an adjacent editor using the file selector.
- Reject lines/parts or edit a hunk. **Apply changes updates source editor buffers and supports Undo; save those files to persist edits.** The Git index is never changed. Files must still match the review hash; dirty buffers, unsafe paths and stale reviews are refused.
- Existing execution evidence is displayed as imported and quality evidence as unchecked. The extension does not execute verification commands or scanners embedded in reviews.

Restricted workspaces can display reviews. Git comparisons and source edits require workspace trust. Source paths are contained in the selected repository, including symlinks. Webview assets are bundled, external links permit HTTP(S) only, and no review data is uploaded.

## Development

`npm run build:vscode`, `npm run test:vscode`, and `npm run package:vscode` run from the repository root. The host and webview share the existing parser, diff/editor logic and React components. The Next.js application uses a separate server-action adapter.

Design references: [custom editors](https://code.visualstudio.com/api/extension-guides/custom-editors), [webviews](https://code.visualstudio.com/api/extension-guides/webview), [workspace trust](https://code.visualstudio.com/api/extension-guides/workspace-trust).
