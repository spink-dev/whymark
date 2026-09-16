/**
 * Turning review decisions back into file content.
 *
 * A reviewer reading a diff locally wants to keep most of it and throw a little
 * of it away. Rather than reason about patches, this rewrites the file from the
 * copy already on disk: the caller must first confirm that copy is byte-for-byte
 * the diff's new side (compare `newSha`), which makes every new-side line number
 * in the diff an exact index into it.
 */
import { applyPartReverts, partsByNewLine } from "./inline";
import type { FileSection, Hunk } from "./types";

/** One changed part of one replaced line, addressed by new-side line number. */
export interface PartRef {
  line: number;
  part: number;
}

export interface FileDecisions {
  /** New-side line numbers to drop: added lines the reviewer rejects. */
  discardAdded: number[];
  /** Old-side line numbers to bring back: deletions the reviewer rejects. */
  restoreDeleted: number[];
  /**
   * Parts of a replaced line to take back to the old text while the rest of the
   * new line stays. Empty on decisions made before this existed, so it is
   * optional to read.
   */
  revertParts?: PartRef[];
}

export const NO_DECISIONS: FileDecisions = {
  discardAdded: [],
  restoreDeleted: [],
  revertParts: [],
};

export function partsOf(decisions: FileDecisions): PartRef[] {
  return decisions.revertParts ?? [];
}

export function isEmpty(decisions: FileDecisions): boolean {
  return (
    decisions.discardAdded.length === 0 &&
    decisions.restoreDeleted.length === 0 &&
    partsOf(decisions).length === 0
  );
}

export function hasPart(decisions: FileDecisions, line: number, part: number): boolean {
  return partsOf(decisions).some((ref) => ref.line === line && ref.part === part);
}

export function togglePart(
  decisions: FileDecisions,
  line: number,
  part: number,
): FileDecisions {
  const current = partsOf(decisions);
  const without = current.filter((ref) => !(ref.line === line && ref.part === part));
  return {
    ...decisions,
    revertParts:
      without.length === current.length
        ? [...current, { line, part }].sort((a, b) => a.line - b.line || a.part - b.part)
        : without,
  };
}

export interface DeletedLine {
  oldLine: number;
  text: string;
  /**
   * New-side line this deletion sat after, so restoring it puts the line back
   * where it was. Zero means it belongs before the first line of the file.
   */
  afterNewLine: number;
}

/**
 * Where each removed line goes if a reviewer wants it back. A deletion has no
 * new-side number of its own, so it is pinned to the last new-side line above
 * it within the same hunk.
 */
export function deletedLines(hunks: Hunk[]): DeletedLine[] {
  const out: DeletedLine[] = [];
  for (const hunk of hunks) {
    let lastNew = hunk.newStart - 1;
    for (const line of hunk.lines) {
      if (line.type === "del") {
        out.push({
          oldLine: line.oldLine ?? 0,
          text: line.text,
          afterNewLine: lastNew,
        });
        continue;
      }
      if (line.newLine !== undefined) lastNew = line.newLine;
    }
  }
  return out;
}

/** Added lines, by new-side line number, so callers can offer them for discard. */
export function addedLines(hunks: Hunk[]): number[] {
  const out: number[] = [];
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add" && line.newLine !== undefined) out.push(line.newLine);
    }
  }
  return out;
}

interface Text {
  lines: string[];
  trailingNewline: boolean;
}

function splitText(text: string): Text {
  const trailingNewline = text.endsWith("\n");
  const body = trailingNewline ? text.slice(0, -1) : text;
  return { lines: body.length ? body.split("\n") : [], trailingNewline };
}

function joinText({ lines, trailingNewline }: Text): string {
  return lines.join("\n") + (trailingNewline && lines.length ? "\n" : "");
}

export interface ApplyResult {
  text: string;
  discarded: number;
  restored: number;
  partsReverted: number;
}

/**
 * Rewrite `current` with the rejected parts of the diff undone: dropping added
 * lines the reviewer discarded and putting back deletions they rejected. Every
 * other line, including code the diff never touched, is passed through
 * untouched.
 */
