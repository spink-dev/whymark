import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";

export interface InstallExtensionOptions {
  packageRoot: string;
  code?: string;
  dryRun?: boolean;
  marketplace?: boolean;
  extensionsDir?: string;
  userDataDir?: string;
}

function executable(candidate: string): boolean {
  try { accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK); return true; } catch { return false; }
}

export function codeLauncher(explicit?: string): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const names = explicit ? [explicit] : process.platform === "win32" ? ["code.cmd", "code.exe"] : ["code"];
  const candidates = names.flatMap(name => isAbsolute(name) || /[\\/]/.test(name) ? [resolve(name)] : (process.env.PATH ?? "").split(delimiter).filter(Boolean).map(dir => join(dir, name)));
  if (!explicit && process.platform === "darwin") candidates.push("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code", join(homedir(), "Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"));
  if (!explicit && process.platform === "win32") for (const root of [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs"), process.env.ProgramFiles]) if (root) candidates.push(join(root, "Microsoft VS Code", "Code.exe"));
  const command = candidates.find(executable);
  if (!command) throw new Error("VS Code CLI not found. Install VS Code and add 'code' to PATH, or pass --code <path-to-code>.");
  // Windows batch launchers need a shell. Invoke their native CLI directly instead,
  // preserving paths as arguments rather than interpolating them into cmd.exe.
  if (process.platform === "win32") {
    const root = /\.(cmd|bat)$/i.test(command) ? resolve(dirname(command), "..") : dirname(command);
    const native = join(root, "Code.exe");
    const cli = join(root, "resources/app/out/cli.js");
    if (!existsSync(native) || !existsSync(cli)) throw new Error("Use --code with the standard VS Code Code.exe or bin/code.cmd installation path.");
    return { command: native, args: [cli], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } };
  }
  return { command, args: [], env: process.env };
}

export function installExtension(options: InstallExtensionOptions): void {
  const metadataPath = join(options.packageRoot, "dist/vscode-extension.json");
  if (!existsSync(metadataPath)) throw new Error("Extension bundle missing. In a source checkout run npm run package:vscode; otherwise reinstall the whymark npm package.");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (!/^[a-z0-9-]+\.[a-z0-9-]+$/i.test(metadata.id) || !/^[a-f0-9]{64}$/.test(metadata.sha256)) throw new Error("Invalid bundled extension metadata. Reinstall the whymark npm package.");
  const vsix = join(options.packageRoot, "dist/whymark-vscode.vsix");
  if (!options.marketplace && createHash("sha256").update(readFileSync(vsix)).digest("hex") !== metadata.sha256) throw new Error("Bundled VSIX checksum mismatch. Reinstall the whymark npm package.");
  const launcher = codeLauncher(options.code);
  const args = [...launcher.args, "--install-extension", options.marketplace ? metadata.id : vsix];
  if (options.extensionsDir) args.push("--extensions-dir", resolve(options.extensionsDir));
  if (options.userDataDir) args.push("--user-data-dir", resolve(options.userDataDir));
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ command: launcher.command, args, source: options.marketplace ? "marketplace" : "bundled", extension: metadata.id, bundledVersion: metadata.version }, null, 2)}\n`);
    return;
  }
  const result = spawnSync(launcher.command, args, { stdio: "inherit", env: launcher.env, shell: false, timeout: 120000 });
  if (result.error) throw new Error(`VS Code installation could not complete: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`VS Code installation failed (${result.signal ?? result.status}).${options.marketplace ? " The extension must be published before Marketplace installation works." : ""}`);
  process.stdout.write(`Installed ${metadata.id}. Open the Command Palette and search for Whymark.\n`);
}
