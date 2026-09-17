import type { WhymarkDocument, VerifyStatus } from "./types";

export interface ExecutionEvidence {
  version: 1;
  command: string;
  noteId: string | null;
  file: string | null;
  claimed: VerifyStatus;
  status: "pass" | "fail" | "unavailable";
  ran: string;
  durationMs: number;
  exitCode: number | null;
  cwd: string;
  tool: string;
  runtime: string;
  source: string | null;
  sourceAfter: string | null;
  head: string | null;
  base: string | null;
  reviewHash: string;
  outputHash: string;
  outputArtifact: string;
  summary: string;
}

export type EvidenceState = "imported" | "current" | "stale" | "unavailable";
export interface EvidenceView {
  record: ExecutionEvidence;
  state: EvidenceState;
  contradicted: boolean;
}

const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nullableString = (value: unknown) => value === null || typeof value === "string";
const status = (value: unknown) => ["pass", "fail", "unknown", "skipped"].includes(String(value));

export function readEvidence(value: unknown): ExecutionEvidence[] {
  if (!Array.isArray(value) || value.length > 1000) return [];
  return value.filter((r): r is ExecutionEvidence => r && typeof r === "object" &&
    r.version === 1 && typeof r.command === "string" && r.command.length <= 10000 &&
    nullableString(r.noteId) && nullableString(r.file) && status(r.claimed) &&
    ["pass", "fail", "unavailable"].includes(r.status) &&
    typeof r.ran === "string" && Number.isFinite(Date.parse(r.ran)) &&
    Number.isFinite(r.durationMs) && r.durationMs >= 0 &&
    (r.exitCode === null || Number.isInteger(r.exitCode)) &&
    (r.status !== "pass" || r.exitCode === 0) &&
    typeof r.cwd === "string" && typeof r.tool === "string" && typeof r.runtime === "string" &&
    (r.source === null || hash(r.source)) && (r.sourceAfter === null || hash(r.sourceAfter)) &&
    nullableString(r.head) && nullableString(r.base) && hash(r.reviewHash) && hash(r.outputHash) &&
    typeof r.outputArtifact === "string" && typeof r.summary === "string");
}

export function evidenceViews(doc: WhymarkDocument, local?: {
  source: string | null;
  reviewHash: string;
  outputAvailable: (record: ExecutionEvidence) => boolean;
}): EvidenceView[] {
  return readEvidence(doc.meta.extra.evidence).map(record => {
    let state: EvidenceState = "imported";
    if (record.status === "unavailable" || !record.source || !record.sourceAfter) state = "unavailable";
    else if (record.source !== record.sourceAfter) state = "stale";
    else if (local) {
      if (!local.source || !local.outputAvailable(record)) state = "unavailable";
      else state = record.source === local.source && record.reviewHash === local.reviewHash ? "current" : "stale";
    }
    return { record, state, contradicted: (record.claimed === "pass" || record.claimed === "fail") && record.status !== "unavailable" && record.status !== record.claimed };
  });
}
