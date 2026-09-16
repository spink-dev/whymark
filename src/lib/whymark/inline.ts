/**
 * Splitting a replaced line into the parts that actually changed.
 *
 * A line is too coarse a unit to decide with. When a change renames a variable
 * and also alters a number on the same line, a reviewer may want the rename and
 * not the number. Comparing the two sides word by word gives independently
 * revertible parts, so keeping the new code and undoing one piece of it is a
 * single decision rather than a hand edit.
 */
import type { DiffLine, Hunk } from "./types";

export interface InlinePart {
  /** True when the two sides differ here, which is what can be reverted. */
  changed: boolean;
  old: string;
  new: string;
  /** Character offsets of this part within the old and new line. */
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

/**
 * Words, whitespace runs, and single punctuation characters. Splitting on
 * identifier boundaries keeps a rename as one part instead of a scatter of
 * shared letters, which is what makes the parts worth clicking.
 */
export function tokenizeInline(text: string): string[] {
  return text.match(/[A-Za-z0-9_$]+|\s+|[^A-Za-z0-9_$\s]/g) ?? [];
}

/**
 * If nearly the whole line differs, one part covering all of it is more honest
 * than a mosaic of fragments a reviewer cannot reason about.
 */
const COLLAPSE_ABOVE = 0.7;

export function inlineParts(before: string, after: string): InlinePart[] {
  if (before === after) {
    return [wholePart(before, after, false)];
  }
  if (!before || !after) {
    return [wholePart(before, after, true)];
  }

  const oldTokens = tokenizeInline(before);
  const newTokens = tokenizeInline(after);
  const parts = groupRuns(oldTokens, newTokens, commonSubsequence(oldTokens, newTokens));

  const changedChars = parts
    .filter((part) => part.changed)
    .reduce((total, part) => total + Math.max(part.new.length, part.old.length), 0);
  const longest = Math.max(before.length, after.length);
  if (longest > 0 && changedChars / longest > COLLAPSE_ABOVE) {
    return [wholePart(before, after, true)];
  }

  return withOffsets(parts);
}

function wholePart(before: string, after: string, changed: boolean): InlinePart {
  return {
    changed,
    old: before,
    new: after,
    oldStart: 0,
    oldEnd: before.length,
    newStart: 0,
    newEnd: after.length,
  };
}

/** Longest common subsequence of two token lists, as index pairs. */
function commonSubsequence(a: string[], b: string[]): Array<[number, number]> {
  const rows = a.length;
  const cols = b.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  );

  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

type RawPart = Pick<InlinePart, "changed" | "old" | "new">;

/** Walk both sides together, collecting each run of shared or differing tokens. */
function groupRuns(
  oldTokens: string[],
  newTokens: string[],
  shared: Array<[number, number]>,
): RawPart[] {
  const parts: RawPart[] = [];
  let oldAt = 0;
  let newAt = 0;

  const push = (changed: boolean, old: string, next: string) => {
    if (!old && !next) return;
    const last = parts.at(-1);
    if (last && last.changed === changed) {
      last.old += old;
      last.new += next;
      return;
    }
    parts.push({ changed, old, new: next });
  };

  for (const [oldIndex, newIndex] of shared) {
    push(
      true,
      oldTokens.slice(oldAt, oldIndex).join(""),
      newTokens.slice(newAt, newIndex).join(""),
    );
    push(false, oldTokens[oldIndex], newTokens[newIndex]);
    oldAt = oldIndex + 1;
    newAt = newIndex + 1;
  }
  push(true, oldTokens.slice(oldAt).join(""), newTokens.slice(newAt).join(""));

  return parts;
}

function withOffsets(parts: RawPart[]): InlinePart[] {
  let oldAt = 0;
  let newAt = 0;
  return parts.map((part) => {
    const entry: InlinePart = {
      ...part,
      oldStart: oldAt,
      oldEnd: oldAt + part.old.length,
      newStart: newAt,
      newEnd: newAt + part.new.length,
    };
    oldAt = entry.oldEnd;
    newAt = entry.newEnd;
    return entry;
  });
}

/** The line as it will read once the listed parts are taken back to the old side. */
export function applyPartReverts(parts: InlinePart[], reverted: Iterable<number>): string {
  const undo = new Set(reverted);
  return parts
    .map((part, index) => (part.changed && undo.has(index) ? part.old : part.new))
    .join("");
}

export interface LinePair {
  oldLine: number;
  newLine: number;
  oldText: string;
  newText: string;
}

/**
 * How much two lines have in common, from 0 to 1.
 *
 * Shared tokens are weighted by how many characters they carry, and whitespace
 * is ignored. Counting tokens equally made almost any two lines look alike,
 * because `(`, `)` and `;` are common to most code.
 */
export function lineSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const left = tokenizeInline(a.trim());
  const right = tokenizeInline(b.trim());
  const weigh = (tokens: string[]) =>
    tokens.reduce((total, token) => total + token.trim().length, 0);

