import { readEvidence } from "./evidence";
import { readQuality } from "../quality/import";
import { computeStats, hasPassingVerify, type DocStats } from "./stats";
import { allNotes, isStub, type WhymarkDocument, type Diagnostic } from "./types";

export interface ValidateOptions {
  /** Fail when line coverage is below this fraction, 0..1. */
  minCoverage?: number;
  /** Treat warnings as errors. */
  strict?: boolean;
  /**
   * Extra diagnostics, typically working-tree staleness from
   * `validate-tree.ts`. Kept out of this module so the browser viewer can
   * validate a pasted file without bundling `node:fs`.
   */
  extraDiagnostics?: Diagnostic[];
  /** Repo root; ignored here. Pass tree checks via `extraDiagnostics`. */
  cwd?: string;
  /** Ignored here. Tree comparison is `collectStaleness` in `validate-tree.ts`. */
  skipStaleness?: boolean;
}

export interface ValidationResult {
  diagnostics: Diagnostic[];
  stats: DocStats;
  errors: number;
  warnings: number;
  ok: boolean;
}

export function validateDocument(
  doc: WhymarkDocument,
  options: ValidateOptions = {},
): ValidationResult {
  const diagnostics: Diagnostic[] = [
    ...doc.diagnostics,
    ...(options.extraDiagnostics ?? []),
  ];
  const stats = computeStats(doc);

  if (!doc.files.length && !doc.notes.length) {
    diagnostics.push({
      level: "error",
      code: "document-empty",
      message: "Document contains no file sections and no notes.",
    });
  }

  if (doc.meta.extra.evidence !== undefined && (!Array.isArray(doc.meta.extra.evidence) || readEvidence(doc.meta.extra.evidence).length !== doc.meta.extra.evidence.length)) {
    diagnostics.push({ level: "warning", code: "evidence-invalid", message: "Malformed execution evidence was preserved but cannot establish verification." });
  }
  if (doc.meta.extra.quality !== undefined && !readQuality(doc.meta.extra.quality)) {
    diagnostics.push({ level: "warning", code: "quality-invalid", message: "Malformed quality report was preserved but cannot establish a clean scan." });
  }

  if (!doc.meta.summary?.trim()) {
    diagnostics.push({
      level: "warning",
      code: "summary-missing",
      message:
        "No `summary` in frontmatter. A reviewer opening this cold has nothing to orient on.",
    });
  } else if (/\bTODO\b/i.test(doc.meta.summary)) {
    diagnostics.push({
      level: "warning",
      code: "summary-stub",
      message: "`summary` still contains the generated TODO placeholder.",
    });
  }

  for (const file of doc.files) {
    if (!file.hunks.length && !file.binary && file.status !== "context") {
      diagnostics.push({
        level: "warning",
        code: "file-empty",
        message: `\`${file.path}\` has no hunks.`,
        file: file.path,
      });
    }
  }

  for (const note of allNotes(doc)) {
    const where = { line: note.sourceLine, file: note.file ?? undefined, noteId: note.id };

    if (isStub(note)) {
      diagnostics.push({
        level: "warning",
        code: "note-stub",
        message: `Note \`${note.id}\` still holds generated placeholder text. It explains nothing yet.`,
        ...where,
      });
    } else if (!note.why?.trim() && !note.body.trim()) {
      diagnostics.push({
        level: "warning",
        code: "note-no-why",
        message: `Note \`${note.id}\` has no \`why\`. State the reason, not the mechanics.`,
        ...where,
      });
    }

    if (!note.sources.length && note.kind !== "generated") {
      diagnostics.push({
        level: "info",
        code: "note-no-source",
        message: `Note \`${note.id}\` cites no source. Use \`inference\` if there genuinely was none.`,
        ...where,
      });
    }

    if (!note.verify.length) {
      diagnostics.push({
        level: "info",
        code: "note-no-verify",
        message: `Note \`${note.id}\` makes no verification claim. \`verify: none\` is a valid answer.`,
        ...where,
      });
    }

    if (note.risk === "high" && !hasPassingVerify(note)) {
      diagnostics.push({
        level: "warning",
        code: "high-risk-unverified",
        message: `Note \`${note.id}\` is marked high risk but has no passing verification.`,
        ...where,
      });
    }

    for (const claim of note.verify) {
      if (claim.status === "pass" && claim.method === "cmd" && !claim.detail) {
        diagnostics.push({
          level: "warning",
          code: "verify-unrunnable",
          message: `Note \`${note.id}\` claims a passing command but does not say which command. Put it in backticks.`,
          ...where,
        });
      }
      if (claim.status === "fail") {
        diagnostics.push({
          level: "warning",
          code: "verify-failing",
          message: `Note \`${note.id}\` records a failing check: ${claim.raw}`,
          ...where,
        });
      }
    }

    if (note.confidence !== undefined && note.confidence < 0.5 && !note.todos.length && !note.questions.length) {
      diagnostics.push({
        level: "info",
        code: "low-confidence-no-followup",
        message: `Note \`${note.id}\` has confidence ${note.confidence} but names no todo or question. Say what would raise it.`,
        ...where,
      });
    }
  }

  for (const check of doc.meta.checks) {
    if (check.status === "fail") {
      diagnostics.push({
        level: "warning",
        code: "check-failing",
        message: `Check \`${check.cmd}\` is recorded as failing${
          check.detail ? `: ${check.detail}` : ""
        }.`,
      });
    }
  }

  if (options.minCoverage !== undefined && stats.coverage < options.minCoverage) {
    diagnostics.push({
      level: "error",
      code: "coverage-below-threshold",
      message: `Line coverage is ${Math.round(stats.coverage * 100)}%, below the required ${Math.round(
        options.minCoverage * 100,
      )}%. ${stats.added - stats.covered} added line(s) carry no annotation.`,
    });
  }

  const errors = diagnostics.filter((d) => d.level === "error").length;
  const warnings = diagnostics.filter((d) => d.level === "warning").length;

  return {
    diagnostics,
    stats,
    errors,
    warnings,
    ok: errors === 0 && (!options.strict || warnings === 0),
  };
}
