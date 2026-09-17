import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installSkill } from "../src/lib/skill/install";
const dirs: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "whymark-skill-")); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const packageRoot = resolve(".");
describe("npm skill installer", () => {
  it("previews, installs both agents, and is idempotent", () => {
    const cwd = temp();
    const options = { packageRoot, cwd, agents: ["codex", "claude-code"] };
    expect(installSkill({ ...options, dryRun: true }).every(item => item.action === "create")).toBe(true);
    expect(installSkill(options)).toHaveLength(4);
    expect(installSkill(options).every(item => item.action === "unchanged")).toBe(true);
    expect(readFileSync(join(cwd, ".agents/skills/whymark/SKILL.md"), "utf8")).toContain("references/whymark-v1.md");
    expect(readFileSync(join(cwd, ".claude/skills/whymark/references/whymark-v1.md"), "utf8")).toContain("Annotations");
  });
  it("preflights conflicts before writing another target", () => {
    const cwd = temp();
    mkdirSync(join(cwd, ".claude/skills/whymark"), { recursive: true });
    writeFileSync(join(cwd, ".claude/skills/whymark/SKILL.md"), "custom");
    expect(() => installSkill({ packageRoot, cwd, agents: ["codex", "claude-code"] })).toThrow(/overwrite/);
    expect(() => readFileSync(join(cwd, ".agents/skills/whymark/SKILL.md"))).toThrow();
    installSkill({ packageRoot, cwd, agents: ["claude-code"], force: true });
  });
  it("rejects symlink destinations even with force and scopes global installs", () => {
    const cwd = temp(); const home = temp(); const outside = temp();
    symlinkSync(outside, join(cwd, ".agents"));
    expect(() => installSkill({ packageRoot, cwd, force: true })).toThrow(/symlink/);
    const installed = installSkill({ packageRoot, cwd, home, global: true });
    expect(installed.every(item => item.path.startsWith(realpathSync(home)))).toBe(true);
  });
});
