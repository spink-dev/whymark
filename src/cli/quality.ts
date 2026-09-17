import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseWhymark } from "../lib/whymark/parse";
import { serializeWhymark } from "../lib/whymark/serialize";
import { repoRoot } from "../lib/whymark/git";
import { gitHead, reviewFingerprint, sourceFingerprint, writeOutput } from "../lib/whymark/evidence-node";
import { compareFindings } from "../lib/quality/baseline";
import { parseBoundedJson, parseESLint, readQuality } from "../lib/quality/import";
import { readConfig, scanQuality } from "../lib/quality/run";
import type { QualityReport } from "../lib/quality/types";

interface Options { run: boolean; watch: boolean; write: boolean; config?: string; baseline?: string; importPath?: string; toolVersion?: string }
export async function qualityCommand(positionals: string[], options: Options) {
  const cwd = repoRoot() || process.cwd();
  if (positionals[0] === "init") {
    const path = join(cwd, "whymark.config.json");
    writeFileSync(path, `${JSON.stringify({ version: 1, checks: [
      { id: "eslint", format: "eslint", command: "node node_modules/eslint/bin/eslint.js . --format json --rule 'complexity: [warn, 15]' --rule 'max-depth: [warn, 4]'", versionCommand: "node node_modules/eslint/bin/eslint.js --version" },
      { id: "typecheck", format: "check", command: "npm run typecheck", versionCommand: "node node_modules/typescript/bin/tsc --version" },
    ], suppressions: [] }, null, 2)}\n`, { flag: "wx" });
    process.stdout.write(`Created ${path}. Review the commands before running quality --run.\n`);
    return;
  }
  const path = positionals[0];
  if (!path || (options.run ? 1 : 0) + (options.importPath ? 1 : 0) !== 1 || options.watch && !options.run) {
    throw new Error("Use quality <review.whymark> --run or --import <eslint.json>. See whymark help quality.");
  }
  let baseline: QualityReport | null = null;
  if (options.baseline) {
    baseline = readQuality(parseBoundedJson(readFileSync(options.baseline, "utf8")));
    if (!baseline) throw new Error("Invalid baseline report.");
  }
  let controller = new AbortController();
  let generation = 0;
  const execute = async () => {
    const mine = ++generation;
    controller.abort(); controller = new AbortController();
    const signal = controller.signal;
    const text = readFileSync(path, "utf8");
    const doc = parseWhymark(text);
    let report: QualityReport;
    if (options.importPath) {
      const input = readFileSync(options.importPath, "utf8");
      report = compareFindings({
        version: 1, ran: new Date().toISOString(), source: null, sourceAfter: null, head: gitHead(cwd), clean: false, base: doc.meta.base ?? null,
        reviewHash: reviewFingerprint(doc), provenance: "imported", comparison: "unavailable",
        checks: [{ id: "eslint", version: options.toolVersion ?? "unknown", command: "Imported ESLint JSON (not executed)", status: "unavailable", exitCode: null, ...writeOutput(cwd, input), detail: "Execution and source state were not independently checked." }],
        findings: parseESLint(input, name => relative(cwd, resolve(cwd, name)).split("\\").join("/")),
      }, null);
    } else report = await scanQuality(doc, cwd, readConfig(options.config ?? join(cwd, "whymark.config.json")), { baseline, signal });
    if (signal.aborted || mine !== generation) return;
    if (options.write) {
      if (readFileSync(path, "utf8") !== text) throw new Error("Review changed during the scan; results were not attached. Rerun against the current review.");
      doc.meta.extra.quality = report;
      writeFileSync(path, serializeWhymark(doc));
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!options.watch) process.exitCode = report.checks.some(check => check.status !== "pass") || report.findings.some(f => f.severity === "error" && f.status !== "resolved" && !f.suppression) ? 1 : 0;
  };
  if (!options.watch) { await execute(); return; }
  let previous = sourceFingerprint(cwd);
  if (!previous) throw new Error("Cannot watch: repository fingerprint unavailable.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const launch = () => { void execute().catch(error => process.stderr.write(`${(error as Error).message}\n`)); };
  launch();
  const interval = setInterval(() => {
    const next = sourceFingerprint(cwd);
    if (next === previous) return;
    previous = next; controller.abort(); generation++;
    clearTimeout(timer); timer = setTimeout(launch, 400);
  }, 1000);
  await new Promise<void>(done => {
    const stop = () => {
      clearInterval(interval); clearTimeout(timer); controller.abort(); generation++;
      process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); done();
    };
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
  });
}
