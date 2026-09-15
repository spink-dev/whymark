import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../src/lib/whymark/git";
import {
  addedLines,
  applyDecisions,
  deletedLines,
  hunkNewRange,
  hunkNewText,
  isActionable,
  replaceRange,
  summarize,
} from "../src/lib/whymark/edit";

// A change that adds two lines, removes one, and leaves context alone.
const DIFF = `diff --git a/greet.ts b/greet.ts
--- a/greet.ts
+++ b/greet.ts
@@ -1,5 +1,6 @@
 export function greet(name: string) {
-  return "hi " + name;
+  const trimmed = name.trim();
+  return \`hello \${trimmed}\`;
 }
 
 export const VERSION = 1;
`;

const [file] = parseUnifiedDiff(DIFF);

// The file as it exists on disk after the change, i.e. the diff's new side.
const CURRENT = [
  "export function greet(name: string) {",
  "  const trimmed = name.trim();",
  '  return `hello ${trimmed}`;',
  "}",
  "",
  "export const VERSION = 1;",
  "",
].join("\n");

describe("decision model", () => {
  it("locates added lines by their new-side number", () => {
    expect(addedLines(file.hunks)).toEqual([2, 3]);
  });

  it("pins each deletion to the line it followed", () => {
    expect(deletedLines(file.hunks)).toEqual([
      { oldLine: 2, text: '  return "hi " + name;', afterNewLine: 1 },
    ]);
  });
});

describe("applyDecisions", () => {
  it("returns the file untouched when nothing is rejected", () => {
    const result = applyDecisions(CURRENT, file.hunks, {
      discardAdded: [],
      restoreDeleted: [],
    });
    expect(result.text).toBe(CURRENT);
    expect(result).toMatchObject({ discarded: 0, restored: 0 });
  });

  it("drops a single added line and leaves the rest alone", () => {
    const result = applyDecisions(CURRENT, file.hunks, {
      discardAdded: [2],
      restoreDeleted: [],
    });
    expect(result.text.split("\n")).toEqual([
      "export function greet(name: string) {",
      '  return `hello ${trimmed}`;',
      "}",
      "",
      "export const VERSION = 1;",
      "",
    ]);
    expect(result.discarded).toBe(1);
  });

  it("puts a removed line back where it was", () => {
    const result = applyDecisions(CURRENT, file.hunks, {
      discardAdded: [],
      restoreDeleted: [2],
    });
    expect(result.text.split("\n")[1]).toBe('  return "hi " + name;');
    expect(result.restored).toBe(1);
  });

  it("reverts the whole change when every part of it is rejected", () => {
    const result = applyDecisions(CURRENT, file.hunks, {
      discardAdded: [2, 3],
      restoreDeleted: [2],
    });
    expect(result.text).toBe(
      [
        "export function greet(name: string) {",
        '  return "hi " + name;',
        "}",
        "",
        "export const VERSION = 1;",
        "",
      ].join("\n"),
    );
  });

  it("keeps the file's trailing newline as it found it", () => {
    const noNewline = CURRENT.trimEnd();
    const result = applyDecisions(noNewline, file.hunks, {
      discardAdded: [2],
      restoreDeleted: [],
    });
    expect(result.text.endsWith("\n")).toBe(false);
    expect(applyDecisions(CURRENT, file.hunks, { discardAdded: [2], restoreDeleted: [] }).text.endsWith("\n")).toBe(
      true,
    );
  });

  it("restores a deletion that belonged before the first line", () => {
    const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,1 @@
-// header
 code();
`;
    const [only] = parseUnifiedDiff(diff);
    expect(deletedLines(only.hunks)[0].afterNewLine).toBe(0);
    const result = applyDecisions("code();\n", only.hunks, {
      discardAdded: [],
      restoreDeleted: [1],
    });
    expect(result.text).toBe("// header\ncode();\n");
  });
});

describe("replaceRange", () => {
  it("swaps a run of lines for edited text", () => {
    const next = replaceRange(CURRENT, 2, 3, "  return `hey ${name}`;");
    expect(next.split("\n").slice(0, 4)).toEqual([
      "export function greet(name: string) {",
      "  return `hey ${name}`;",
      "}",
      "",
    ]);
  });

  it("accepts multi-line replacements", () => {
    const next = replaceRange(CURRENT, 2, 2, "  const a = 1;\n  const b = 2;");
    expect(next.split("\n").slice(1, 3)).toEqual(["  const a = 1;", "  const b = 2;"]);
  });

  it("refuses a range outside the file", () => {
    expect(() => replaceRange(CURRENT, 2, 99, "x")).toThrow(/past the end/);
    expect(() => replaceRange(CURRENT, 0, 1, "x")).toThrow(/Invalid range/);
  });
});

describe("editing surface", () => {
  it("offers the new side of a hunk as the starting text", () => {
    expect(hunkNewText(file.hunks[0]).split("\n")[1]).toBe("  const trimmed = name.trim();");
    expect(hunkNewRange(file.hunks[0])).toEqual([1, 6]);
  });

  it("only acts on a file that still matches the review", () => {
    const section = { newSha: "1a9c4e2", binary: false, status: "modified" as const };
    expect(isActionable(section, "1a9c4e2f8b")).toBe(true);
    expect(isActionable(section, "deadbeef")).toBe(false);
    expect(isActionable(section, null)).toBe(false);
    expect(isActionable({ ...section, binary: true }, "1a9c4e2")).toBe(false);
  });

  it("summarizes decisions across files", () => {
    expect(
      summarize({
        "a.ts": { discardAdded: [1, 2], restoreDeleted: [] },
        "b.ts": { discardAdded: [], restoreDeleted: [7] },
        "c.ts": { discardAdded: [], restoreDeleted: [] },
      }),
    ).toEqual({ files: 2, discarded: 2, restored: 1 });
  });
});
