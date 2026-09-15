"use server";

import { parseCrev } from "@/lib/crev/parse";
import { validateDocument } from "@/lib/crev/validate";
import { buildReviewVM, type ReviewVM } from "@/lib/view-model";
import type { Diagnostic } from "@/lib/crev/types";

export interface RenderResult {
  review: ReviewVM;
  issues: Diagnostic[];
}

/** Renders a pasted document without writing it anywhere. */
export async function renderPasted(text: string): Promise<RenderResult> {
  const doc = parseCrev(text, { filename: "pasted.crev" });
  const validation = validateDocument(doc, { skipStaleness: true });
  return { review: await buildReviewVM(doc), issues: validation.diagnostics };
}
