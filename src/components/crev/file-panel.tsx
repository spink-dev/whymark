"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FileDiff, FilePlus2, FileMinus2, FileSymlink, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { layoutCards, type Anchor } from "@/lib/crev/align";
import type { Note } from "@/lib/crev/types";
import type { FileVM, RowVM } from "@/lib/view-model";
import { KIND_META } from "./meta";
import { NoteCard } from "./note-card";
import { Tokens } from "./code-line";
import { CoverageBar } from "./meters";

const LINE_H = 21;
const GUTTER = 30;
const CARD_GAP = 10;

export type ViewMode = "unified" | "split";

interface DisplayRow {
  key: string;
  kind: "hunk" | "context" | "add" | "del" | "pair";
  noteIds: string[];
  /** Unified row payload. */
  row?: RowVM;
  /** Split row payload. */
  left?: RowVM | null;
  right?: RowVM | null;
  label?: string;
  text?: string;
}

interface FilePanelProps {
  file: FileVM;
  mode: ViewMode;
  visibleNoteIds: Set<string>;
  activeNoteId: string | null;
  onActivate: (noteId: string | null) => void;
  compact: boolean;
  index: number;
}

export function FilePanel({
  file,
  mode,
  visibleNoteIds,
  activeNoteId,
  onActivate,
  compact,
  index,
}: FilePanelProps) {
  const notes = useMemo(
    () => file.notes.filter((note) => visibleNoteIds.has(note.id)),
    [file.notes, visibleNoteIds],
  );

  const rows = useMemo<DisplayRow[]>(
    () => (mode === "split" ? toSplitRows(file.rows) : toUnifiedRows(file.rows)),
    [file.rows, mode],
  );

  const anchors = useMemo(() => anchorsForRows(rows, notes), [rows, notes]);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [hovered, setHovered] = useState<string | null>(null);

  const measure = useCallback(() => {
    setHeights((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const [id, element] of cardRefs.current) {
        const height = element.offsetHeight;
        if (height && next[id] !== height) {
          next[id] = height;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, []);

  useLayoutEffect(measure, [measure, notes, mode, compact]);

  useEffect(() => {
    if (compact) return;
    const observer = new ResizeObserver(measure);
    for (const element of cardRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [measure, notes, compact]);

  const tops = useMemo(
    () =>
      layoutCards(
        anchors,
        (id) => heights[id] ?? 132,
        (row) => row * LINE_H,
        CARD_GAP,
      ),
    [anchors, heights],
  );

  const codeHeight = rows.length * LINE_H;
  const railHeight = Math.max(
    codeHeight,
    ...anchors.map((a) => (tops.get(a.noteId) ?? 0) + (heights[a.noteId] ?? 132) + 4),
  );

  const highlighted = hovered ?? activeNoteId;
  const highlightKind = highlighted
    ? (file.notes.find((n) => n.id === highlighted)?.kind ?? null)
    : null;

  const fileLevelNotes = notes.filter(
    (note) => note.selector.side === "file" || note.selector.side === "doc",
  );

  const StatusIcon =
    file.status === "added"
      ? FilePlus2
      : file.status === "deleted"
        ? FileMinus2
        : file.status === "renamed"
          ? FileSymlink
          : FileDiff;

  return (
    <section
      id={`file-${index}`}
      className="scroll-mt-[76px] overflow-hidden rounded-xl border border-border/70 bg-card/40"
    >
      <header className="sticky top-[57px] z-20 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/70 bg-[color-mix(in_oklch,var(--card)_92%,var(--background))] px-3 py-2 backdrop-blur">
        <StatusIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 font-mono text-[12.5px] font-medium">
          {file.oldPath && file.oldPath !== file.path ? (
            <span className="text-muted-foreground">
              {file.oldPath} <span className="px-1">→</span>
            </span>
          ) : null}
          <span className="break-all">{file.path}</span>
        </h3>
        <span className="font-mono text-[11px] tabular-nums">
          <span className="text-[color:var(--crev-add)]">+{file.added}</span>{" "}
          <span className="text-[color:var(--crev-del)]">−{file.removed}</span>
        </span>
        <span className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <MessageSquare className="size-3" />
            {file.notes.length}
          </span>
          <CoverageBar
            value={file.stats.coverage}
            width={72}
            label={`${file.stats.covered} of ${file.stats.added} added lines annotated`}
          />
        </span>
      </header>

      {fileLevelNotes.length ? (
        <div className="space-y-2 border-b border-border/60 bg-background/40 p-3">
          {fileLevelNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              scopeLabel="whole file"
              active={highlighted === note.id}
              onHover={setHovered}
              onSelect={onActivate}
            />
          ))}
        </div>
      ) : null}

      {compact ? (
        <CompactBody
          rows={rows}
          notes={notes}
          mode={mode}
          highlighted={highlighted}
          onHover={setHovered}
          onActivate={onActivate}
        />
      ) : (
        <div
          className="grid"
          style={{
            gridTemplateColumns: `minmax(0,1fr) ${GUTTER}px minmax(300px, 25vw)`,
          }}
        >
          <div className="crev-scroll overflow-x-auto border-r border-border/40">
            <div className="crev-code w-max min-w-full">
              {rows.map((row) => (
                <CodeRow
                  key={row.key}
                  row={row}
                  mode={mode}
                  notes={notes}
                  highlighted={highlighted}
                  highlightKind={highlightKind}
                  onHover={setHovered}
                  onActivate={onActivate}
                />
              ))}
            </div>
          </div>

          <Connectors
            anchors={anchors}
            tops={tops}
            heights={heights}
            notes={notes}
            highlighted={highlighted}
            height={railHeight}
          />

          <div className="relative" style={{ height: railHeight }}>
            {anchors.map((anchor) => {
              const note = notes.find((n) => n.id === anchor.noteId);
              if (!note) return null;
              return (
                <div
                  key={note.id}
                  className="absolute right-2 left-1 transition-[top] duration-200"
                  style={{ top: tops.get(note.id) ?? 0 }}
                >
                  <NoteCard
                    ref={(element) => {
                      if (element) cardRefs.current.set(note.id, element);
                      else cardRefs.current.delete(note.id);
                    }}
                    note={note}
                    active={highlighted === note.id}
                    dimmed={Boolean(highlighted) && highlighted !== note.id}
                    onHover={setHovered}
                    onSelect={onActivate}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function CodeRow({
  row,
  mode,
  notes,
  highlighted,
  highlightKind,
  onHover,
  onActivate,
}: {
  row: DisplayRow;
  mode: ViewMode;
  notes: Note[];
  highlighted: string | null;
  highlightKind: string | null;
  onHover: (id: string | null) => void;
  onActivate: (id: string | null) => void;
}) {
  const covered = row.noteIds.length > 0;
  const isHighlighted = highlighted !== null && row.noteIds.includes(highlighted);
  const accentKind = covered
    ? (notes.find((n) => n.id === row.noteIds[0])?.kind ?? "note")
    : null;
  const accent = accentKind ? KIND_META[accentKind].color : null;

  if (row.kind === "hunk") {
    return (
      <div className="crev-row flex items-center gap-2 border-y border-border/40 bg-foreground/[0.04] px-2 text-[11px] text-muted-foreground">
        <span className="font-mono">{row.text}</span>
        {row.label ? <span className="truncate opacity-70">{row.label}</span> : null}
      </div>
    );
  }

  const onEnter = () => {
    if (row.noteIds.length) onHover(row.noteIds[0]);
  };
  const onLeave = () => onHover(null);
  const onClick = () => {
    if (row.noteIds.length) onActivate(row.noteIds[0]);
  };

  const marker =
    row.kind === "add"
      ? { sign: "+", bg: "var(--crev-add-bg)" }
      : row.kind === "del"
        ? { sign: "−", bg: "var(--crev-del-bg)" }
        : { sign: " ", bg: undefined };

  if (mode === "split") {
    return (
      <div
        className={cn("crev-row flex", covered && "cursor-pointer")}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onClick={onClick}
        style={
          isHighlighted && highlightKind
            ? { backgroundColor: `color-mix(in oklch, ${KIND_META[highlightKind as keyof typeof KIND_META].color} 13%, transparent)` }
            : undefined
        }
      >
        <SplitCell cell={row.left} side="del" />
        <span className="w-px shrink-0 bg-border/60" />
        <SplitCell cell={row.right} side="add" />
        <span
          className="w-[3px] shrink-0"
          style={{ backgroundColor: accent ?? "transparent" }}
        />
      </div>
    );
  }

  const line = row.row!;

  return (
    <div
      className={cn("crev-row flex", covered && "cursor-pointer")}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onClick}
      style={{
        backgroundColor:
          isHighlighted && highlightKind
            ? `color-mix(in oklch, ${KIND_META[highlightKind as keyof typeof KIND_META].color} 13%, transparent)`
            : marker.bg,
      }}
    >
      <span className="crev-gutter w-11 shrink-0 pr-2 text-right text-[11px] tabular-nums">
        {line.oldLine ?? ""}
      </span>
      <span className="crev-gutter w-11 shrink-0 pr-2 text-right text-[11px] tabular-nums">
        {line.newLine ?? ""}
      </span>
      <span
        className="w-[3px] shrink-0"
        style={{ backgroundColor: accent ?? "transparent" }}
      />
      <span
        className={cn(
          "w-4 shrink-0 pl-1 text-center",
          row.kind === "add"
            ? "text-[color:var(--crev-add)]"
            : row.kind === "del"
              ? "text-[color:var(--crev-del)]"
              : "text-transparent",
        )}
      >
        {marker.sign}
      </span>
      <span className="pr-6">
        <Tokens
          tokens={line.tokens}
          intra={line.intra}
          tone={row.kind === "add" ? "add" : "del"}
        />
      </span>
    </div>
  );
}

function SplitCell({ cell, side }: { cell?: RowVM | null; side: "add" | "del" }) {
  if (!cell) {
    return (
      <span className="flex min-w-0 flex-1 bg-foreground/[0.02]">
        <span className="crev-gutter w-11 shrink-0" />
      </span>
    );
  }
  const changed = cell.kind === "add" || cell.kind === "del";
  return (
    <span
      className="flex min-w-0 flex-1"
      style={{
        backgroundColor: changed
          ? side === "add"
            ? "var(--crev-add-bg)"
            : "var(--crev-del-bg)"
          : undefined,
      }}
    >
      <span className="crev-gutter w-11 shrink-0 pr-2 text-right text-[11px] tabular-nums">
        {side === "add" ? (cell.newLine ?? "") : (cell.oldLine ?? "")}
      </span>
      <span
        className={cn(
          "w-4 shrink-0 text-center",
          changed
            ? side === "add"
              ? "text-[color:var(--crev-add)]"
              : "text-[color:var(--crev-del)]"
            : "text-transparent",
        )}
      >
        {changed ? (side === "add" ? "+" : "−") : " "}
      </span>
      <span className="pr-6">
        <Tokens tokens={cell.tokens} intra={cell.intra} tone={side} />
      </span>
    </span>
  );
}

/** Curved leaders from each annotated line range to its card. */
function Connectors({
  anchors,
  tops,
  heights,
  notes,
  highlighted,
  height,
}: {
  anchors: Anchor[];
  tops: Map<string, number>;
  heights: Record<string, number>;
  notes: Note[];
  highlighted: string | null;
  height: number;
}) {
  return (
    <svg
      width={GUTTER}
      height={height}
      className="pointer-events-none block"
      aria-hidden
    >
      {anchors.map((anchor) => {
        const note = notes.find((n) => n.id === anchor.noteId);
        if (!note) return null;
        const color = KIND_META[note.kind].color;
        const top = anchor.startRow * LINE_H;
        const bottom = (anchor.endRow + 1) * LINE_H;
        const cardTop = tops.get(note.id) ?? top;
        const cardHeight = heights[note.id] ?? 132;
        const active = highlighted === note.id;
        const lineMid = (top + bottom) / 2;
        const cardMid = Math.min(cardTop + 18, cardTop + cardHeight / 2);

        return (
          <g
            key={note.id}
            opacity={highlighted && !active ? 0.28 : 1}
            style={{ transition: "opacity 150ms" }}
          >
            <path
              d={`M 3 ${top + 1} L 3 ${bottom - 1}`}
              stroke={color}
              strokeWidth={active ? 2.5 : 1.5}
              strokeLinecap="round"
              fill="none"
            />
            <path
              d={`M 3 ${lineMid} C ${GUTTER * 0.55} ${lineMid} ${GUTTER * 0.45} ${cardMid} ${GUTTER} ${cardMid}`}
              stroke={color}
              strokeWidth={active ? 1.6 : 1}
              strokeDasharray={active ? undefined : "3 3"}
              fill="none"
              opacity={0.8}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** Narrow screens: annotations follow the code they describe instead of sitting beside it. */
function CompactBody({
  rows,
  notes,
  mode,
  highlighted,
  onHover,
  onActivate,
}: {
  rows: DisplayRow[];
  notes: Note[];
  mode: ViewMode;
  highlighted: string | null;
  onHover: (id: string | null) => void;
  onActivate: (id: string | null) => void;
}) {
  const groups = useMemo(() => {
    const emitted = new Set<string>();
    const out: Array<{ rows: DisplayRow[]; notes: Note[] }> = [];
    let bucket: DisplayRow[] = [];

    for (const row of rows) {
      bucket.push(row);
      const ready = notes.filter(
        (note) =>
          !emitted.has(note.id) &&
          row.noteIds.includes(note.id) &&
          isLastRowOf(note.id, row, rows),
      );
      if (ready.length) {
        for (const note of ready) emitted.add(note.id);
        out.push({ rows: bucket, notes: ready });
        bucket = [];
      }
    }
    if (bucket.length) out.push({ rows: bucket, notes: [] });
    return out;
  }, [rows, notes]);

  return (
    <div>
      {groups.map((group, index) => (
        <div key={index}>
          <div className="crev-scroll overflow-x-auto">
            <div className="crev-code w-max min-w-full">
              {group.rows.map((row) => (
                <CodeRow
                  key={row.key}
                  row={row}
                  mode={mode}
                  notes={notes}
                  highlighted={highlighted}
                  highlightKind={
                    highlighted
                      ? (notes.find((n) => n.id === highlighted)?.kind ?? null)
                      : null
                  }
                  onHover={onHover}
                  onActivate={onActivate}
                />
              ))}
            </div>
          </div>
          {group.notes.length ? (
            <div className="space-y-2 border-y border-border/50 bg-background/40 p-2.5">
              {group.notes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  active={highlighted === note.id}
                  onHover={onHover}
                  onSelect={onActivate}
                />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function isLastRowOf(noteId: string, row: DisplayRow, rows: DisplayRow[]): boolean {
  const last = [...rows].reverse().find((r) => r.noteIds.includes(noteId));
  return last?.key === row.key;
}

/* ------------------------------------------------------------------ */

function toUnifiedRows(rows: RowVM[]): DisplayRow[] {
  return rows.map((row) => ({
    key: row.key,
    kind: row.kind,
    noteIds: row.noteIds,
    row,
    label: row.label,
    text: row.text,
  }));
}

function toSplitRows(rows: RowVM[]): DisplayRow[] {
  const out: DisplayRow[] = [];
  let i = 0;
  let pair = 0;

  while (i < rows.length) {
    const row = rows[i];
    if (row.kind === "hunk") {
      out.push({
        key: row.key,
        kind: "hunk",
        noteIds: [],
        label: row.label,
        text: row.text,
      });
      i++;
      continue;
    }
    if (row.kind === "context") {
      out.push({
        key: `p${pair++}`,
        kind: "pair",
        noteIds: row.noteIds,
        left: row,
        right: row,
      });
      i++;
      continue;
    }
    const dels: RowVM[] = [];
    const adds: RowVM[] = [];
    while (i < rows.length && rows[i].kind === "del") dels.push(rows[i++]);
    while (i < rows.length && rows[i].kind === "add") adds.push(rows[i++]);
    const height = Math.max(dels.length, adds.length);
    for (let k = 0; k < height; k++) {
      const left = dels[k] ?? null;
      const right = adds[k] ?? null;
      out.push({
        key: `p${pair++}`,
        kind: "pair",
        noteIds: [...(left?.noteIds ?? []), ...(right?.noteIds ?? [])],
        left,
        right,
      });
    }
  }

  return out;
}

function anchorsForRows(rows: DisplayRow[], notes: Note[]): Anchor[] {
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  rows.forEach((row, index) => {
    for (const id of row.noteIds) {
      if (!first.has(id)) first.set(id, index);
      last.set(id, index);
    }
  });

  return notes
    .filter((note) => note.selector.side === "new" || note.selector.side === "old")
    .map((note) => ({
      noteId: note.id,
      startRow: first.get(note.id) ?? 0,
      endRow: last.get(note.id) ?? 0,
      fileLevel: !first.has(note.id),
    }))
    .sort((a, b) => a.startRow - b.startRow);
}
