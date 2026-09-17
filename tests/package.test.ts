import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("installs the packed skill with only npm tarballs and no Git access", () => {
  const temp = mkdtempSync(join(tmpdir(), "whymark-pack-"));
  const run = (command: string, args: string[], cwd = resolve(".")) => {
    const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, npm_config_cache: join(temp, "cache"), npm_config_offline: "true", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    return result.stdout;
  };
  try {
    const packed = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temp]))[0];
    expect(packed.files.map((f: { path: string }) => f.path)).toContain(".agents/skills/whymark/SKILL.md");
    const yaml = JSON.parse(run("npm", ["pack", "./node_modules/yaml", "--ignore-scripts", "--json", "--pack-destination", temp]))[0];
    const consumer = join(temp, "consumer"); mkdirSync(consumer);
    writeFileSync(join(consumer, "package.json"), '{"private":true}');
    run("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", join(temp, packed.filename), join(temp, yaml.filename)], consumer);
    const cli = join(consumer, "node_modules/whymark/bin/whymark.mjs");
    run(process.execPath, [cli, "skill", "install", "--agent", "codex", "--agent", "claude-code"], consumer);
    const skill = join(consumer, ".agents/skills/whymark");
    expect(existsSync(join(skill, "references/whymark-v1.md"))).toBe(true);
    expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toContain("references/whymark-v1.md");
    expect(run(process.execPath, [cli, "skill", "install"], consumer)).toContain("unchanged");
  } finally { rmSync(temp, { recursive: true, force: true }); }
}, 30000);
