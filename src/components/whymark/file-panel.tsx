"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FileDiff,
  FilePlus2,
  FileMinus2,
  FileSymlink,
  Lock,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { layoutRail, type Anchor } from "@/lib/whymark/align";
import {
  NO_DECISIONS,
  partsOf,
  togglePart,
  type FileDecisions,
} from "@/lib/whymark/edit";
import type { Note } from "@/lib/whymark/types";
import type { FileVM, RowVM } from "@/lib/view-model";
import { KIND_META } from "./meta";
import { NoteCard } from "./note-card";
import { Tokens } from "./code-line";
import { CoverageBar } from "./meters";
import {
  HunkControls,
  HunkEditor,
  LineControl,
  partHandlers,
  toggleLine,
  verdictFor,
  type LineVerdict,
} from "./decide";

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

/** One hunk's changed lines, so it can be rejected or edited as a unit. */
interface HunkSpan {
  key: string;
  adds: number[];
  dels: number[];
  range: [number, number] | null;
  text: string;
}

export interface SaveEdit {
  (
    path: string,
    start: number,
    end: number,
    text: string,
  ): Promise<{
    ok: boolean;
    error?: string;
  }>;
}

interface FilePanelProps {
  file: FileVM;
  mode: ViewMode;
  visibleNoteIds: Set<string>;
  activeNoteId: string | null;
  onActivate: (noteId: string | null) => void;
  compact: boolean;
  index: number;
  /** Decisions collected so far for this file. */
  decisions?: FileDecisions;
  onDecisions?: (path: string, next: FileDecisions) => void;
  onSaveEdit?: SaveEdit;
  /** False for a pasted review, which has no file on disk to write to. */
  editable?: boolean;
}

