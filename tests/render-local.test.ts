import { describe, expect, it } from "vitest";
import { historyMeta, renderLocal } from "../src/lib/render-local";
import { SAMPLE_WHYMARK } from "../src/lib/sample-review";

describe("renderLocal", () => {
  it("parses the sample in-process, without a server", async () => {
    const result = await renderLocal(SAMPLE_WHYMARK);
    expect(result.review.meta.title).toBe("Reject expired invite tokens");
    expect(result.review.files.length).toBe(1);
    expect(result.review.files[0].actionable).toBe(false);
  });

  it("refuses a file over 2 MB", async () => {
    const huge = `${"x".repeat(2 * 1024 * 1024 + 10)}`;
    await expect(renderLocal(huge)).rejects.toThrow(/2 MB/);
  });
});

describe("historyMeta", () => {
  it("reads title and coverage from the document", () => {
    const meta = historyMeta(SAMPLE_WHYMARK);
    expect(meta.title).toBe("Reject expired invite tokens");
    expect(meta.files).toBe(1);
    expect(meta.coverage).toBeGreaterThan(0);
  });
});
