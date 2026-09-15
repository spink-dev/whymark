import { buildRows } from "@/lib/whymark/align";
import { isActionable } from "@/lib/whymark/edit";
import { hashObject } from "@/lib/whymark/git";
import { languageFor } from "@/lib/whymark/lang";
import { computeStats, type FileStats } from "@/lib/whymark/stats";
import type { WhymarkDocument, FileSection, Meta, Note } from "@/lib/whymark/types";
import { highlightFile, type Token } from "@/lib/highlight";

export interface RowVM {
  key: string;
  kind: "hunk" | "context" | "add" | "del";
  text: string;
  tokens: Token[];
  oldLine?: number;
  newLine?: number;
  label?: string;
  noteIds: string[];
  /** Character range that actually changed, for a paired del/add line. */
  intra?: [number, number];
}

export interface FileVM {
  path: string;
  oldPath?: string;
  status: FileSection["status"];
  added: number;
  removed: number;
  lang: string;
  newSha?: string;
  binary: boolean;
  /** The file still matches this review, so a reviewer's decisions can be written to it. */
  actionable: boolean;
  rows: RowVM[];
  notes: Note[];
  stats: FileStats;
}

export interface ReviewVM {
  meta: Meta;
  files: FileVM[];
  docNotes: Note[];
  stats: ReturnType<typeof computeStats>;
  diagnostics: WhymarkDocument["diagnostics"];
}

export async function buildReviewVM(doc: WhymarkDocument): Promise<ReviewVM> {
  const stats = computeStats(doc);
  const files: FileVM[] = [];

  for (const [index, file] of doc.files.entries()) {
    const tokens = await highlightFile(file);
    const rows = buildRows(file);

    // buildRows emits one hunk header row followed by that hunk's lines, so the
    // token blocks line up if we walk them in the same order.
    let hunkIndex = -1;
    let lineIndex = 0;
    const vmRows: RowVM[] = rows.map((row) => {
      if (row.kind === "hunk") {
        hunkIndex++;
        lineIndex = 0;
        return {
          key: row.key,
          kind: "hunk",
          text: row.text,
          tokens: [],
          label: row.label,
          noteIds: [],
        };
      }
      const lineTokens = tokens[hunkIndex]?.[lineIndex] ?? [{ text: row.text }];
      lineIndex++;
      return {
        key: row.key,
        kind: row.kind === "nonewline" ? "context" : row.kind,
        text: row.text,
        tokens: lineTokens,
        oldLine: row.oldLine,
        newLine: row.newLine,
        noteIds: row.noteIds,
      };
    });

    markIntralineChanges(vmRows);

    files.push({
      path: file.path,
      oldPath: file.oldPath,
      status: file.status,
      added: file.added,
      removed: file.removed,
      lang: languageFor(file.path, file.lang),
      newSha: file.newSha,
      binary: file.binary,
      actionable: isActionable(file, hashObject(file.path, process.cwd())),
      rows: vmRows,
      notes: file.notes,
      stats: stats.perFile[index],
    });
  }

  return {
    meta: doc.meta,
    files,
    docNotes: doc.notes,
    stats,
    diagnostics: doc.diagnostics,
  };
}

/**
 * Marks the part of a replaced line that actually changed, so a one-character
 * edit does not read as a whole rewritten line.
 */
function markIntralineChanges(rows: RowVM[]) {
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind !== "del") {
      i++;
      continue;
    }
    const dels: RowVM[] = [];
    while (i < rows.length && rows[i].kind === "del") dels.push(rows[i++]);
    const adds: RowVM[] = [];
    while (i < rows.length && rows[i].kind === "add") adds.push(rows[i++]);
    if (dels.length !== adds.length) continue;

    for (let k = 0; k < dels.length; k++) {
      const range = changedRange(dels[k].text, adds[k].text);
      if (!range) continue;
      dels[k].intra = range.left;
      adds[k].intra = range.right;
    }
  }
}

function changedRange(
  before: string,
  after: string,
): { left: [number, number]; right: [number, number] } | null {
  if (!before || !after || before === after) return null;

  let prefix = 0;
  const max = Math.min(before.length, after.length);
  while (prefix < max && before[prefix] === after[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < max - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }

  const leftEnd = before.length - suffix;
  const rightEnd = after.length - suffix;
  const changed = Math.max(leftEnd - prefix, rightEnd - prefix);
  const longest = Math.max(before.length, after.length);

  // If most of the line changed, highlighting a range adds noise instead of signal.
  if (changed <= 0 || changed / longest > 0.7) return null;
  return { left: [prefix, leftEnd], right: [prefix, rightEnd] };
}
