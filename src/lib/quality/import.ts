import type { QualityFinding, QualityReport } from "./types";

const MAX_BYTES = 8 * 1024 * 1024;
export function parseBoundedJson(text: string): unknown {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error("Quality report exceeds 8 MB.");
  return JSON.parse(text);
}

export function safePath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !/^[A-Za-z]:/.test(path) && !path.includes("\\") && !path.split("/").includes("..") && !/[\0-\x1f]/.test(path);
}

export function readQuality(value: unknown): QualityReport | null {
  if (!value || typeof value !== "object") return null;
  const r = value as QualityReport;
  const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  const nullableHash = (v: unknown) => v === null || hash(v);
  if (r.version !== 1 || typeof r.clean !== "boolean" || typeof r.ran !== "string" || !Number.isFinite(Date.parse(r.ran)) ||
    !nullableHash(r.source) || !nullableHash(r.sourceAfter) || !hash(r.reviewHash) ||
    !(r.head === null || typeof r.head === "string") || !(r.base === null || typeof r.base === "string") ||
    !["local-run", "imported"].includes(r.provenance) || !["available", "unavailable"].includes(r.comparison) ||
    !Array.isArray(r.checks) || r.checks.length > 100 || !Array.isArray(r.findings) || r.findings.length > 20000) return null;
  if (!r.checks.every(c => c && typeof c.id === "string" && typeof c.version === "string" &&
    typeof c.command === "string" && ["pass", "fail", "unavailable"].includes(c.status) &&
    (c.exitCode === null || Number.isInteger(c.exitCode)) && hash(c.outputHash) &&
    typeof c.outputArtifact === "string" && typeof c.detail === "string")) return null;
  if (!r.findings.every(f => f && typeof f.id === "string" && typeof f.tool === "string" &&
    typeof f.rule === "string" && typeof f.message === "string" &&
    ["warning", "error"].includes(f.severity) && (f.path === null || typeof f.path === "string" && safePath(f.path)) &&
    (f.line === null || Number.isInteger(f.line) && f.line > 0) &&
    (f.endLine === null || Number.isInteger(f.endLine) && f.endLine >= (f.line ?? 1)) &&
    (f.helpUrl === undefined || typeof f.helpUrl === "string" && /^https?:\/\//.test(f.helpUrl)) &&
    ["new", "existing", "resolved", "uncompared"].includes(f.status) &&
    (f.suppression === undefined || f.suppression !== null && typeof f.suppression === "object" && typeof f.suppression.reason === "string" && !!f.suppression.reason.trim() && typeof f.suppression.expires === "string" && Number.isFinite(Date.parse(f.suppression.expires))))) return null;
  return r;
}

export interface ESLintFile {
  filePath: string;
  messages: Array<{ ruleId: string | null; severity: number; message: string; line?: number; endLine?: number }>;
}

export function parseESLint(text: string, relativePath: (path: string) => string): QualityFinding[] {
  const input = parseBoundedJson(text);
  if (!Array.isArray(input) || input.length > 20000) throw new Error("Expected an ESLint JSON array.");
  const findings: QualityFinding[] = [];
  for (const file of input) {
    if (!file || typeof file.filePath !== "string" || !Array.isArray(file.messages)) throw new Error("Malformed ESLint file result.");
    const path = relativePath(file.filePath);
    if (!safePath(path)) throw new Error("ESLint result path escapes the repository.");
    for (const message of file.messages) {
      if (!message || typeof message.message !== "string" || ![1, 2].includes(message.severity) || !(message.ruleId === null || typeof message.ruleId === "string")) throw new Error("Malformed ESLint message.");
      if (message.line !== undefined && (!Number.isInteger(message.line) || message.line < 1)) throw new Error("Invalid finding line.");
      if (message.endLine !== undefined && (!Number.isInteger(message.endLine) || message.endLine < (message.line ?? 1))) throw new Error("Invalid finding range.");
      findings.push({ id: "", tool: "eslint", rule: message.ruleId ?? "parse-error", severity: message.severity === 2 ? "error" : "warning", message: message.message, path, line: message.line ?? null, endLine: message.endLine ?? message.line ?? null, status: "uncompared",
        ...(message.ruleId && /^[a-z-]+$/.test(message.ruleId) ? { helpUrl: `https://eslint.org/docs/latest/rules/${message.ruleId}` } : {}),
      });
      if (findings.length > 20000) throw new Error("Too many quality findings.");
    }
  }
  return findings;
}
