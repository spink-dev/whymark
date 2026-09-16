import { parseWhymark } from "./whymark/parse";
import { computeStats } from "./whymark/stats";
import { validateDocument } from "./whymark/validate";
import { buildReviewVM, type ReviewVM } from "./view-model";
import type { Diagnostic } from "./whymark/types";

export interface RenderResult {
  review: ReviewVM;
  issues: Diagnostic[];
}

const MAX_BYTES = 2 * 1024 * 1024;

/** Parse and layout a .whymark document in the browser. Nothing is sent to a server. */
export async function renderLocal(text: string, filename = "pasted.whymark"): Promise<RenderResult> {
  if (new TextEncoder().encode(text).length > MAX_BYTES) {
    throw new Error("That file is larger than 2 MB. Trim it or open it locally with npm run dev.");
  }
  const doc = parseWhymark(text, { filename });
  const validation = validateDocument(doc);
  return { review: await buildReviewVM(doc), issues: validation.diagnostics };
}

export function historyMeta(text: string) {
  const doc = parseWhymark(text, { filename: "history.whymark" });
  const stats = computeStats(doc);
  return {
    title: doc.meta.title || "Untitled review",
    author: doc.meta.author,
    summary: doc.meta.summary?.replace(/\s+/g, " ").trim(),
    coverage: stats.coverage,
    files: stats.files,
    added: stats.added,
    removed: stats.removed,
  };
}
