import type { FileDecisions } from "../../../src/lib/whymark/edit";
import type { ReviewVM } from "../../../src/lib/view-model";
export type Request =
  | { type: "ready" | "refresh" | "source" | "save" }
  | { type: "open"; path: string; line?: number }
  | { type: "external"; url: string }
  | { type: "apply"; id: number; revision: number; path: string; decisions: FileDecisions }
  | { type: "edit"; id: number; revision: number; path: string; start: number; end: number; text: string };
export interface ReviewMessage { type: "review"; review: ReviewVM; revision: number; trusted: boolean; label: string; generated: boolean }
export function parseRequest(input: unknown): Request | null {
  if (!input || typeof input !== "object") return null;
  const m = input as Record<string, unknown>;
  if (["ready", "refresh", "source", "save"].includes(String(m.type))) return { type: m.type } as Request;
  if (m.type === "external" && typeof m.url === "string" && m.url.length < 8192 && /^https?:\/\//.test(m.url)) return m as Request;
  if (typeof m.path !== "string" || m.path.length > 4096) return null;
  const positive = (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0;
  if (m.type === "open" && (m.line === undefined || positive(m.line))) return m as Request;
  if (!positive(m.id) || !positive(m.revision)) return null;
  if (m.type === "edit" && positive(m.start) && positive(m.end) && (m.end as number) >= (m.start as number) && typeof m.text === "string" && m.text.length <= 2_000_000) return m as Request;
  if (m.type === "apply" && m.decisions && typeof m.decisions === "object") {
    const d = m.decisions as Record<string, unknown>;
    const lines = (x: unknown) => Array.isArray(x) && x.length <= 100000 && x.every(positive);
    if (lines(d.discardAdded) && lines(d.restoreDeleted) && (d.revertParts === undefined || Array.isArray(d.revertParts) && d.revertParts.length <= 100000 && d.revertParts.every(p => p && positive(p.line) && Number.isSafeInteger(p.part) && p.part >= 0))) return m as Request;
  }
  return null;
}
