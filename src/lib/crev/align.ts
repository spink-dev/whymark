import type { DiffLine, FileSection, Hunk, Note } from "./types";

export type RowKind = "hunk" | "context" | "add" | "del" | "nonewline";

export interface Row {
  key: string;
  kind: RowKind;
  text: string;
  oldLine?: number;
  newLine?: number;
  /** Hunk heading, for `kind === "hunk"`. */
  label?: string;
  /** Notes whose selector covers this row. */
  noteIds: string[];
}

export interface SplitCell {
  kind: "context" | "add" | "del" | "empty";
  text: string;
  line?: number;
}

export interface SplitRow {
  key: string;
  kind: "hunk" | "pair";
  label?: string;
  left: SplitCell;
  right: SplitCell;
  noteIds: string[];
}

export interface Anchor {
  noteId: string;
  /** Index of the first row the note covers. */
  startRow: number;
  endRow: number;
  /** True when the note covers the file rather than specific lines. */
  fileLevel: boolean;
}

export function buildRows(file: FileSection): Row[] {
  const rows: Row[] = [];
  file.hunks.forEach((hunk, hunkIndex) => {
    rows.push({
      key: `h${hunkIndex}`,
      kind: "hunk",
      text: hunkHeaderText(hunk),
      label: hunk.heading,
      noteIds: [],
    });
    hunk.lines.forEach((line, lineIndex) => {
      rows.push({
        key: `h${hunkIndex}l${lineIndex}`,
        kind: line.type,
        text: line.text,
        oldLine: line.oldLine,
        newLine: line.newLine,
        noteIds: [],
      });
    });
  });
  attachNotes(rows, file.notes);
  return rows;
}

export function buildSplitRows(file: FileSection): SplitRow[] {
  const rows: SplitRow[] = [];
  file.hunks.forEach((hunk, hunkIndex) => {
    rows.push({
      key: `h${hunkIndex}`,
      kind: "hunk",
      text: hunkHeaderText(hunk),
      label: hunk.heading,
      left: { kind: "empty", text: "" },
      right: { kind: "empty", text: "" },
      noteIds: [],
    } as SplitRow & { text: string });

    let i = 0;
    let pairIndex = 0;
    while (i < hunk.lines.length) {
      const line = hunk.lines[i];
      if (line.type === "context") {
        rows.push({
          key: `h${hunkIndex}p${pairIndex++}`,
          kind: "pair",
          left: { kind: "context", text: line.text, line: line.oldLine },
          right: { kind: "context", text: line.text, line: line.newLine },
          noteIds: [],
        });
        i++;
        continue;
      }
      if (line.type === "nonewline") {
        i++;
        continue;
      }
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < hunk.lines.length && hunk.lines[i].type === "del") {
        dels.push(hunk.lines[i++]);
      }
      while (i < hunk.lines.length && hunk.lines[i].type === "add") {
        adds.push(hunk.lines[i++]);
      }
      const height = Math.max(dels.length, adds.length);
      for (let k = 0; k < height; k++) {
        const del = dels[k];
        const add = adds[k];
        rows.push({
          key: `h${hunkIndex}p${pairIndex++}`,
          kind: "pair",
          left: del
            ? { kind: "del", text: del.text, line: del.oldLine }
            : { kind: "empty", text: "" },
          right: add
            ? { kind: "add", text: add.text, line: add.newLine }
            : { kind: "empty", text: "" },
          noteIds: [],
        });
      }
    }
  });

  for (const note of file.notes) {
    const { side, start, end } = note.selector;
    if (side !== "new" && side !== "old") continue;
    for (const row of rows) {
      if (row.kind !== "pair") continue;
      const cell = side === "new" ? row.right : row.left;
      if (cell.line !== undefined && cell.line >= start && cell.line <= end) {
        row.noteIds.push(note.id);
      }
    }
  }

  return rows;
}

