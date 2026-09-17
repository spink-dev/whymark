import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
const cli = resolve("dist/whymark.mjs");
async function until(check: () => boolean, timeout = 12000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("Timed out waiting for quality watcher");
    await new Promise(done => setTimeout(done, 30));
  }
}
it("cancels superseded scans and publishes only the latest source in watch mode", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "whymark-watch-"));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    execFileSync("git", ["init", "-q"], { cwd });
    mkdirSync(join(cwd, "reviews")); mkdirSync(join(cwd, ".artifacts"));
    writeFileSync(join(cwd, "reviews/check.whymark"), "---\nwhymark: 1\ntitle: watch\n---\n");
    writeFileSync(join(cwd, "input.txt"), "old");
    writeFileSync(join(cwd, "check.cjs"), `const fs = require('node:fs'); const value = fs.readFileSync('input.txt', 'utf8'); fs.appendFileSync('.artifacts/started', value+'\\n'); setTimeout(() => console.log(value), 2500);`);
    writeFileSync(join(cwd, "whymark.config.json"), JSON.stringify({ version: 1, checks: [{ id: "check", format: "check", command: "node check.cjs", versionCommand: "node --version" }] }));
    child = spawn(process.execPath, [cli, "quality", "reviews/check.whymark", "--run", "--watch", "--write"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let error = "";
    child.stdout!.on("data", data => { output += data; });
    child.stderr!.on("data", data => { error += data; });
    await until(() => existsSync(join(cwd, ".artifacts/started")));
    writeFileSync(join(cwd, "input.txt"), "new");
    await until(() => output.includes('"checks"'));
    const report = JSON.parse(output);
    expect(error).toBe("");
    expect(readFileSync(join(cwd, report.checks[0].outputArtifact), "utf8").trim()).toBe("new");
    expect(report.source).toBe(report.sourceAfter);
    expect(readFileSync(join(cwd, "reviews/check.whymark"), "utf8")).toContain("quality:");
  } finally {
    if (child && child.exitCode === null) {
      const closed = new Promise(done => child!.once("close", done));
      child.kill("SIGTERM"); await closed;
    }
    rmSync(cwd, { recursive: true, force: true });
  }
}, 20000);

it("imports ESLint findings without executing a review's embedded commands", () => {
  const cwd = mkdtempSync(join(tmpdir(), "whymark-import-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd }); mkdirSync(join(cwd, "reviews"));
    writeFileSync(join(cwd, "reviews/check.whymark"), '---\nwhymark: 1\ntitle: import\nchecks:\n - cmd: touch unexpected-execution\n   status: pass\n---\n');
    writeFileSync(join(cwd, "eslint.json"), JSON.stringify([{ filePath: "a.js", messages: [{ ruleId: "complexity", severity: 1, message: "Complexity is 20", line: 1 }] }]));
    const result = spawnSync(process.execPath, [cli, "quality", "reviews/check.whymark", "--import", "eslint.json", "--write"], { cwd, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).provenance).toBe("imported");
    expect(existsSync(join(cwd, "unexpected-execution"))).toBe(false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