export function applyDecisions(
  current: string,
  hunks: Hunk[],
  decisions: FileDecisions,
): ApplyResult {
  const discard = new Set(decisions.discardAdded);
  const wanted = new Set(decisions.restoreDeleted);

  const restoreAfter = new Map<number, string[]>();
  let restored = 0;
  for (const deletion of deletedLines(hunks)) {
    if (!wanted.has(deletion.oldLine)) continue;
    const bucket = restoreAfter.get(deletion.afterNewLine) ?? [];
    bucket.push(deletion.text);
    restoreAfter.set(deletion.afterNewLine, bucket);
    restored += 1;
  }

  // Part reverts are grouped per line: rewriting a line once, from all of its
  // reverted parts at the same time, is the only way two reverts on one line do
  // not overwrite each other.
  const partsPerLine = new Map<number, Set<number>>();
  for (const ref of partsOf(decisions)) {
    if (discard.has(ref.line)) continue;
    const bucket = partsPerLine.get(ref.line) ?? new Set<number>();
    bucket.add(ref.part);
    partsPerLine.set(ref.line, bucket);
  }
  const available = partsPerLine.size ? partsByNewLine(hunks) : new Map();

  const source = splitText(current);
  const out: string[] = [];
  let discarded = 0;
  let partsReverted = 0;

  out.push(...(restoreAfter.get(0) ?? []));
  source.lines.forEach((text, index) => {
    const newLine = index + 1;
    if (discard.has(newLine)) {
      discarded += 1;
    } else {
      const wanted = partsPerLine.get(newLine);
      const parts = wanted && available.get(newLine);
      if (wanted && parts) {
        const usable = [...wanted].filter((part) => parts[part]?.changed);
        out.push(usable.length ? applyPartReverts(parts, usable) : text);
        partsReverted += usable.length;
      } else {
        out.push(text);
      }
    }
    const back = restoreAfter.get(newLine);
    if (back) out.push(...back);
  });

  return {
    text: joinText({ lines: out, trailingNewline: source.trailingNewline }),
    discarded,
    restored,
    partsReverted,
  };
}

/**
 * Replace a run of new-side lines with edited text, for a reviewer who would
 * rather fix the code than reject it.
 */
export function replaceRange(
  current: string,
  startNewLine: number,
  endNewLine: number,
  replacement: string,
): string {
  const source = splitText(current);
  if (startNewLine < 1 || endNewLine < startNewLine) {
    throw new Error(`Invalid range ${startNewLine}..${endNewLine}`);
  }
  if (endNewLine > source.lines.length) {
    throw new Error(
      `Range ${startNewLine}..${endNewLine} runs past the end of the file (${source.lines.length} lines)`,
    );
  }
  const replacementLines = splitText(
    replacement.endsWith("\n") ? replacement : `${replacement}\n`,
  ).lines;
  const lines = [
    ...source.lines.slice(0, startNewLine - 1),
    ...replacementLines,
    ...source.lines.slice(endNewLine),
  ];
  return joinText({ lines, trailingNewline: source.trailingNewline });
}

/** The new-side text of a hunk, which is what an inline editor starts from. */
export function hunkNewText(hunk: Hunk): string {
  return hunk.lines
    .filter((line) => line.type !== "del")
    .map((line) => line.text)
    .join("\n");
}

export function hunkNewRange(hunk: Hunk): [number, number] | null {
  const numbers = hunk.lines
    .filter((line) => line.type !== "del" && line.newLine !== undefined)
    .map((line) => line.newLine as number);
  if (!numbers.length) return null;
  return [Math.min(...numbers), Math.max(...numbers)];
}

/** Total decisions across files, for a summary the reviewer can act on. */
export function summarize(all: Record<string, FileDecisions>): {
  files: number;
  discarded: number;
  restored: number;
  parts: number;
} {
  let files = 0;
  let discarded = 0;
  let restored = 0;
  let parts = 0;
  for (const decisions of Object.values(all)) {
    if (isEmpty(decisions)) continue;
    files += 1;
    discarded += decisions.discardAdded.length;
    restored += decisions.restoreDeleted.length;
    parts += partsOf(decisions).length;
  }
  return { files, discarded, restored, parts };
}

/**
 * Whether a file section can be acted on: the diff describes the working tree
 * only if the file is still byte-identical to the side the review recorded.
 */
export function isActionable(
  file: Pick<FileSection, "newSha" | "binary" | "status">,
  actualSha: string | null,
): boolean {
  if (file.binary || !file.newSha || !actualSha) return false;
  return actualSha.startsWith(file.newSha) || file.newSha.startsWith(actualSha);
}