export function FilePanel({
  file,
  mode,
  visibleNoteIds,
  activeNoteId,
  onActivate,
  compact,
  index,
  decisions = NO_DECISIONS,
  onDecisions,
  onSaveEdit,
  editable = false,
}: FilePanelProps) {
  const notes = useMemo(
    () => file.notes.filter((note) => visibleNoteIds.has(note.id)),
    [file.notes, visibleNoteIds],
  );

  // A file that was added or deleted has nothing on the other side, so a split
  // view would spend half the width on an empty column.
  const oneSided = file.status === "added" || file.status === "deleted";
  const effectiveMode: ViewMode =
    mode === "split" && oneSided ? "unified" : mode;

  const rows = useMemo<DisplayRow[]>(
    () =>
      effectiveMode === "split"
        ? toSplitRows(file.rows)
        : toUnifiedRows(file.rows),
    [file.rows, effectiveMode],
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

  useLayoutEffect(measure, [measure, notes, effectiveMode, compact]);

  useEffect(() => {
    if (compact) return;
    const observer = new ResizeObserver(measure);
    for (const element of cardRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [measure, notes, compact]);

  const rail = useMemo(
    () =>
      layoutRail(
        anchors,
        (id) => heights[id] ?? 132,
        rows.length,
        LINE_H,
        CARD_GAP,
      ),
    [anchors, heights, rows.length],
  );
  const { tops, padding, offsets } = rail;
  const railHeight = rail.height;

  const highlighted = hovered ?? activeNoteId;
  const highlightKind = highlighted
    ? (file.notes.find((n) => n.id === highlighted)?.kind ?? null)
    : null;

  /* ---- decisions -------------------------------------------------- */

  const canDecide = editable && file.actionable && !file.binary;
  const hunks = useMemo(() => collectHunks(file.rows), [file.rows]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const editingHunk = hunks.find((hunk) => hunk.key === editingKey) ?? null;

  const onToggle = useCallback(
    (row: RowVM) => onDecisions?.(file.path, toggleLine(decisions, row)),
    [decisions, file.path, onDecisions],
  );

  const onTogglePart = useCallback(
    (line: number, part: number) =>
      onDecisions?.(file.path, togglePart(decisions, line, part)),
    [decisions, file.path, onDecisions],
  );

  const discardHunk = useCallback(
    (hunk: HunkSpan) =>
      onDecisions?.(file.path, {
        discardAdded: merge(decisions.discardAdded, hunk.adds),
        restoreDeleted: merge(decisions.restoreDeleted, hunk.dels),
      }),
    [decisions, file.path, onDecisions],
  );

  const keepHunk = useCallback(
    (hunk: HunkSpan) =>
      onDecisions?.(file.path, {
        discardAdded: decisions.discardAdded.filter(
          (n) => !hunk.adds.includes(n),
        ),
        restoreDeleted: decisions.restoreDeleted.filter(
          (n) => !hunk.dels.includes(n),
        ),
      }),
    [decisions, file.path, onDecisions],
  );

  const decidedIn = useCallback(
    (hunk: HunkSpan) =>
      hunk.adds.filter((n) => decisions.discardAdded.includes(n)).length +
      hunk.dels.filter((n) => decisions.restoreDeleted.includes(n)).length,
    [decisions],
  );

  const saveEdit = async (text: string) => {
    if (!editingHunk?.range || !onSaveEdit) return;
    setSaving(true);
    setSaveError(null);
    const result = await onSaveEdit(
      file.path,
      editingHunk.range[0],
      editingHunk.range[1],
      text,
    );
    setSaving(false);
    if (result.ok) setEditingKey(null);
    else setSaveError(result.error ?? "The file could not be written.");
  };

  const rowProps = {
    notes,
    highlighted,
    highlightKind,
    onHover: setHovered,
    onActivate,
    decisions,
    canDecide,
    onToggle,
    onTogglePart,
    hunks,
    decidedIn,
    onDiscardHunk: discardHunk,
    onKeepHunk: keepHunk,
    onEditHunk: (hunk: HunkSpan) => {
      setSaveError(null);
      setEditingKey(hunk.key);
    },
  };

  const StatusIcon =
    file.status === "added"
      ? FilePlus2
      : file.status === "deleted"
        ? FileMinus2
        : file.status === "renamed"
          ? FileSymlink
          : FileDiff;

  const decidedTotal =
    decisions.discardAdded.length +
    decisions.restoreDeleted.length +
    partsOf(decisions).length;

  // The panel must not clip its own overflow. Any `overflow` ancestor becomes the
  // scrollport for the sticky header below, which then sticks 56px down inside
  // the panel — on top of the code — instead of under the toolbar. The rounded
  // corners come from the header and the body wrapper instead.
  return (
    <section
      id={`file-${index}`}
      className="scroll-mt-16 rounded-xl border border-border/70 bg-card/40"
    >
      <header className="sticky top-14 z-20 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-t-xl border-b border-border/70 bg-[color-mix(in_oklch,var(--card)_96%,var(--background))] px-3 py-2 backdrop-blur">
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
          <span className="text-[color:var(--whymark-add)]">+{file.added}</span>{" "}
          <span className="text-[color:var(--whymark-del)]">
            −{file.removed}
          </span>
        </span>

        {mode === "split" && oneSided ? (
          <span className="text-[11px] text-muted-foreground">
            {file.status} — nothing to compare, shown unified
          </span>
        ) : null}

        {editable && !file.actionable ? (
          <span
            className="flex items-center gap-1 text-[11px] text-muted-foreground"
            title="The file on disk no longer matches the version this review recorded, so it cannot be edited from here. Regenerate the review to edit it."
          >
            <Lock className="size-3" />
            read-only
          </span>
        ) : null}

        {decidedTotal > 0 ? (
          <span
            className="rounded border px-1.5 py-0.5 text-[10.5px]"
            style={{
              borderColor:
                "color-mix(in oklch, var(--whymark-del) 45%, transparent)",
              color: "var(--whymark-del)",
            }}
          >
            {decidedTotal} to undo
          </span>
        ) : null}

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

      <div className="overflow-hidden rounded-b-xl">
        {notes.filter(
          (note) =>
            note.selector.side === "file" || note.selector.side === "doc",
        ).length ? (
          <div className="space-y-2 border-b border-border/60 bg-background/40 p-3">
            {notes
              .filter(
                (note) =>
                  note.selector.side === "file" || note.selector.side === "doc",
              )
              .map((note) => (
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
          <CompactBody rows={rows} mode={effectiveMode} {...rowProps} />
        ) : (
          <div
            className="grid"
            style={{
              gridTemplateColumns: `minmax(0,1fr) ${GUTTER}px minmax(300px, 25vw)`,
            }}
          >
            {effectiveMode === "split" ? (
              <SplitBody rows={rows} padding={padding} {...rowProps} />
            ) : (
              <UnifiedBody rows={rows} padding={padding} {...rowProps} />
            )}

            <Connectors
              anchors={anchors}
              tops={tops}
              offsets={offsets}
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
      </div>

      <HunkEditor
        key={editingKey ?? "closed"}
        open={Boolean(editingHunk)}
        path={file.path}
        range={editingHunk?.range ?? null}
        initial={editingHunk?.text ?? ""}
        busy={saving}
        error={saveError}
        onCancel={() => setEditingKey(null)}
        onSave={saveEdit}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */

interface RowProps {
  notes: Note[];
  highlighted: string | null;
  highlightKind: string | null;
  onHover: (id: string | null) => void;
  onActivate: (id: string | null) => void;
  decisions: FileDecisions;
  canDecide: boolean;
  onToggle: (row: RowVM) => void;
  onTogglePart: (line: number, part: number) => void;
  hunks: HunkSpan[];
  decidedIn: (hunk: HunkSpan) => number;
  onDiscardHunk: (hunk: HunkSpan) => void;
  onKeepHunk: (hunk: HunkSpan) => void;
  onEditHunk: (hunk: HunkSpan) => void;
}

function UnifiedBody({
  rows,
  padding,
  ...rowProps
}: RowProps & { rows: DisplayRow[]; padding: Map<number, number> }) {
  return (
    <div
      data-whymark-body="unified"
      className="whymark-scroll overflow-x-auto border-r border-border/40"
    >
      <div className="whymark-code w-max min-w-full">
        {rows.map((row, index) => (
          <Fragment key={row.key}>
            <Gap height={padding.get(index)} />
            <UnifiedRow row={row} {...rowProps} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/**
 * Two columns that each clip and scroll their own code. Sharing one scroll area
 * let a long line on the left run underneath the right-hand column, which is the
 * one thing a side-by-side view must never do.
 */
function SplitBody({
  rows,
  padding,
  ...rowProps
}: RowProps & { rows: DisplayRow[]; padding: Map<number, number> }) {
  return (
    <div
      data-whymark-body="split"
      className="grid border-r border-border/40"
      style={{ gridTemplateColumns: "minmax(0,1fr) 1px minmax(0,1fr)" }}
    >
      <SplitColumn side="del" rows={rows} padding={padding} {...rowProps} />
      <span className="bg-border/60" aria-hidden />
      <SplitColumn side="add" rows={rows} padding={padding} {...rowProps} />
    </div>
  );
}

function SplitColumn({
  side,
  rows,
  padding,
  ...rowProps
}: RowProps & {
  side: "add" | "del";
  rows: DisplayRow[];
  padding: Map<number, number>;
}) {
  return (
    <div data-whymark-side={side} className="whymark-scroll min-w-0 overflow-x-auto">
      <div className="whymark-code w-max min-w-full">
        {rows.map((row, index) => (
          <Fragment key={row.key}>
            <Gap height={padding.get(index)} />
            <SplitRow row={row} side={side} {...rowProps} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function Gap({ height }: { height?: number }) {
  if (!height) return null;
  return <div className="whymark-gap" style={{ height }} aria-hidden />;
}

/** Shared chrome: hunk headers look and behave the same in both layouts. */
function HunkRow({
  text,
  label,
  hunk,
  canDecide,
  decidedIn,
  onDiscardHunk,
  onKeepHunk,
  onEditHunk,
}: {
  text?: string;
  label?: string;
  hunk?: HunkSpan;
  canDecide: boolean;
  decidedIn: (hunk: HunkSpan) => number;
  onDiscardHunk: (hunk: HunkSpan) => void;
  onKeepHunk: (hunk: HunkSpan) => void;
  onEditHunk: (hunk: HunkSpan) => void;
}) {
  return (
    <div className="whymark-row group/hunk flex items-center gap-2 border-y border-border/40 bg-foreground/[0.04] px-2 text-[11px] text-muted-foreground">
      <span className="font-mono">{text}</span>
      {label ? <span className="truncate opacity-70">{label}</span> : null}
      {canDecide && hunk ? (
        <HunkControls
          decidedCount={decidedIn(hunk)}
          onDiscardHunk={() => onDiscardHunk(hunk)}
          onKeepHunk={() => onKeepHunk(hunk)}
          onEdit={() => onEditHunk(hunk)}
        />
      ) : null}
    </div>
  );
}

function rowTint(
  isHighlighted: boolean,
  highlightKind: string | null,
  fallback?: string,
): string | undefined {
  if (isHighlighted && highlightKind) {
    return `color-mix(in oklch, ${
      KIND_META[highlightKind as keyof typeof KIND_META].color
    } 13%, transparent)`;
  }
  return fallback;
}

function verdictStyle(verdict: LineVerdict): {
  className?: string;
  boxShadow?: string;
} {
  if (verdict === "discarded") {
    return { className: "line-through opacity-45" };
  }
  if (verdict === "restored") {
    return { boxShadow: "inset 2px 0 0 var(--whymark-add)" };
  }
  if (verdict === "edited") {
    // The line stays, but not as written: part of it goes back to the old text.
    return { boxShadow: "inset 2px 0 0 var(--whymark-part)" };
  }
  return {};
}

function UnifiedRow({
  row,
  notes,
  highlighted,
  highlightKind,
  onHover,
  onActivate,
  decisions,
  canDecide,
  onToggle,
  onTogglePart,
  hunks,
  decidedIn,
  onDiscardHunk,
  onKeepHunk,
  onEditHunk,
}: RowProps & { row: DisplayRow }) {
  if (row.kind === "hunk") {
    return (
      <HunkRow
        text={row.text}
        label={row.label}
        hunk={hunks.find((h) => h.key === row.key)}
        canDecide={canDecide}
        decidedIn={decidedIn}
        onDiscardHunk={onDiscardHunk}
        onKeepHunk={onKeepHunk}
        onEditHunk={onEditHunk}
      />
    );
  }

  const line = row.row!;
  const covered = row.noteIds.length > 0;
  const isHighlighted =
    highlighted !== null && row.noteIds.includes(highlighted);
  const accentKind = covered
    ? (notes.find((n) => n.id === row.noteIds[0])?.kind ?? "note")
    : null;
  const accent = accentKind ? KIND_META[accentKind].color : null;
  const verdict = verdictFor(line, decisions);
  const decorate = verdictStyle(verdict);

  const marker =
    row.kind === "add"
      ? { sign: "+", bg: "var(--whymark-add-bg)" }
      : row.kind === "del"
        ? { sign: "−", bg: "var(--whymark-del-bg)" }
        : { sign: " ", bg: undefined };

  return (
    <div
      className={cn("whymark-row group/row flex", covered && "cursor-pointer")}
      data-notes={row.noteIds.join(" ") || undefined}
      onMouseEnter={() => row.noteIds.length && onHover(row.noteIds[0])}
      onMouseLeave={() => onHover(null)}
      onClick={() => row.noteIds.length && onActivate(row.noteIds[0])}
      style={{
        backgroundColor: rowTint(isHighlighted, highlightKind, marker.bg),
        boxShadow: decorate.boxShadow,
      }}
    >
      <LineControl
        kind={row.kind === "add" || row.kind === "del" ? row.kind : "context"}
        verdict={verdict}
        disabled={!canDecide}
        onToggle={() => onToggle(line)}
      />
      <span className="whymark-gutter w-11 shrink-0 pr-2 text-right text-[11px] tabular-nums">
        {line.oldLine ?? ""}
      </span>
      <span className="whymark-gutter w-11 shrink-0 pr-2 text-right text-[11px] tabular-nums">
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
            ? "text-[color:var(--whymark-add)]"
            : row.kind === "del"
              ? "text-[color:var(--whymark-del)]"
              : "text-transparent",
        )}
      >
        {marker.sign}
      </span>
      <span className={cn("pr-6", decorate.className)}>
        <Tokens
          tokens={line.tokens}
          intra={line.intra}
          tone={row.kind === "add" ? "add" : "del"}
          parts={line.parts}
          side={row.kind === "del" ? "old" : "new"}
          handlers={partHandlers(line, verdict, canDecide, decisions, onTogglePart)}
        />
      </span>
    </div>
  );
}

function SplitRow({
  row,
  side,
  notes,
  highlighted,
  highlightKind,
  onHover,
  onActivate,
  decisions,
  canDecide,
  onToggle,
  onTogglePart,
  hunks,
  decidedIn,
  onDiscardHunk,
  onKeepHunk,
  onEditHunk,
}: RowProps & { row: DisplayRow; side: "add" | "del" }) {
  if (row.kind === "hunk") {
    return (
      <HunkRow
        text={row.text}
        label={side === "add" ? row.label : undefined}
        hunk={side === "add" ? hunks.find((h) => h.key === row.key) : undefined}
        canDecide={canDecide}
        decidedIn={decidedIn}
        onDiscardHunk={onDiscardHunk}
        onKeepHunk={onKeepHunk}
        onEditHunk={onEditHunk}
      />
    );
  }

  const cell = side === "add" ? row.right : row.left;
  const covered = row.noteIds.length > 0;
  const isHighlighted =
    highlighted !== null && row.noteIds.includes(highlighted);
  const accentKind = covered
    ? (notes.find((n) => n.id === row.noteIds[0])?.kind ?? "note")
    : null;
  const accent = accentKind ? KIND_META[accentKind].color : null;

  if (!cell) {
    return (
      <div
        className="whymark-row flex bg-foreground/[0.02]"
        data-notes={row.noteIds.join(" ") || undefined}
        style={{ backgroundColor: rowTint(isHighlighted, highlightKind) }}
      >
        <span className="w-5 shrink-0" aria-hidden />
        <span className="whymark-gutter w-11 shrink-0" />
      </div>
    );
  }

  const changed = cell.kind === "add" || cell.kind === "del";
  const verdict = verdictFor(cell, decisions);
  const decorate = verdictStyle(verdict);

  return (
    <div
      className={cn("whymark-row group/row flex", covered && "cursor-pointer")}
      data-notes={row.noteIds.join(" ") || undefined}
      onMouseEnter={() => row.noteIds.length && onHover(row.noteIds[0])}
      onMouseLeave={() => onHover(null)}
      onClick={() => row.noteIds.length && onActivate(row.noteIds[0])}
      style={{
        backgroundColor: rowTint(
          isHighlighted,
          highlightKind,
          changed
            ? side === "add"
              ? "var(--whymark-add-bg)"
              : "var(--whymark-del-bg)"
            : undefined,
        ),
        boxShadow: decorate.boxShadow,
      }}
    >
      <LineControl
        kind={changed ? (side === "add" ? "add" : "del") : "context"}
        verdict={verdict}
        disabled={!canDecide}
        onToggle={() => onToggle(cell)}
      />
      <span className="whymark-gutter w-11 shrink-0 pr-2 text-right text-[11px] tabular-nums">
        {side === "add" ? (cell.newLine ?? "") : (cell.oldLine ?? "")}
      </span>
      <span
        className="w-[3px] shrink-0"
        style={{ backgroundColor: accent ?? "transparent" }}
      />
      <span
        className={cn(
          "w-4 shrink-0 text-center",
          changed
            ? side === "add"
              ? "text-[color:var(--whymark-add)]"
              : "text-[color:var(--whymark-del)]"
            : "text-transparent",
        )}
      >
        {changed ? (side === "add" ? "+" : "−") : " "}
      </span>
      <span className={cn("pr-6", decorate.className)}>
        <Tokens
          tokens={cell.tokens}
          intra={cell.intra}
          tone={side}
          parts={cell.parts}
          side={side === "del" ? "old" : "new"}
          handlers={partHandlers(cell, verdict, canDecide, decisions, onTogglePart)}
        />
      </span>
    </div>
  );
}

/** Curved leaders from each annotated line range to its card. */
function Connectors({
  anchors,
  tops,
  offsets,
  heights,
  notes,
  highlighted,
  height,
}: {
  anchors: Anchor[];
  tops: Map<string, number>;
  offsets: number[];
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
        const top = anchor.startRow * LINE_H + (offsets[anchor.startRow] ?? 0);
        const bottom =
          (anchor.endRow + 1) * LINE_H + (offsets[anchor.endRow] ?? 0);
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
  mode,
  ...rowProps
}: RowProps & { rows: DisplayRow[]; mode: ViewMode }) {
  const { notes, highlighted, onHover, onActivate } = rowProps;
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
          <div className="whymark-scroll overflow-x-auto">
            <div className="whymark-code w-max min-w-full">
              {group.rows.map((row) =>
                mode === "split" ? (
                  <SplitRow key={row.key} row={row} side="add" {...rowProps} />
                ) : (
                  <UnifiedRow key={row.key} row={row} {...rowProps} />
                ),
              )}
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

function isLastRowOf(
  noteId: string,
  row: DisplayRow,
  rows: DisplayRow[],
): boolean {
  const last = [...rows].reverse().find((r) => r.noteIds.includes(noteId));
  return last?.key === row.key;
}

/* ------------------------------------------------------------------ */

function merge(current: number[], add: number[]): number[] {
  return [...new Set([...current, ...add])].sort((a, b) => a - b);
}

/** Group the unified rows into hunks so a whole hunk can be rejected or edited. */
function collectHunks(rows: RowVM[]): HunkSpan[] {
  const out: HunkSpan[] = [];
  let current: {
    span: HunkSpan;
    lines: Array<{ n: number; text: string }>;
  } | null = null;

  const close = () => {
    if (!current) return;
    const numbers = current.lines.map((line) => line.n);
    current.span.range = numbers.length
      ? [Math.min(...numbers), Math.max(...numbers)]
      : null;
    current.span.text = current.lines.map((line) => line.text).join("\n");
    out.push(current.span);
  };

  for (const row of rows) {
    if (row.kind === "hunk") {
      close();
      current = {
        span: { key: row.key, adds: [], dels: [], range: null, text: "" },
        lines: [],
      };
      continue;
    }
    if (!current) continue;
    if (row.kind === "add" && row.newLine !== undefined)
      current.span.adds.push(row.newLine);
    if (row.kind === "del" && row.oldLine !== undefined)
      current.span.dels.push(row.oldLine);
    if (row.kind !== "del" && row.newLine !== undefined) {
      current.lines.push({ n: row.newLine, text: row.text });
    }
  }
  close();
  return out;
}

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
      // Two annotations that land on one row cannot both sit level with it, and
      // one of them ends up adrift from the line it explains. Lines carrying
      // different notes therefore get a row each, still in their own column.
      if (left && right && !sameNotes(left.noteIds, right.noteIds)) {
        out.push({
          key: `p${pair++}`,
          kind: "pair",
          noteIds: left.noteIds,
          left,
          right: null,
        });
        out.push({
          key: `p${pair++}`,
          kind: "pair",
          noteIds: right.noteIds,
          left: null,
          right,
        });
        continue;
      }
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

function sameNotes(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return true;
  return a.length === b.length && a.every((id) => b.includes(id));
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
    .filter(
      (note) => note.selector.side === "new" || note.selector.side === "old",
    )
    .map((note) => ({
      noteId: note.id,
      startRow: first.get(note.id) ?? 0,
      endRow: last.get(note.id) ?? 0,
      fileLevel: !first.has(note.id),
    }))
    .sort((a, b) => a.startRow - b.startRow);
}
