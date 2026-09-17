import { sha256 } from "../whymark/evidence-node";
import type { QualityFinding, QualityReport } from "./types";

export function identifyFindings(findings: QualityFinding[]): QualityFinding[] {
  const counts = new Map<string, number>();
  return findings.map(finding => {
    const key = JSON.stringify([finding.tool, finding.rule, finding.path, finding.message]);
    const occurrence = counts.get(key) ?? 0;
    counts.set(key, occurrence + 1);
    return { ...finding, id: sha256(`${key}:${occurrence}`) };
  });
}

export function compareFindings(current: QualityReport, baseline: QualityReport | null, renames: Map<string, string> = new Map()): QualityReport {
  const usable = baseline && baseline.clean && current.base && baseline.head &&
    current.base.endsWith(baseline.head) && baseline.source === baseline.sourceAfter && baseline.source !== null &&
    current.source === current.sourceAfter && current.source !== null &&
    current.checks.every(check => check.status !== "unavailable" && baseline.checks.some(old => old.id === check.id && old.version === check.version && old.command === check.command && old.status !== "unavailable"));
  if (!usable) return { ...current, comparison: "unavailable", findings: identifyFindings(current.findings).map(finding => ({ ...finding, status: "uncompared" })) };
  const old = identifyFindings(baseline.findings.filter(finding => finding.status !== "resolved").map(finding => ({ ...finding, path: finding.path ? renames.get(finding.path) ?? finding.path : null })));
  const pending = new Map(old.map(finding => [finding.id, finding]));
  const findings: QualityFinding[] = identifyFindings(current.findings).map(finding => {
    const existing = pending.delete(finding.id);
    return { ...finding, status: existing ? "existing" as const : "new" as const };
  });
  for (const finding of pending.values()) {
    if (current.checks.some(check => check.id === finding.tool)) findings.push({ ...finding, status: "resolved" });
  }
  return { ...current, comparison: "available", findings };
}

export function applySuppressions(findings: QualityFinding[], suppressions: Array<{ id: string; reason: string; expires: string }>, now = Date.now()): QualityFinding[] {
  return findings.map(finding => {
    const match = suppressions.find(item => item.id === finding.id && item.reason.trim() && Date.parse(item.expires) > now);
    const clean = { ...finding };
    delete clean.suppression;
    return match ? { ...clean, suppression: { reason: match.reason, expires: match.expires } } : clean;
  });
}
