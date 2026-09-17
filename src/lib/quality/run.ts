import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { WhymarkDocument } from "../whymark/types";
import { cleanSource, resolveRevision, gitHead, reviewFingerprint, sourceFingerprint, writeOutput } from "../whymark/evidence-node";
import { applySuppressions, compareFindings } from "./baseline";
import { parseBoundedJson, parseESLint } from "./import";
import type { QualityReport } from "./types";

export interface QualityConfig {
  version: 1;
  checks: Array<{ id: string; command: string; versionCommand: string; format: "eslint" | "check" }>;
  suppressions?: Array<{ id: string; reason: string; expires: string }>;
}

export function readConfig(path: string): QualityConfig {
  const value = parseBoundedJson(readFileSync(path, "utf8")) as QualityConfig;
  if (!value || value.version !== 1 || !Array.isArray(value.checks) || !value.checks.length || value.checks.length > 20 ||
    !value.checks.every(c => c && typeof c.id === "string" && /^[a-z][a-z0-9-]*$/.test(c.id) && typeof c.command === "string" && c.command.length > 0 && c.command.length < 10000 && typeof c.versionCommand === "string" && c.versionCommand.length > 0 && c.versionCommand.length < 10000 && ["eslint", "check"].includes(c.format)) ||
    new Set(value.checks.map(c => c.id)).size !== value.checks.length) throw new Error("Invalid whymark.config.json checks.");
  if (value.suppressions !== undefined && (!Array.isArray(value.suppressions) || !value.suppressions.every(s => s && typeof s.id === "string" && typeof s.reason === "string" && s.reason.trim() && typeof s.expires === "string" && Number.isFinite(Date.parse(s.expires))))) throw new Error("Invalid quality suppressions.");
  return value;
}

export function runTool(command: string, cwd: string, signal?: AbortSignal, timeoutMs = 120000): Promise<{ code: number | null; stdout: string; stderr: string; unavailable: boolean }> {
  return new Promise(resolveResult => {
    if (signal?.aborted) { resolveResult({ code: null, stdout: "", stderr: "Cancelled", unavailable: true }); return; }
    const child = spawn(command, { cwd, shell: true, detached: process.platform !== "win32", env: { ...process.env, CI: "1", NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let size = 0; let unavailable = false;
    const stop = (reason: string) => {
      unavailable = true;
      stderr += `\n${reason}`;
      try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* Already exited. */ }
    };
    const abort = () => stop("Cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => stop("Timed out"), timeoutMs);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    const append = (text: string, error: boolean) => {
      size += Buffer.byteLength(text);
      if (size > 8 * 1024 * 1024) { if (!unavailable) stop("Output exceeds 8 MB"); return; }
      if (error) stderr += text; else stdout += text;
    };
    child.stdout.on("data", text => append(text, false));
    child.stderr.on("data", text => append(text, true));
    child.on("error", error => { unavailable = true; stderr += error.message; });
    child.on("close", code => {
      clearTimeout(timeout); signal?.removeEventListener("abort", abort);
      resolveResult({ code, stdout, stderr, unavailable: unavailable || code === null || code === 127 });
    });
  });
}

export async function scanQuality(doc: WhymarkDocument, cwd: string, config: QualityConfig, options: { baseline?: QualityReport | null; signal?: AbortSignal } = {}): Promise<QualityReport> {
  cwd = realpathSync(cwd);
  const report: QualityReport = {
    version: 1, ran: new Date().toISOString(), source: sourceFingerprint(cwd), sourceAfter: null,
    head: gitHead(cwd), clean: cleanSource(cwd), base: resolveRevision(cwd, doc.meta.base), reviewHash: reviewFingerprint(doc),
    provenance: "local-run", comparison: "unavailable", checks: [], findings: [],
  };
  for (const check of config.checks) {
    if (options.signal?.aborted) break;
    const version = await runTool(check.versionCommand, cwd, options.signal, 10000);
    const run = await runTool(check.command, cwd, options.signal);
    let unavailable = run.unavailable || version.unavailable || version.code !== 0;
    let detail = run.stderr.trim().slice(0, 1000);
    if (check.format === "eslint" && !unavailable) {
      if (run.code !== 0 && run.code !== 1) unavailable = true;
      else try {
        const findings = parseESLint(run.stdout, path => relative(cwd, resolve(cwd, path)).split("\\").join("/"));
        if (run.code === 1 && !findings.length) throw new Error("ESLint failed without findings.");
        report.findings.push(...findings.map(finding => ({ ...finding, tool: check.id })));
      } catch (error) { unavailable = true; detail = (error as Error).message; }
    }
    report.checks.push({ id: check.id, version: version.stdout.trim().slice(0, 200) || "unavailable", command: check.command,
      status: unavailable ? "unavailable" : run.code === 0 ? "pass" : "fail", exitCode: run.code,
      ...writeOutput(cwd, `${run.stdout}\n${run.stderr}`), detail,
    });
  }
  report.sourceAfter = sourceFingerprint(cwd);
  const renames = new Map<string, string>();
  const base = options.baseline?.head;
  if (base && /^[a-f0-9]{40}$/.test(base)) {
    try {
      const tokens = execFileSync("git", ["diff", "--name-status", "-z", "--find-renames", base, "--"], { cwd, encoding: "utf8" }).split("\0");
      for (let i = 0; i < tokens.length;) {
        const status = tokens[i++]; const old = tokens[i++];
        if (status?.startsWith("R")) renames.set(old, tokens[i++]);
      }
    } catch { /* Baseline comparison remains explicit. */ }
  }
  const compared = compareFindings(report, options.baseline ?? null, renames);
  compared.findings = applySuppressions(compared.findings, config.suppressions ?? []);
  return compared;
}
