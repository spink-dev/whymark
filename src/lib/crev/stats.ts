import {
  allNotes,
  isStub,
  type CrevDocument,
  type FileSection,
  type Note,
  type NoteKind,
  type Risk,
  type VerifyStatus,
} from "./types";

export interface FileStats {
  path: string;
  added: number;
  removed: number;
  /** Added lines covered by at least one line-range note. */
  covered: number;
  /** Added lines covered by a note with a passing verification claim. */
  verified: number;
  coverage: number;
  notes: number;
  fileLevelNotes: number;
}

export interface DocStats {
  files: number;
  added: number;
  removed: number;
  covered: number;
  verified: number;
  /** Share of added lines with at least one annotation, 0..1. */
  coverage: number;
  /** Share of added lines whose annotation carries a passing check, 0..1. */
  verifiedCoverage: number;
  notes: number;
  /** Notes whose only provenance is `inference`. */
  inferenceOnly: number;
  /** Notes with at least one non-inference source. */
  sourced: number;
  /** Notes that still contain generated placeholder text. */
  stubs: number;
  /** Notes with no `why`. */
  unexplained: number;
  byKind: Record<NoteKind, number>;
  byRisk: Record<Risk, number>;
  /** High-risk notes without a passing verification claim. */
  unverifiedHighRisk: number;
  verifyStatuses: Record<VerifyStatus, number>;
  openTodos: number;
  openQuestions: number;
  checks: { total: number; pass: number; fail: number; unknown: number };
  perFile: FileStats[];
}

export function coveredLines(file: FileSection): {
  covered: Set<number>;
  verified: Set<number>;
} {
  const covered = new Set<number>();
  const verified = new Set<number>();
  for (const note of file.notes) {
    if (note.selector.side !== "new") continue;
    const passes = hasPassingVerify(note);
    for (let n = note.selector.start; n <= note.selector.end; n++) {
      covered.add(n);
      if (passes) verified.add(n);
    }
  }
  return { covered, verified };
}

export function hasPassingVerify(note: Note): boolean {
  return note.verify.some((v) => v.status === "pass" && v.method !== "none");
}

export function addedLineNumbers(file: FileSection): number[] {
  const out: number[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add" && line.newLine !== undefined) out.push(line.newLine);
    }
  }
  return out;
}

export function computeStats(doc: CrevDocument): DocStats {
  const notes = allNotes(doc);
  const byKind = {} as Record<NoteKind, number>;
  const byRisk: Record<Risk, number> = { low: 0, medium: 0, high: 0 };
  const verifyStatuses: Record<VerifyStatus, number> = {
    pass: 0,
    fail: 0,
    unknown: 0,
    skipped: 0,
  };

  let inferenceOnly = 0;
  let sourced = 0;
  let stubs = 0;
  let unexplained = 0;
  let unverifiedHighRisk = 0;
  let openTodos = 0;
  let openQuestions = 0;

  for (const note of notes) {
    byKind[note.kind] = (byKind[note.kind] ?? 0) + 1;
    if (note.risk) byRisk[note.risk]++;
    for (const claim of note.verify) verifyStatuses[claim.status]++;

    const external = note.sources.filter((s) => s.type !== "inference");
    if (external.length) sourced++;
    else if (note.sources.length) inferenceOnly++;

    if (isStub(note)) stubs++;
    if (!note.why?.trim()) unexplained++;
    if (note.risk === "high" && !hasPassingVerify(note)) unverifiedHighRisk++;
    openTodos += note.todos.length;
    openQuestions += note.questions.length;
  }

  const perFile: FileStats[] = doc.files.map((file) => {
    const added = addedLineNumbers(file);
    const { covered, verified } = coveredLines(file);
    const addedSet = new Set(added);
    const coveredCount = [...covered].filter((n) => addedSet.has(n)).length;
    const verifiedCount = [...verified].filter((n) => addedSet.has(n)).length;
    return {
      path: file.path,
      added: added.length,
      removed: file.removed,
      covered: coveredCount,
      verified: verifiedCount,
      coverage: added.length ? coveredCount / added.length : 1,
      notes: file.notes.length,
      fileLevelNotes: file.notes.filter((n) => n.selector.side === "file").length,
    };
  });

  const added = perFile.reduce((sum, f) => sum + f.added, 0);
  const covered = perFile.reduce((sum, f) => sum + f.covered, 0);
  const verified = perFile.reduce((sum, f) => sum + f.verified, 0);
  const checks = doc.meta.checks;

  return {
    files: doc.files.length,
    added,
    removed: perFile.reduce((sum, f) => sum + f.removed, 0),
    covered,
    verified,
    coverage: added ? covered / added : 1,
    verifiedCoverage: added ? verified / added : 1,
    notes: notes.length,
    inferenceOnly,
    sourced,
    stubs,
    unexplained,
    byKind,
    byRisk,
    unverifiedHighRisk,
    verifyStatuses,
    openTodos,
    openQuestions,
    checks: {
      total: checks.length,
      pass: checks.filter((c) => c.status === "pass").length,
      fail: checks.filter((c) => c.status === "fail").length,
      unknown: checks.filter((c) => c.status === "unknown" || c.status === "skipped")
        .length,
    },
    perFile,
  };
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
