import { buildRows } from "@/lib/whymark/align";
import { isActionable } from "@/lib/whymark/edit";
import { inlineParts, linePairs, type InlinePart } from "@/lib/whymark/inline";
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
  /**
   * The changed parts of a replaced line, each independently revertible. Only
   * present on a line the diff paired with a line on the other side.
   */
  parts?: InlinePart[];
  /** The line this one replaced, so a part revert knows what to go back to. */
  pairedLine?: number;
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

    markInlineParts(vmRows, file);

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
 * Marks the changed parts of each replaced line.
 *
 * The viewer and the apply path read the same pairing and the same parts, so
 * what is highlighted is exactly what a reviewer can revert — anything else
 * would offer a control that writes something other than what it shows.
 */
function markInlineParts(rows: RowVM[], file: FileSection) {
  const byNew = new Map<number, InlinePart[]>();
  const oldOf = new Map<number, number>();
  const newOf = new Map<number, number>();

  for (const pair of linePairs(file.hunks)) {
    const parts = inlineParts(pair.oldText, pair.newText);
    if (!parts.some((part) => part.changed)) continue;
    byNew.set(pair.newLine, parts);
    oldOf.set(pair.newLine, pair.oldLine);
    newOf.set(pair.oldLine, pair.newLine);
  }

  for (const row of rows) {
    if (row.kind === "add" && row.newLine !== undefined) {
      const parts = byNew.get(row.newLine);
      if (!parts) continue;
      row.parts = parts;
      row.pairedLine = oldOf.get(row.newLine);
      row.intra = spanOf(parts, "new");
      continue;
    }
    if (row.kind === "del" && row.oldLine !== undefined) {
      const partnered = newOf.get(row.oldLine);
      const parts = partnered === undefined ? undefined : byNew.get(partnered);
      if (!parts) continue;
      row.pairedLine = partnered;
      row.intra = spanOf(parts, "old");
    }
  }
}

/** The outer bounds of the changed parts, for the plain highlight on the old side. */
function spanOf(parts: InlinePart[], side: "old" | "new"): [number, number] | undefined {
  const changed = parts.filter((part) => part.changed);
  if (!changed.length) return undefined;
  const starts = changed.map((part) => (side === "new" ? part.newStart : part.oldStart));
  const ends = changed.map((part) => (side === "new" ? part.newEnd : part.oldEnd));
  return [Math.min(...starts), Math.max(...ends)];
}

