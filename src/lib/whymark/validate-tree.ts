import { existsSync } from "node:fs";
import { join } from "node:path";
import { hashObject } from "./git";
import {
  validateDocument,
  type ValidateOptions,
  type ValidationResult,
} from "./validate";
import type { Diagnostic, WhymarkDocument } from "./types";

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
  return validateDocument(doc, { ...options, extraDiagnostics: extra });
}
