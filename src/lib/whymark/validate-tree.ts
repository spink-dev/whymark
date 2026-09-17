import { existsSync, readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, resolve, sep } from "node:path";
import { hashObject } from "./git";
import {
  validateDocument,
  type ValidateOptions,
  type ValidationResult,
} from "./validate";
import { allNotes, type Diagnostic, type WhymarkDocument } from "./types";

/** Working-tree hash comparison — Node only, not used by the hosted viewer. */
export function collectStaleness(doc: WhymarkDocument, cwd: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const file of doc.files) {
    // A review of a past commit describes a blob that cannot change, so
    // comparing it to the working tree would report every later edit as decay.
    if (!file.newSha || doc.meta.scope === "commit") continue;
    if (file.status === "deleted") continue;

    const abs = join(cwd, file.path);
    if (!existsSync(abs)) {
      diagnostics.push({
        level: "warning",
        code: "file-missing",
        message: `\`${file.path}\` is annotated but not present in the working tree.`,
        file: file.path,
      });
      continue;
    }
    const actual = hashObject(file.path, cwd);
    if (actual && !actual.startsWith(file.newSha) && !file.newSha.startsWith(actual)) {
      diagnostics.push({
        level: "warning",
        code: "review-stale",
        message: `\`${file.path}\` has changed since this review was written (recorded ${file.newSha.slice(
          0,
          8,
        )}, now ${actual.slice(0, 8)}). Annotations may no longer match the code.`,
        file: file.path,
      });
    }
  }

  return diagnostics;
}

export function validateDocumentInRepo(
  doc: WhymarkDocument,
  options: ValidateOptions & { cwd?: string } = {},
): ValidationResult {
  const extra = options.skipStaleness
    ? []
    : collectStaleness(doc, options.cwd ?? process.cwd());
  if (!options.skipStaleness) extra.push(...collectSourceDiagnostics(doc, options.cwd ?? process.cwd()));
  return validateDocument(doc, { ...options, extraDiagnostics: extra });
}

export function collectSourceDiagnostics(doc: WhymarkDocument, cwd: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const note of allNotes(doc)) for (const source of note.sources) {
    let problem: string | null = null;
    try {
      if (source.type === "file") {
        const match = source.locator.match(/^(.*?)(?::(\d+)(?:-(\d+))?)?$/);
        if (!match || /[*?]/.test(match[1])) continue;
        const path = match[1];
        if (path.startsWith("/") || path.split(/[\\/]/).includes("..")) throw new Error("reference escapes repository");
        let content: string;
        const revision = doc.meta.scope === "commit" ? doc.meta.head?.match(/[a-f0-9]{7,40}$/)?.[0] : undefined;
        if (doc.meta.scope === "commit" && !revision) throw new Error("recorded commit unavailable");
        if (revision) content = execFileSync("git", ["show", `${revision}:${path}`], { cwd, encoding: "utf8", maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
        else {
          const root = realpathSync(cwd);
          const absolute = realpathSync(resolve(root, path));
          const rel = relative(root, absolute);
          if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("reference escapes repository");
          content = readFileSync(absolute, "utf8");
        }
        const count = content.replace(/\n$/, "").split("\n").length;
        if (match[2] && (Number(match[2]) < 1 || Number(match[3] ?? match[2]) > count || Number(match[3] ?? match[2]) < Number(match[2]))) problem = "line range is outside the file";
      } else if (source.type === "commit") {
        if (!/^[a-f0-9]{7,40}$/.test(source.locator)) throw new Error("expected a commit hash");
        execFileSync("git", ["cat-file", "-e", `${source.locator}^{commit}`], { cwd, stdio: "ignore" });
      } else if (source.type === "dep") {
        const match = source.locator.match(/^(@?[^@]+)@(.+)$/);
        if (!match || !/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(match[1])) throw new Error("expected dependency@version");
        const pkg = JSON.parse(readFileSync(join(cwd, "node_modules", match[1], "package.json"), "utf8"));
        if (pkg.version !== match[2]) problem = "installed dependency version differs from the citation";
      }
    } catch { problem = "reference unavailable at the reviewed location"; }
    if (problem) diagnostics.push({ level: "warning", code: "source-unavailable", message: `${source.locator}: ${problem}. Locator checks do not establish that a source supports the claim.`, noteId: note.id, file: note.file ?? undefined });
  }
  return diagnostics;
}
