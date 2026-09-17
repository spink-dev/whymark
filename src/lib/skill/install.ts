import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";

export interface InstallOptions {
  packageRoot: string;
  cwd: string;
  agents?: string[];
  global?: boolean;
  home?: string;
  force?: boolean;
  dryRun?: boolean;
}

export function installSkill(options: InstallOptions): Array<{ path: string; action: string }> {
  const agents = [...new Set(options.agents?.length ? options.agents : ["codex"])];
  if (agents.some(agent => !["codex", "claude-code"].includes(agent))) {
    throw new Error("Supported agents: codex, claude-code.");
  }
  const base = realpathSync(options.global ? options.home ?? homedir() : options.cwd);
  const skill = readFileSync(join(options.packageRoot, ".agents/skills/whymark/SKILL.md"), "utf8")
    .replaceAll("spec/whymark-v1.md", "references/whymark-v1.md");
  const assets = [
    ["SKILL.md", skill],
    ["references/whymark-v1.md", readFileSync(join(options.packageRoot, "spec/whymark-v1.md"), "utf8")],
  ];
  const pending: Array<{ path: string; content: string; action: string }> = [];
  for (const agent of agents) {
    const destination = join(base, agent === "codex" ? ".agents" : ".claude", "skills/whymark");
    for (const [name, content] of assets) {
      const path = resolve(destination, name);
      assertNoSymlinks(base, path);
      const identical = existsSync(path) && readFileSync(path, "utf8") === content;
      if (!identical && existsSync(path) && !options.force) {
        throw new Error(`Refusing to overwrite ${path}. Use --force to replace this skill explicitly.`);
      }
      pending.push({ path, content, action: identical ? "unchanged" : existsSync(path) ? "replace" : "create" });
    }
  }
  if (!options.dryRun) {
    for (const file of pending) {
      if (file.action === "unchanged") continue;
      assertNoSymlinks(base, file.path);
      mkdirSync(dirname(file.path), { recursive: true });
      writeFileSync(file.path, file.content, { flag: file.action === "create" ? "wx" : "w" });
    }
  }
  return pending.map(({ path, action }) => ({ path, action }));
}

function assertNoSymlinks(base: string, path: string) {
  const parts = relative(base, path).split(sep);
  if (parts.includes("..")) throw new Error("Skill destination escapes its installation directory.");
  let current = base;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    let info;
    try { info = lstatSync(current); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`Refusing symlink destination ${current}.`);
    if (index < parts.length - 1 ? !info.isDirectory() : !info.isFile()) {
      throw new Error(`Unexpected destination type at ${current}.`);
    }
  }
}
