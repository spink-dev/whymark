import type { FileDecisions } from "./whymark/edit";
export interface EditResult {
  ok: boolean;
  newSha?: string;
  discarded?: number;
  restored?: number;
  partsReverted?: number;
  error?: string;
}
export interface ReviewActions {
  applyFileDecisions(slug: string, path: string, decisions: FileDecisions): Promise<EditResult>;
  saveEditedRange(slug: string, path: string, start: number, end: number, text: string): Promise<EditResult>;
}
