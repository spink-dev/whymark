import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../src/lib/whymark/git";
import {
  applyPartReverts,
  inlineParts,
  linePairs,
  partsByNewLine,
  tokenizeInline,
} from "../src/lib/whymark/inline";
import {
  applyDecisions,
  hasPart,
  summarize,
  togglePart,
  type FileDecisions,
} from "../src/lib/whymark/edit";

describe("tokenizeInline", () => {
  it("keeps identifiers whole and punctuation separate", () => {
    expect(tokenizeInline("const a_1 = f(x);")).toEqual([
      "const",
      " ",
      "a_1",
      " ",
      "=",
      " ",
      "f",
      "(",
      "x",
      ")",
      ";",
    ]);
  });
});

describe("inlineParts", () => {
  it("finds two independent changes on one line", () => {
    const parts = inlineParts(
      "const bucket = LIMIT * 2;",
      "const window = LIMIT * 4;",
    );
    const changed = parts.filter((part) => part.changed);
    expect(changed).toHaveLength(2);
    expect(changed[0]).toMatchObject({ old: "bucket", new: "window" });
    expect(changed[1]).toMatchObject({ old: "2", new: "4" });
  });

  it("reverting one part keeps the other change", () => {
    const parts = inlineParts(
      "const bucket = LIMIT * 2;",
      "const window = LIMIT * 4;",
    );
    const numberPart = parts.findIndex((part) => part.new === "4");
    expect(applyPartReverts(parts, [numberPart])).toBe("const window = LIMIT * 2;");

    const renamePart = parts.findIndex((part) => part.new === "window");
    expect(applyPartReverts(parts, [renamePart])).toBe("const bucket = LIMIT * 4;");
    expect(applyPartReverts(parts, [renamePart, numberPart])).toBe(
      "const bucket = LIMIT * 2;",
    );
    expect(applyPartReverts(parts, [])).toBe("const window = LIMIT * 4;");
  });

  it("treats a pure insertion as a revertible part with no old text", () => {
    const parts = inlineParts("f(a);", "f(a, b);");
    const changed = parts.filter((part) => part.changed);
    expect(changed).toHaveLength(1);
    expect(changed[0].old).toBe("");
    expect(applyPartReverts(parts, [parts.indexOf(changed[0])])).toBe("f(a);");
  });

  it("reports character offsets that address the text they cover", () => {
    const before = "const bucket = LIMIT * 2;";
    const after = "const window = LIMIT * 4;";
    for (const part of inlineParts(before, after)) {
      expect(after.slice(part.newStart, part.newEnd)).toBe(part.new);
      expect(before.slice(part.oldStart, part.oldEnd)).toBe(part.old);
    }
  });

  it("collapses a line that changed almost entirely into one part", () => {
    const parts = inlineParts("return null;", "throw new RangeError(reason);");
    expect(parts).toHaveLength(1);
    expect(parts[0].changed).toBe(true);
  });

  it("marks an unchanged line as having nothing to revert", () => {
    expect(inlineParts("same();", "same();").some((part) => part.changed)).toBe(false);
  });
});

const DIFF = `diff --git a/limit.ts b/limit.ts
--- a/limit.ts
+++ b/limit.ts
@@ -1,4 +1,5 @@
 export function limit(key: string) {
-  const bucket = LIMIT * 2;
+  const window = LIMIT * 4;
+  log(window);
   return bucket;
 }
`;

const [file] = parseUnifiedDiff(DIFF);

const CURRENT = [
  "export function limit(key: string) {",
  "  const window = LIMIT * 4;",
  "  log(window);",
  "  return bucket;",
  "}",
  "",
].join("\n");

