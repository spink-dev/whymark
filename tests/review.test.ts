import { describe, expect, it } from "vitest";
import { parseCrev } from "../src/lib/crev/parse";
import { parseUnifiedDiff } from "../src/lib/crev/git";
import { computeStats } from "../src/lib/crev/stats";
import { validateDocument } from "../src/lib/crev/validate";
import {
  anchorsFor,
  buildRows,
  buildSplitRows,
  layoutCards,
  layoutRail,
} from "../src/lib/crev/align";

const DOC = `---
crev: 1
title: Add a rate limiter
summary: Adds a fixed-window limiter to the public API.
---

@file src/limiter.ts added +6
@@ -0,0 +1,6 @@
+export function limit(key: string) {
+  const hits = bump(key);
+  if (hits > 100) throw new TooMany();
+  return hits;
+}
+// trailing

@note +1..4 kind=intent risk=high
why: The public API had no ceiling, so one client could exhaust the pool.
source: file:src/config.ts:14 — the 100/min number comes from here
verify: cmd \`npm test -- limiter\` => pass

@note +6 kind=generated
why: Marker comment kept so the codegen boundary stays visible.
verify: none
`;

describe("stats", () => {
  const stats = computeStats(parseCrev(DOC));

  it("measures coverage over added lines only", () => {
    expect(stats.added).toBe(6);
    expect(stats.covered).toBe(5);
    expect(stats.coverage).toBeCloseTo(5 / 6);
  });

  it("counts a line as verified only when its note has a passing check", () => {
    expect(stats.verified).toBe(4);
    expect(stats.verifiedCoverage).toBeCloseTo(4 / 6);
  });

  it("separates sourced notes from inference-only ones", () => {
    expect(stats.sourced).toBe(1);
    expect(stats.inferenceOnly).toBe(0);
    expect(stats.byRisk.high).toBe(1);
  });
});

describe("validate", () => {
  it("passes a complete review", () => {
    const result = validateDocument(parseCrev(DOC), { skipStaleness: true });
    expect(result.errors).toBe(0);
    expect(result.ok).toBe(true);
  });

  it("fails when coverage is below the threshold", () => {
    const result = validateDocument(parseCrev(DOC), {
      skipStaleness: true,
      minCoverage: 0.9,
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "coverage-below-threshold")).toBe(true);
  });

  it("warns about generated placeholder text left in a note", () => {
    const doc = parseCrev(`---
crev: 1
title: t
summary: real summary
---

@file a.ts added +1
@@ -0,0 +1 @@
+const x = 1;

@note +1 kind=intent
why: TODO: why this code is the way it is. Not what it does.
`);
    const result = validateDocument(doc, { skipStaleness: true });
    expect(result.diagnostics.some((d) => d.code === "note-stub")).toBe(true);
  });

  it("warns when a high-risk note has nothing backing it", () => {
    const doc = parseCrev(`---
crev: 1
title: t
summary: real summary
---

@file a.ts added +1
@@ -0,0 +1 @@
+eval(input);

@note +1 kind=security risk=high
why: We evaluate caller input because the DSL is not sandboxed yet.
verify: none
`);
    const result = validateDocument(doc, { skipStaleness: true });
    expect(result.diagnostics.some((d) => d.code === "high-risk-unverified")).toBe(true);
  });
});

describe("unified diff import", () => {
  const raw = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export { a, b };
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 3333333..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const gone = true;
-export default gone;
diff --git a/src/old.ts b/src/new.ts
similarity index 92%
rename from src/old.ts
rename to src/new.ts
index 4444444..5555555 100644
--- a/src/old.ts
+++ b/src/new.ts
@@ -1 +1 @@
-export const name = "old";
+export const name = "new";
`;
  const files = parseUnifiedDiff(raw);

  it("reads status, shas and counts", () => {
    expect(files.map((f) => f.path)).toEqual(["src/a.ts", "src/gone.ts", "src/new.ts"]);
    expect(files[0]).toMatchObject({ status: "modified", added: 2, removed: 1 });
    expect(files[0].oldSha).toBe("1111111");
    expect(files[0].newSha).toBe("2222222");
    expect(files[1].status).toBe("deleted");
    expect(files[2]).toMatchObject({ status: "renamed", oldPath: "src/old.ts" });
  });

  it("assigns line numbers on both sides", () => {
    const lines = files[0].hunks[0].lines;
    expect(lines.map((l) => [l.type, l.oldLine, l.newLine])).toEqual([
      ["context", 1, 1],
      ["del", 2, undefined],
      ["add", undefined, 2],
      ["add", undefined, 3],
      ["context", 3, 4],
    ]);
  });
});

describe("alignment", () => {
  const doc = parseCrev(DOC);
  const file = doc.files[0];

  it("attaches note ids to the rows their selector covers", () => {
    const rows = buildRows(file);
    const withNotes = rows.filter((r) => r.noteIds.length);
    expect(withNotes).toHaveLength(5);
    expect(rows.find((r) => r.newLine === 6)?.noteIds).toEqual(["n2"]);
  });

  it("pairs removals with additions in split view", () => {
    const split = buildSplitRows(
      parseUnifiedDiff(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
-old line
+new line
 same
`)[0],
    );
    const pair = split.find((r) => r.kind === "pair")!;
    expect(pair.left).toMatchObject({ kind: "del", text: "old line", line: 1 });
    expect(pair.right).toMatchObject({ kind: "add", text: "new line", line: 1 });
  });

  it("places cards at their line and pushes colliding ones down", () => {
    const rows = buildRows(file);
    const anchors = anchorsFor(rows, file.notes);
    const tops = layoutCards(anchors, () => 200, (row) => row * 20, 10);
    expect(tops.get("n1")).toBe(20);
    // n2 wants row 6 (=140) but n1 is 200 tall, so it is pushed below it.
    expect(tops.get("n2")).toBe(230);
  });

  it("opens space in the code so every card starts level with its own line", () => {
    const rows = buildRows(file);
    const anchors = anchorsFor(rows, file.notes);
    const rail = layoutRail(anchors, () => 200, rows.length, 20, 10);

    for (const anchor of anchors) {
      const lineTop = anchor.startRow * 20 + rail.offsets[anchor.startRow];
      expect(rail.tops.get(anchor.noteId)).toBe(lineTop);
    }

    // Padding is only opened where a tall card would otherwise have collided.
    expect([...rail.padding.values()].every((pad) => pad > 0)).toBe(true);
    expect(rail.height).toBeGreaterThan(rows.length * 20);
  });

  it("leaves the code untouched when the cards already fit", () => {
    const rows = buildRows(file);
    const anchors = anchorsFor(rows, file.notes);
    const rail = layoutRail(anchors, () => 8, rows.length, 20, 10);
    expect(rail.padding.size).toBe(0);
    expect(rail.height).toBe(rows.length * 20);
  });
});
