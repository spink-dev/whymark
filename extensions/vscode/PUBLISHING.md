# Distribution and release

Two independent channels are supported. The npm package carries a VSIX built during
`prepack`; its explicit `whymark vscode install` command checks the packaged digest
and invokes the installed VS Code CLI. The digest detects corruption; it is not a
publisher signature. No postinstall hook installs extensions.

The extension identity is `spink-dev.whymark`, as declared in the extension manifest.
Ownership/availability of that publisher must be confirmed before publishing. A
private GitHub repository can remain private: consumers install the npm tarball or
Marketplace artifact without cloning it. Both public releases expose their packaged
code and documentation, even when the source repository stays private.

## Build and check locally

Use Node 22 and run from the repository root:

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run package:vscode
WHYMARK_VSIX=.artifacts/whymark-vscode.vsix npm run test:vscode
npm pack
```

`package:vscode` builds the extension and creates the same VSIX in
`.artifacts/whymark-vscode.vsix` and `dist/whymark-vscode.vsix`. It also writes
`dist/vscode-extension.json` with identity, version and digest. The npm file allowlist
includes both dist files; `prepack` regenerates them so fresh checkouts can publish.
Check the tarball before releasing. Version the npm CLI and extension independently;
bump `extensions/vscode/package.json` for each Marketplace release, and the root
package version for npm releases. Do not reuse an already-published version.

## Marketplace setup (one-time)

1. Sign in to the [publisher management page](https://marketplace.visualstudio.com/manage).
2. Create or obtain access to the publisher ID in the manifest. If `spink-dev` is not
   yours, change the manifest publisher before rebuilding and testing both artifacts.
3. Configure publishing authentication. Current VS Code guidance recommends Microsoft
   Entra ID with workload identity federation for automation. Authorized publishers
   can also upload the tested VSIX through the management page.

See the [official publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
It states that global Azure DevOps PATs retire on December 1, 2026; do not establish
a new long-lived PAT-based automation pipeline. No credentials belong in this repo
or npm package.

## Explicit publication

Only after release approval, publish the tested VSIX without rebuilding it:

```sh
npm run publish:vscode -- --azure-credential
```

This delegates to `vsce publish --packagePath .artifacts/whymark-vscode.vsix` and
requires configured publisher access. Alternatively upload that VSIX in publisher
management. This repository does not provision publisher accounts or identities.

Publish the npm package separately with `npm publish` after reviewing its packed
contents; its prepack lifecycle rebuilds the bundled extension. Neither publication
runs as part of normal builds, tests, packing, or installation. No release was made
while implementing these commands.

After Marketplace publication users can install from the editor UI, run
`code --install-extension spink-dev.whymark`, or use
`npx whymark vscode install --marketplace`. Marketplace and npm have independent
release timing; bundled installation always uses the artifact shipped with npm.
