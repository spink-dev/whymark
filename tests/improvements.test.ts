import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseWhymark } from "../src/lib/whymark/parse";
import { serializeWhymark } from "../src/lib/whymark/serialize";
import { buildRows } from "../src/lib/whymark/align";
import { DEFAULT_PREFERENCES, parsePreferences } from "../src/lib/review-preferences";

const fixture = readFileSync("tests/fixtures/multiple-notes.whymark", "utf8");

describe("overlapping annotations and urgency", () => {
  it("attaches every annotation to the exact side and range", () => {
    const rows = buildRows(parseWhymark(fixture).files[0]);
    expect(rows.find(row => row.newLine === 1)?.noteIds).toEqual(["security", "intent", "overlap"]);
    expect(rows.find(row => row.oldLine === 1)?.noteIds).toEqual(["old-security"]);
  });
  it("writes urgency as a v1-compatible field, including header input", () => {
    const doc = parseWhymark(fixture.replace("kind=security risk=high", "kind=security urgency=urgent risk=high"));
    expect(doc.files[0].notes[0].urgency).toBe("urgent");
    const text = serializeWhymark(doc);
    expect(text).not.toContain("urgency=");
    expect(parseWhymark(text).files[0].notes[0].urgency).toBe("urgent");
  });
  it("preserves unknown urgency and accepts legacy notes without it", () => {
    const doc = parseWhymark(fixture.replace("urgency: urgent", "urgency: eventually"));
    expect(doc.files[0].notes[0].urgency).toBeUndefined();
    expect(doc.diagnostics.some(item => item.code === "urgency-unknown")).toBe(true);
    expect(serializeWhymark(doc)).toContain("urgency: eventually");
    expect(doc.files[0].notes[2].urgency).toBeUndefined();
    const header = parseWhymark(fixture.replace("kind=security risk=high", "kind=security urgency=future risk=high").replace("urgency: urgent\n", ""));
    expect(serializeWhymark(header)).toContain("urgency: future");
  });
});

describe("viewer preferences", () => {
  it("ignores invalid storage and unrelated keys", () => {
    expect(parsePreferences("invalid")).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('{"version":2,"syncScroll":false}')).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('{"version":1,"syncScroll":false,"code":"private","collapseNotes":"no"}')).toEqual({ ...DEFAULT_PREFERENCES, syncScroll: false });
  });
});
