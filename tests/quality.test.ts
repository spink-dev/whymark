import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseESLint, parseBoundedJson, readQuality } from "../src/lib/quality/import";
import { applySuppressions, compareFindings, identifyFindings } from "../src/lib/quality/baseline";
import { readConfig, runTool, scanQuality } from "../src/lib/quality/run";
import { parseWhymark } from "../src/lib/whymark/parse";
import type { QualityFinding, QualityReport } from "../src/lib/quality/types";
const dirs: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "whymark-quality-")); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const finding: QualityFinding = { id: "", tool: "eslint", rule: "complexity", severity: "warning", message: "Too complex", path: "a.ts", line: 2, endLine: 3, status: "uncompared" };
function report(findings = [finding]): QualityReport {
  return { version: 1, ran: new Date().toISOString(), source: "a".repeat(64), sourceAfter: "a".repeat(64), head: "b".repeat(40), clean: true, base: "b".repeat(40), reviewHash: "c".repeat(64), provenance: "local-run", comparison: "unavailable", checks: [{ id: "eslint", command: "eslint", version: "9", status: "pass", exitCode: 0, outputHash: "d".repeat(64), outputArtifact: "output.log", detail: "" }], findings };
}
describe("quality import", () => {
  it("normalizes locations and rejects malformed/unsafe/oversized reports", () => {
    const json = JSON.stringify([{ filePath: "a.ts", messages: [{ ruleId: "complexity", severity: 1, message: "Too complex", line: 2 }] }]);
    expect(parseESLint(json, name => name)[0]).toMatchObject({ path: "a.ts", severity: "warning", line: 2 });
    expect(() => parseESLint(json, () => "../outside")).toThrow(/escapes/);
    expect(() => parseESLint('[{"filePath":"a.ts","messages":[{}]}]', name => name)).toThrow(/Malformed/);
    expect(() => parseBoundedJson("x".repeat(8 * 1024 * 1024 + 1))).toThrow(/8 MB/);
    expect(readQuality({ ...report(), findings: [{ ...finding, helpUrl: "javascript:alert(1)" }] })).toBeNull();
    expect(readQuality(report())).not.toBeNull();
    expect(readQuality({ ...report(), findings: [{ ...finding, suppression: null }] })).toBeNull();
  });
});
describe("baseline comparison", () => {
  it("distinguishes existing, new and resolved findings across shifts and renames", () => {
    const before = report([finding, { ...finding, rule: "removed" }]);
    const after = report([{ ...finding, path: "b.ts", line: 20, endLine: 21 }, { ...finding, rule: "new" }]);
    const result = compareFindings(after, before, new Map([["a.ts", "b.ts"]]));
    expect(result.comparison).toBe("available");
    expect(result.findings.map(f => f.status)).toEqual(["existing", "new", "resolved"]);
  });
  it("does not claim a clean baseline after failures or a different source revision", () => {
    const before = report(); before.checks[0].status = "unavailable";
    expect(compareFindings(report(), before).comparison).toBe("unavailable");
    expect(compareFindings({ ...report(), base: "different" }, report()).findings[0].status).toBe("uncompared");
    expect(compareFindings(report(), { ...report(), clean: false }).comparison).toBe("unavailable");
    expect(compareFindings(report(), null).comparison).toBe("unavailable");
  });
  it("only applies suppressions with a reason and a future expiry", () => {
    const findings = identifyFindings([finding]);
    expect(applySuppressions(findings, [{ id: findings[0].id, reason: "legacy", expires: "2000-01-01" }])[0].suppression).toBeUndefined();
    expect(applySuppressions(findings, [{ id: findings[0].id, reason: "legacy", expires: "2100-01-01" }])[0].suppression?.reason).toBe("legacy");
  });
});
describe("configured checks", () => {
  it("runs the installed ESLint against a real temporary project", async () => {
    const cwd = temp(); execFileSync("git", ["init", "-q"], { cwd });
    writeFileSync(join(cwd, "a.js"), "const unused = 1;\n");
    writeFileSync(join(cwd, "eslint.config.mjs"), 'export default [{rules: {"no-unused-vars": "error"}}];');
    const executable = JSON.stringify(resolve("node_modules/eslint/bin/eslint.js"));
    execFileSync("git", ["add", "a.js", "eslint.config.mjs"], { cwd });
    execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Baseline"], { cwd });
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
    const doc = parseWhymark(`---\nwhymark: 1\ntitle: test\nbase: HEAD@${head.slice(0, 7)}\n---\n`);
    const result = await scanQuality(doc, cwd, { version: 1, checks: [{ id: "eslint", format: "eslint", command: `node ${executable} . --format json`, versionCommand: `node ${executable} --version` }] });
    expect(result.checks[0].status).toBe("fail");
    expect(result.findings[0]).toMatchObject({ rule: "no-unused-vars", path: "a.js", status: "uncompared" });
    expect(result.source).toBe(result.sourceAfter);
    expect(readQuality(result)).not.toBeNull();
    expect(result.clean).toBe(true);
    expect(result.base).toBe(head);
    writeFileSync(join(cwd, "a.js"), "\n\nconst unused = 1;\n");
    const changed = await scanQuality(doc, cwd, { version: 1, checks: [{ id: "eslint", format: "eslint", command: `node ${executable} . --format json`, versionCommand: `node ${executable} --version` }] }, { baseline: result });
    expect(changed.comparison).toBe("available");
    expect(changed.findings[0].status).toBe("existing");
  });
  it("reports missing tools, enforces bounded output and cancels a running process", async () => {
    const cwd = temp();
    expect((await runTool("whymark-nonexistent-command", cwd)).unavailable).toBe(true);
    const controller = new AbortController();
    const promise = runTool('node -e "setTimeout(() => {}, 20000)"', cwd, controller.signal);
    setTimeout(() => controller.abort(), 30);
    expect((await promise).unavailable).toBe(true);
    expect((await runTool('node -e "process.stdout.write(\'x\'.repeat(9*1024*1024))"', cwd)).unavailable).toBe(true);
  });
  it("rejects malformed configuration and never silently runs imported commands", () => {
    const cwd = temp(); mkdirSync(join(cwd, "reviews"));
    const path = join(cwd, "whymark.config.json"); writeFileSync(path, '{"version":1,"checks":[]}');
    expect(() => readConfig(path)).toThrow(/Invalid/);
    const doc = parseWhymark('---\nwhymark: 1\ntitle: hostile\nchecks:\n  - cmd: touch never-run\n    status: pass\n---\n');
    expect(doc.meta.checks[0].cmd).toBe("touch never-run");
  });
});
