import { existsSync } from 'node:fs';
import { runTests } from '@vscode/test-electron';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
let root = resolve('extensions/vscode');
const temp = await mkdtemp(join(tmpdir(), 'whymark-vscode-test-'));
const workspace = join(temp, 'workspace');
await import('node:fs/promises').then(fs => fs.mkdir(workspace));
const git = (...args) => execFileSync('git', args, { cwd: workspace });
git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Extension Test'); git('config', 'user.email', 'test@example.com');
await writeFile(join(workspace, 'sample.ts'), 'export const value = "base";\n'); git('add', '.'); git('commit', '-qm', 'base');
await writeFile(join(workspace, 'sample.ts'), 'export const value = "staged";\n'); git('add', '.');
await writeFile(join(workspace, 'sample.ts'), 'export const value = "unstaged";\n');
await build({ entryPoints: ['extensions/vscode/src/test-host.ts'], outfile: join(temp, 'test-host.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['vscode'] });
try {
  if (process.env.WHYMARK_VSIX) {
    const cli = process.env.VSCODE_CLI_PATH || '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
    execFileSync(cli, ['--user-data-dir', join(temp, 'user'), '--extensions-dir', join(temp, 'extensions'), '--install-extension', resolve(process.env.WHYMARK_VSIX)], { stdio: 'inherit' });
    root = join(temp, 'extensions', 'spink-dev.whymark-0.1.0');
  }
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH || (existsSync('/Applications/Visual Studio Code.app/Contents/MacOS/Code') ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : undefined),
    extensionDevelopmentPath: root, extensionTestsPath: join(temp, 'test-host.cjs'),
    launchArgs: [workspace, '--user-data-dir', join(temp, 'user'), '--extensions-dir', join(temp, 'extensions'), '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-extensions'],
    extensionTestsEnv: { WHYMARK_TEST_ROOT: workspace },
  });
} finally { await rm(temp, { recursive: true, force: true }); }
