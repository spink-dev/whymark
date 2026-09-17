import type { EvidenceView } from "@/lib/whymark/evidence";

export function EvidencePanel({ evidence }: { evidence: EvidenceView[] }) {
  return (
    <details aria-label="Execution evidence" className="space-y-2 rounded-lg border border-border/60 p-3 text-xs">
      <summary className="cursor-pointer font-medium">Execution evidence · {evidence.length ? `${evidence.length} records` : "none recorded"}</summary>
      <p className="text-muted-foreground">Author confidence and passing claims are not measured accuracy. Records are unauthenticated; source hashes establish freshness, not who ran a command.</p>
      {!evidence.length ? <p>No execution records. The percentages above count author claims.</p> : evidence.map(({ record, state, contradicted }, index) => (
        <details key={index} className="rounded border border-border/50 p-2">
          <summary className="cursor-pointer break-all">
            <strong>{contradicted ? "Contradicted claim · " : ""}{record.status}</strong> · {state === "current" ? "current source, output checked" : state === "imported" ? "imported, freshness unchecked" : state} · {record.command}
          </summary>
          <dl className="mt-2 space-y-1 break-all text-muted-foreground">
            <div>Recorded: {record.ran} · {record.durationMs}ms · exit {record.exitCode ?? "unavailable"}</div>
            <div>{record.tool} · {record.runtime} · cwd {record.cwd}</div>
            <div>{record.summary}</div>
            <div>Source: {record.source ?? "unavailable"}</div>
            <div>Output: {record.outputArtifact} · SHA-256 {record.outputHash}</div>
          </dl>
        </details>
      ))}
    </details>
  );
}
