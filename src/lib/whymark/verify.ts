import { readEvidence, type ExecutionEvidence } from "./evidence";
import { gitHead, reviewFingerprint, sourceFingerprint, writeOutput } from "./evidence-node";
import { spawnSync } from "node:child_process";
import { allNotes, type Check, type WhymarkDocument, type Note, type VerifyClaim } from "./types";

export type Outcome = "confirmed" | "contradicted" | "unrunnable" | "recorded";

export interface RunResult {
  cmd: string;
  exitCode: number | null;
  status: "pass" | "fail";
  durationMs: number;
  output: string;
  timedOut: boolean;
  unavailable: boolean;
}

export interface ClaimResult {
  /** Note id, or null when the claim is a document-level check. */
  noteId: string | null;
  file: string | null;
  claimed: VerifyClaim["status"];
  cmd: string;
  outcome: Outcome;
  run?: RunResult;
  reason?: string;
}

export interface VerifyOptions {
  cwd?: string;
  recordEvidence?: boolean;
  toolVersion?: string;
  timeoutMs?: number;
  /** Only run commands matching this pattern. */
  filter?: RegExp;
  onStart?: (cmd: string) => void;
  onFinish?: (result: ClaimResult) => void;
}

export function runCommand(cmd: string, options: VerifyOptions = {}): RunResult {
  const started = Date.now();
  const result = spawnSync(cmd, {
    cwd: options.cwd ?? process.cwd(),
    shell: true,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 10 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return {
    cmd,
    exitCode: result.status,
    status: result.status === 0 ? "pass" : "fail",
    durationMs: Date.now() - started,
    output,
    unavailable: Boolean(result.error || result.status === null || result.status === 127),
    timedOut: Boolean(result.error && /ETIMEDOUT|timed out/i.test(String(result.error))),
  };
}

/** Re-runs every `cmd` verification claim and every frontmatter check. */
export function verifyDocument(
  doc: WhymarkDocument,
  options: VerifyOptions = {},
): ClaimResult[] {
  const results: ClaimResult[] = [];
  const cwd = options.cwd ?? process.cwd();
  const before = options.recordEvidence ? sourceFingerprint(cwd) : null;
  const recordedHead = options.recordEvidence ? gitHead(cwd) : null;
  const cache = new Map<string, RunResult>();

  const run = (cmd: string): RunResult => {
    const cached = cache.get(cmd);
    if (cached) return cached;
    options.onStart?.(cmd);
    const result = runCommand(cmd, options);
    cache.set(cmd, result);
    return result;
  };

  for (const check of doc.meta.checks) {
    if (options.filter && !options.filter.test(check.cmd)) continue;
    const result = run(check.cmd);
    const claimResult: ClaimResult = {
      noteId: null,
      file: null,
      claimed: check.status,
      cmd: check.cmd,
      outcome: result.unavailable ? "unrunnable" : outcomeFor(check.status, result.status),
      run: result,
    };
    applyToCheck(check, result);
    results.push(claimResult);
    options.onFinish?.(claimResult);
  }

  for (const note of allNotes(doc)) {
    for (const claim of note.verify) {
      const cmd = commandOf(claim);
      if (!cmd) {
        if (claim.method === "cmd") {
          const claimResult: ClaimResult = {
            noteId: note.id,
            file: note.file,
            claimed: claim.status,
            cmd: claim.detail ?? "",
            outcome: "unrunnable",
            reason:
              "Claim names a command but not one that can be re-run. Put the exact command in backticks.",
          };
          results.push(claimResult);
          options.onFinish?.(claimResult);
        }
        continue;
      }
      if (options.filter && !options.filter.test(cmd)) continue;
      const result = run(cmd);
      const claimResult: ClaimResult = {
        noteId: note.id,
        file: note.file,
        claimed: claim.status,
        cmd,
        outcome: result.unavailable ? "unrunnable" : outcomeFor(claim.status, result.status),
        run: result,
      };
      applyToClaim(claim, result);
      results.push(claimResult);
      options.onFinish?.(claimResult);
    }
  }

  if (options.recordEvidence) {
    const after = sourceFingerprint(cwd);
    const previous = readEvidence(doc.meta.extra.evidence);
    const additions: ExecutionEvidence[] = results.filter(result => result.run).map(result => {
      const run = result.run!;
      return {
        version: 1, command: result.cmd, noteId: result.noteId, file: result.file,
        claimed: result.claimed, status: run.unavailable ? "unavailable" : run.status,
        ran: new Date().toISOString(), durationMs: run.durationMs, exitCode: run.exitCode,
        cwd: ".", tool: `whymark@${options.toolVersion ?? "development"}`, runtime: process.version,
        source: before, sourceAfter: after, head: recordedHead, base: doc.meta.base ?? null,
        reviewHash: reviewFingerprint(doc), ...writeOutput(cwd, run.output), summary: summarise(run),
      };
    });
    doc.meta.extra.evidence = [...previous.filter(old => !additions.some(next => next.command === old.command && next.noteId === old.noteId && next.file === old.file)), ...additions];
  }
  return results;
}

function commandOf(claim: VerifyClaim): string | null {
  if (claim.method !== "cmd") return null;
  const detail = claim.detail?.trim();
  if (!detail) return null;
  // A command is only re-runnable if it looks like one, not like prose.
  if (/^[A-Z][a-z]+ /.test(detail) && !/[|&;]/.test(detail) && !detail.includes("--")) {
    return null;
  }
  return detail;
}

function outcomeFor(
  claimed: VerifyClaim["status"],
  actual: "pass" | "fail",
): Outcome {
  if (claimed === "unknown" || claimed === "skipped") return "recorded";
  return claimed === actual ? "confirmed" : "contradicted";
}

function applyToClaim(claim: VerifyClaim, result: RunResult) {
  claim.status = result.status;
  claim.comment = summarise(result);
  claim.raw = `cmd \`${result.cmd}\` => ${result.status}${
    claim.comment ? ` (${claim.comment})` : ""
  }`;
}

function applyToCheck(check: Check, result: RunResult) {
  check.status = result.status;
  check.detail = summarise(result);
  check.ran = new Date().toISOString();
}

function summarise(result: RunResult): string {
  if (result.timedOut) return "timed out";
  const seconds = (result.durationMs / 1000).toFixed(1);
  if (result.status === "pass") return `exit 0 in ${seconds}s`;
  const line = firstInterestingLine(result.output);
  return `exit ${result.exitCode} in ${seconds}s${line ? `: ${line}` : ""}`;
}

function firstInterestingLine(output: string): string {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const hit = lines.find((l) => /error|fail|✗|×|assert/i.test(l)) ?? lines.at(-1);
  if (!hit) return "";
  return hit.length > 120 ? `${hit.slice(0, 117)}…` : hit;
}

export function summariseResults(results: ClaimResult[]) {
  return {
    total: results.length,
    confirmed: results.filter((r) => r.outcome === "confirmed").length,
    contradicted: results.filter((r) => r.outcome === "contradicted").length,
    unrunnable: results.filter((r) => r.outcome === "unrunnable").length,
    recorded: results.filter((r) => r.outcome === "recorded").length,
  };
}

export function notesById(doc: WhymarkDocument): Map<string, Note> {
  return new Map(allNotes(doc).map((n) => [n.id, n]));
}