  const total = weigh(left) + weigh(right);
  if (!total) return 0;

  const shared = commonSubsequence(left, right).reduce(
    (sum, [index]) => sum + left[index].trim().length,
    0,
  );
  return (2 * shared) / total;
}

/** Below this, two lines are different code rather than one line edited. */
const PAIR_THRESHOLD = 0.5;

/**
 * Replaced lines, matched old to new.
 *
 * Pairing by position alone only works when a run removed and added the same
 * number of lines, and "one line edited, one line added next to it" is far too
 * common to give up on. So the most similar surviving candidates are matched
 * first, and anything that shares less than half its tokens is left unpaired —
 * a pair that wrong would offer a revert to text from an unrelated line.
 */
export function linePairs(hunks: Hunk[]): LinePair[] {
  const pairs: LinePair[] = [];

  for (const hunk of hunks) {
    let i = 0;
    while (i < hunk.lines.length) {
      if (hunk.lines[i].type !== "del") {
        i++;
        continue;
      }
      const dels: DiffLine[] = [];
      while (i < hunk.lines.length && hunk.lines[i].type === "del") dels.push(hunk.lines[i++]);
      const adds: DiffLine[] = [];
      while (i < hunk.lines.length && hunk.lines[i].type === "add") adds.push(hunk.lines[i++]);

      const candidates: Array<{ del: number; add: number; score: number }> = [];
      dels.forEach((del, d) => {
        adds.forEach((add, a) => {
          const score = lineSimilarity(del.text, add.text);
          if (score >= PAIR_THRESHOLD) candidates.push({ del: d, add: a, score });
        });
      });
      // Ties resolve to the pairing closest to the diff's own ordering.
      candidates.sort(
        (x, y) =>
          y.score - x.score ||
          Math.abs(x.del - x.add) - Math.abs(y.del - y.add) ||
          x.del - y.del,
      );

      const usedDel = new Set<number>();
      const usedAdd = new Set<number>();
      for (const candidate of candidates) {
        if (usedDel.has(candidate.del) || usedAdd.has(candidate.add)) continue;
        const del = dels[candidate.del];
        const add = adds[candidate.add];
        if (del.oldLine === undefined || add.newLine === undefined) continue;
        usedDel.add(candidate.del);
        usedAdd.add(candidate.add);
        pairs.push({
          oldLine: del.oldLine,
          newLine: add.newLine,
          oldText: del.text,
          newText: add.text,
        });
      }
    }
  }

  return pairs.sort((a, b) => a.newLine - b.newLine);
}

/** Revertible parts per replaced line, keyed by the new-side line number. */
export function partsByNewLine(hunks: Hunk[]): Map<number, InlinePart[]> {
  const out = new Map<number, InlinePart[]>();
  for (const pair of linePairs(hunks)) {
    const parts = inlineParts(pair.oldText, pair.newText);
    if (parts.some((part) => part.changed)) out.set(pair.newLine, parts);
  }
  return out;
}
