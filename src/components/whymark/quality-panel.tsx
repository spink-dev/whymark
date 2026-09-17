"use client";

import { useState } from "react";
import type { QualityReport } from "@/lib/quality/types";
import type { FileVM } from "@/lib/view-model";

export function QualityPanel({ report, state, files }: { report: QualityReport | null; state: "current" | "stale" | "unchecked"; files: FileVM[] }) {
  const [changedOnly, setChangedOnly] = useState(false);
  if (!report) return null;
  const findings = report.findings.filter(finding => !changedOnly || finding.path === null || finding.line === null || files.some(file => file.path === finding.path && file.rows.some(row => row.kind === "add" && row.newLine !== undefined && row.newLine >= finding.line! && row.newLine <= (finding.endLine ?? finding.line!))));
  return (
    <section aria-label="Code quality" className="mt-3 space-y-2 rounded-lg border border-border/60 p-3 text-xs">
      <h2 className="font-medium">Code quality · {state === "unchecked" ? "source unchecked" : `${state} source`}</h2>
      <p className="text-muted-foreground">{report.provenance === "imported" ? "Imported report; execution not checked." : "Recorded local checks; unauthenticated evidence."} Baseline comparison {report.comparison}. Static findings do not measure code accuracy.</p>
      <ul className="space-y-1">{report.checks.map(check => <li key={check.id}><strong>{check.id} {check.version}: {check.status}</strong><details><summary className="cursor-pointer">Command and output</summary><p className="break-all">{check.command}<br />{check.detail}<br />{check.outputArtifact}<br />SHA-256 {check.outputHash}</p></details></li>)}</ul>
      <label className="flex items-center gap-2"><input type="checkbox" checked={changedOnly} onChange={event => setChangedOnly(event.target.checked)} />Changed lines and project findings only</label>
      <p>{findings.length} of {report.findings.length} findings shown</p>
      <ul className="space-y-2">{findings.map((finding, index) => {
        const file = files.findIndex(file => file.path === finding.path);
        return <li key={`${finding.id}-${index}`} className="rounded border border-border/50 p-2">
          <div className="flex flex-wrap gap-2"><strong>{finding.severity}</strong><span>{finding.status}</span><code>{finding.rule}</code></div>
          <p>{finding.message}</p>
          {file >= 0 ? <a className="underline" href={`#file-${file}`}>{finding.path}:{finding.line ?? "file"}</a> : <span>{finding.path ?? "project"}:{finding.line ?? "file"}</span>}
          {finding.helpUrl ? <a className="ml-2 underline" href={finding.helpUrl} target="_blank" rel="noreferrer">Rule documentation</a> : null}
          {finding.suppression ? <p>Suppression: {finding.suppression.reason} · expires {finding.suppression.expires}</p> : null}
        </li>;
      })}</ul>
    </section>
  );
}
