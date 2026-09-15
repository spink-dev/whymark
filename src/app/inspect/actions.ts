"use server";

import { parseWhymark } from "@/lib/whymark/parse";
import { validateDocument } from "@/lib/whymark/validate";
import { buildReviewVM, type ReviewVM } from "@/lib/view-model";
import type { Diagnostic } from "@/lib/whymark/types";

export interface RenderResult {
  review: ReviewVM;
  issues: Diagnostic[];
}

/** Renders a pasted document without writing it anywhere. */
export async function renderPasted(text: string): Promise<RenderResult> {
  const doc = parseWhymark(text, { filename: "pasted.whymark" });
  const validation = validateDocument(doc, { skipStaleness: true });
  return { review: await buildReviewVM(doc), issues: validation.diagnostics };
}