describe("pairing", () => {
  it("matches a replaced line to the line it replaced", () => {
    expect(linePairs(file.hunks)).toEqual([
      {
        oldLine: 2,
        newLine: 2,
        oldText: "  const bucket = LIMIT * 2;",
        newText: "  const window = LIMIT * 4;",
      },
    ]);
  });

  it("offers parts only for replaced lines, not for the added one", () => {
    const parts = partsByNewLine(file.hunks);
    expect([...parts.keys()]).toEqual([2]);
  });

  it("refuses to pair lines that share too little to be the same line edited", () => {
    const uneven = parseUnifiedDiff(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,2 @@
-callTheFirstThing(alpha);
-callTheSecondThing(beta);
+somethingCompletelyOther();
 tail();
`);
    expect(linePairs(uneven[0].hunks)).toEqual([]);
  });

  it("still pairs an edited line when a line was added beside it", () => {
    const mixed = parseUnifiedDiff(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,4 @@
 head();
-const bucket = LIMIT * 2;
+const bucket = LIMIT * 4;
+log(bucket);
 tail();
`);
    expect(linePairs(mixed[0].hunks)).toEqual([
      {
        oldLine: 2,
        newLine: 2,
        oldText: "const bucket = LIMIT * 2;",
        newText: "const bucket = LIMIT * 4;",
      },
    ]);
  });
});

describe("applyDecisions with part reverts", () => {
  it("takes one part back and leaves the rest of the new line alone", () => {
    const parts = partsByNewLine(file.hunks).get(2)!;
    const numberPart = parts.findIndex((part) => part.new === "4");

    const result = applyDecisions(CURRENT, file.hunks, {
      discardAdded: [],
      restoreDeleted: [],
      revertParts: [{ line: 2, part: numberPart }],
    });

    expect(result.text.split("\n")[1]).toBe("  const window = LIMIT * 2;");
    expect(result.partsReverted).toBe(1);
    // The separately added line is untouched.
    expect(result.text.split("\n")[2]).toBe("  log(window);");
  });

  it("rewrites the line once when two of its parts are reverted", () => {
    const parts = partsByNewLine(file.hunks).get(2)!;
    const refs = parts
      .map((part, index) => ({ part, index }))
      .filter(({ part }) => part.changed)
      .map(({ index }) => ({ line: 2, part: index }));
    expect(refs).toHaveLength(2);

    const result = applyDecisions(CURRENT, file.hunks, {
      discardAdded: [],
      restoreDeleted: [],
      revertParts: refs,
    });
    expect(result.text.split("\n")[1]).toBe("  const bucket = LIMIT * 2;");
    expect(result.partsReverted).toBe(2);
  });

  it("ignores parts on a line that is being discarded outright", () => {
    const result = applyDecisions(CURRENT, file.hunks, {
      discardAdded: [2],
      restoreDeleted: [],
      revertParts: [{ line: 2, part: 1 }],
    });
    expect(result.text.split("\n")[1]).toBe("  log(window);");
    expect(result).toMatchObject({ discarded: 1, partsReverted: 0 });
  });

  it("restores a removal while keeping the added code beside it", () => {
    const result = applyDecisions(CURRENT, file.hunks, {
      discardAdded: [],
      restoreDeleted: [2],
      revertParts: [],
    });
    // The removal happened before the additions, so it comes back above them.
    const lines = result.text.split("\n");
    expect(lines[1]).toBe("  const bucket = LIMIT * 2;");
    expect(lines[2]).toBe("  const window = LIMIT * 4;");
    expect(lines[3]).toBe("  log(window);");
  });

  it("leaves the file alone when a referenced part does not exist", () => {
    const result = applyDecisions(CURRENT, file.hunks, {
      discardAdded: [],
      restoreDeleted: [],
      revertParts: [{ line: 2, part: 99 }],
    });
    expect(result.text).toBe(CURRENT);
    expect(result.partsReverted).toBe(0);
  });
});

describe("part decisions", () => {
  it("toggles a part on and off", () => {
    let decisions: FileDecisions = { discardAdded: [], restoreDeleted: [] };
    decisions = togglePart(decisions, 2, 1);
    expect(hasPart(decisions, 2, 1)).toBe(true);
    expect(hasPart(decisions, 2, 3)).toBe(false);
    decisions = togglePart(decisions, 2, 1);
    expect(hasPart(decisions, 2, 1)).toBe(false);
  });

  it("counts reverted parts in the summary", () => {
    expect(
      summarize({
        "a.ts": { discardAdded: [], restoreDeleted: [], revertParts: [{ line: 2, part: 1 }] },
      }),
    ).toEqual({ files: 1, discarded: 0, restored: 0, parts: 1 });
  });
});
