export interface QualityFinding {
  id: string;
  tool: string;
  rule: string;
  severity: "warning" | "error";
  message: string;
  path: string | null;
  line: number | null;
  endLine: number | null;
  helpUrl?: string;
  status: "new" | "existing" | "resolved" | "uncompared";
  suppression?: { reason: string; expires: string };
}

export interface QualityCheck {
  id: string;
  version: string;
  command: string;
  status: "pass" | "fail" | "unavailable";
  exitCode: number | null;
  outputHash: string;
  outputArtifact: string;
  detail: string;
}

export interface QualityReport {
  version: 1;
  ran: string;
  source: string | null;
  sourceAfter: string | null;
  head: string | null;
  clean: boolean;
  base: string | null;
  reviewHash: string;
  provenance: "local-run" | "imported";
  comparison: "available" | "unavailable";
  checks: QualityCheck[];
  findings: QualityFinding[];
}
