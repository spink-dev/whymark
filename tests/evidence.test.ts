import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseWhymark } from "../src/lib/whymark/parse";
import { serializeWhymark } from "../src/lib/whymark/serialize";
import { verifyDocument } from "../src/lib/whymark/verify";
import { evidenceViews, readEvidence } from "../src/lib/whymark/evidence";
import { localEvidence, sourceFingerprint } from "../src/lib/whymark/evidence-node";
import { hasPassingVerify } from "../src/lib/whymark/stats";
import { collectSourceDiagnostics } from "../src/lib/whymark/validate-tree";
const dirs: string[] = [];
function repo() {
  const cwd = mkdtempSync(join(tmpdir(), "whymark-evidence-")); dirs.push(cwd);
  execFileSync("git", ["init", "-q"], { cwd });
  mkdirSync(join(cwd, "reviews")); mkdirSync(join(cwd, "tests"));
  writeFileSync(join(cwd, "file.ts"), "const a = 1;\n");
  writeFileSync(join(cwd, "tests/fixture.whymark"), "test input");
  return cwd;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const input = `---
whymark: 1
title: evidence
checks:
  - cmd: node -e "console.log('checked')"
    status: pass
---
@file file.ts added +1
@@ -0,0 +1 @@
+const a = 1;
@note +1 id=reason
why: Preserve an explicit local value.
verify: cmd \`node -e "process.exit(1)"\` => pass
`;

describe("verification evidence", () => {
  it("records output and source identity, preserves contradiction, detects stale tests", () => {
    const cwd = repo(); const doc = parseWhymark(input);
    const results = verifyDocument(doc, { cwd, recordEvidence: true, toolVersion: "test" });
    expect(results.map(r => r.outcome)).toEqual(["confirmed", "contradicted"]);
    const serialized = serializeWhymark(doc);
    writeFileSync(join(cwd, "reviews/test.whymark"), serialized);
    const reread = parseWhymark(serialized);
    expect(readEvidence(reread.meta.extra.evidence)).toHaveLength(2);
    expect(localEvidence(reread, cwd).map(r => r.state)).toEqual(["current", "current"]);
    expect(localEvidence(reread, cwd)[1].contradicted).toBe(true);
    expect(evidenceViews(reread)[0].state).toBe("imported");
    writeFileSync(join(cwd, "tests/fixture.whymark"), "changed test input");
    expect(localEvidence(reread, cwd).every(r => r.state === "stale")).toBe(true);
  });
  it("never upgrades a fabricated claim or conflicting claims into fresh proof", () => {
    const doc = parseWhymark(input);
    expect(evidenceViews(doc)).toEqual([]);
    const note = doc.files[0].notes[0];
    note.verify.push({ method: "manual", status: "fail", raw: "manual => fail" });
    expect(hasPassingVerify(note)).toBe(false);
    expect(readEvidence([{ version: 1, status: "pass" }])).toEqual([]);
  });
  it("treats missing artifacts, timeout and mutation during verification as unavailable/stale", () => {
    const cwd = repo(); const doc = parseWhymark(input);
    doc.meta.checks = [{ cmd: 'node -e "setTimeout(() => {}, 10000)"', status: "unknown" }]; doc.files[0].notes[0].verify = [];
    const results = verifyDocument(doc, { cwd, timeoutMs: 30, recordEvidence: true });
    expect(results[0].outcome).toBe("unrunnable");
    expect(localEvidence(doc, cwd)[0].state).toBe("unavailable");
    doc.meta.checks = [{ cmd: 'node -e "require(\'fs\').writeFileSync(\'file.ts\', \'changed\')"', status: "unknown" }];
    verifyDocument(doc, { cwd, recordEvidence: true });
    expect(localEvidence(doc, cwd).at(-1)?.state).toBe("stale");
    const fresh = parseWhymark(input); verifyDocument(fresh, { cwd, recordEvidence: true });
    const record = readEvidence(fresh.meta.extra.evidence)[0];
    expect(readFileSync(join(cwd, record.outputArtifact), "utf8")).toContain("checked");
    rmSync(join(cwd, record.outputArtifact));
    expect(localEvidence(fresh, cwd)[0].state).toBe("unavailable");
  });
  it("checks local locators without fetching URLs or executing claims", () => {
    const cwd = repo(); const doc = parseWhymark(input + '\nsource: file:file.ts:99\nsource: file:../outside\nsource: url:http://127.0.0.1/private\n');
    expect(collectSourceDiagnostics(doc, cwd)).toHaveLength(2);
    expect(sourceFingerprint(cwd)).toMatch(/^[a-f0-9]{64}$/);
  });
});