function attachNotes(rows: Row[], notes: Note[]) {
  for (const note of notes) {
    const { side, start, end } = note.selector;
    if (side !== "new" && side !== "old") continue;
    for (const row of rows) {
      const n = side === "new" ? row.newLine : row.oldLine;
      if (n !== undefined && n >= start && n <= end) row.noteIds.push(note.id);
    }
  }
}

export function hunkHeaderText(hunk: Hunk): string {
  const old = `-${hunk.oldStart},${hunk.lines.filter((l) => l.type !== "add").length}`;
  const next = `+${hunk.newStart},${hunk.lines.filter((l) => l.type !== "del").length}`;
  return `@@ ${old} ${next} @@`;
}

/** Row range each note should be drawn against, in document order. */
export function anchorsFor(
  rows: Array<{ noteIds: string[] }>,
  notes: Note[],
): Anchor[] {
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  rows.forEach((row, index) => {
    for (const id of row.noteIds) {
      if (!first.has(id)) first.set(id, index);
      last.set(id, index);
    }
  });

  return notes
    .map((note) => {
      const startRow = first.get(note.id);
      if (startRow === undefined) {
        return {
          noteId: note.id,
          startRow: 0,
          endRow: 0,
          fileLevel: true,
        } satisfies Anchor;
      }
      return {
        noteId: note.id,
        startRow,
        endRow: last.get(note.id) ?? startRow,
        fileLevel: false,
      } satisfies Anchor;
    })
    .sort((a, b) => a.startRow - b.startRow || a.noteId.localeCompare(b.noteId));
}

/**
 * Cards are placed at their line's offset and pushed down when they collide, so
 * an annotation is never drawn far from the code it describes and never on top
 * of another one.
 */
export function layoutCards(
  anchors: Anchor[],
  measure: (noteId: string) => number,
  rowTop: (row: number) => number,
  gap = 10,
): Map<string, number> {
  const tops = new Map<string, number>();
  let cursor = -Infinity;
  for (const anchor of anchors) {
    const desired = rowTop(anchor.startRow);
    const top = Math.max(desired, cursor + gap);
    tops.set(anchor.noteId, top);
    cursor = top + measure(anchor.noteId);
  }
  return tops;
}

export interface RailLayout {
  /** Top offset, in pixels, of each card. */
  tops: Map<string, number>;
  /** Blank space to open above a row so its card can stay level with it. */
  padding: Map<number, number>;
  /** Pixels of padding inserted at or above each row, as a running total. */
  offsets: number[];
  height: number;
}

/**
 * Stacking cards alone makes a tall annotation push every later one hundreds of
 * pixels below the code it describes. Instead, whenever a card cannot start at
 * its own first line, the same distance is opened in the code column, so a card
 * and its lines always begin on the same horizontal line.
 */
export function layoutRail(
  anchors: Anchor[],
  measure: (noteId: string) => number,
  rowCount: number,
  lineHeight: number,
  gap = 10,
): RailLayout {
  const tops = new Map<string, number>();
  const padding = new Map<number, number>();
  let shift = 0;
  let cursor = -Infinity;

  for (const anchor of anchors) {
    const lineTop = anchor.startRow * lineHeight + shift;
    const top = Math.max(lineTop, cursor + gap);
    const pad = top - lineTop;
    if (pad > 0.5) {
      padding.set(anchor.startRow, (padding.get(anchor.startRow) ?? 0) + pad);
      shift += pad;
    }
    tops.set(anchor.noteId, top);
    cursor = top + measure(anchor.noteId);
  }

  const offsets: number[] = [];
  let running = 0;
  for (let row = 0; row < rowCount; row++) {
    running += padding.get(row) ?? 0;
    offsets.push(running);
  }

  return {
    tops,
    padding,
    offsets,
    height: Math.max(rowCount * lineHeight + shift, cursor === -Infinity ? 0 : cursor),
  };
}
