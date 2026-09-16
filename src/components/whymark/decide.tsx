"use client";

/**
 * Deciding, not just reading. A reviewer working through a branch locally wants
 * to drop the two lines they disagree with and fix a third, without moving to a
 * pull request page. These controls collect those decisions; the review view
 * writes them to the working tree.
 */
import { useState } from "react";
import {
  Check,
  Loader2,
  Pencil,
  RotateCcw,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { isEmpty, partsOf, type FileDecisions } from "@/lib/whymark/edit";
import type { RowVM } from "@/lib/view-model";
import type { PartHandlers } from "./code-line";

export type LineVerdict = "kept" | "discarded" | "restored" | "edited";

/**
 * The per-line toggle, in a fixed-width column so turning a decision on never
 * moves the code sideways.
 */
export function LineControl({
  kind,
  verdict,
  onToggle,
  disabled,
}: {
  kind: "add" | "del" | "context" | "hunk";
  verdict: LineVerdict;
  onToggle?: () => void;
  disabled?: boolean;
}) {
  if (kind !== "add" && kind !== "del") {
    return <span className="w-5 shrink-0" aria-hidden />;
  }
  if (disabled) {
    return <span className="w-5 shrink-0" aria-hidden />;
  }

  const decided = verdict !== "kept";
  const label =
    kind === "add"
      ? verdict === "discarded"
        ? "Keep this added line"
        : "Discard this added line"
      : verdict === "restored"
        ? "Accept this removal again"
        : "Put this removed line back";

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle?.();
      }}
      title={label}
      aria-label={label}
      aria-pressed={decided}
      // Always drawn, faint until wanted. Revealing it on hover hid the one
      // control that turns reading a review into deciding on it.
      className={cn(
        "flex h-full w-5 shrink-0 items-center justify-center transition-colors",
        decided
          ? "opacity-100"
          : "opacity-55 hover:opacity-100 hover:bg-foreground/10 group-hover/row:opacity-85",
      )}
    >
      {kind === "add" ? (
        <X
          className={cn(
            "size-3.5",
            verdict === "discarded"
              ? "text-[color:var(--whymark-del)]"
              : "text-muted-foreground",
          )}
        />
      ) : (
        <Undo2
          className={cn(
            "size-3.5",
            verdict === "restored"
              ? "text-[color:var(--whymark-add)]"
              : "text-muted-foreground",
          )}
        />
      )}
    </button>
  );
}

/**
 * Part handlers for one line, or nothing when the line has no revertible parts.
 *
 * A line already on its way out has nothing to revert within it, so the parts go
 * quiet rather than offering a decision that the discard would override.
 */
export function partHandlers(
  line: RowVM,
  verdict: LineVerdict,
  canDecide: boolean,
  decisions: FileDecisions,
  onTogglePart: (line: number, part: number) => void,
): PartHandlers | undefined {
  const target = line.newLine;
  if (!canDecide || target === undefined) return undefined;
  if (line.kind !== "add" || !line.parts?.some((part) => part.changed)) return undefined;
  if (verdict === "discarded") return undefined;

  return {
    reverted: partsOf(decisions)
      .filter((ref) => ref.line === target)
      .map((ref) => ref.part),
    onToggle: (part) => onTogglePart(target, part),
  };
}

/** Hunk-level actions: reject the whole thing, undo that, or edit it by hand. */
export function HunkControls({
  decidedCount,
  onDiscardHunk,
  onKeepHunk,
  onEdit,
}: {
  decidedCount: number;
  onDiscardHunk: () => void;
  onKeepHunk: () => void;
  onEdit: () => void;
}) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1 pr-1 opacity-70 transition-opacity group-hover/hunk:opacity-100 focus-within:opacity-100">
      {decidedCount > 0 ? (
        <button
          type="button"
          onClick={onKeepHunk}
          className="flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          title="Clear the decisions in this hunk"
        >
          <RotateCcw className="size-2.5" />
          reset
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDiscardHunk}
        className="flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:border-[color:var(--whymark-del)] hover:text-[color:var(--whymark-del)]"
        title="Reject every change in this hunk"
      >
        <Trash2 className="size-2.5" />
        discard hunk
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        title="Edit these lines and write them to the file"
      >
        <Pencil className="size-2.5" />
        edit
      </button>
    </span>
  );
}

/**
 * Editing happens in a dialog rather than inside the diff: growing a textarea
 * between the code rows would push every annotation below it out of line with
 * the code it explains.
 */
export function HunkEditor({
  open,
  path,
  range,
  initial,
  busy,
  error,
  onCancel,
  onSave,
}: {
  open: boolean;
  path: string;
  range: [number, number] | null;
  initial: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (text: string) => void;
}) {
  // The caller remounts this by key when a different hunk is opened, so the
  // starting text is simply initial state rather than something to sync.
  const [text, setText] = useState(initial);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      {/* The width override needs the `sm:` variant too, or the primitive's own
          `sm:max-w-sm` wins and the code is squeezed into a phone-width box. */}
      <DialogContent className="w-[min(92vw,980px)] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="font-mono text-[13px]">{path}</DialogTitle>
          <DialogDescription>
            {range
              ? `Replaces lines ${range[0]}–${range[1]} in your working tree when you save.`
              : "This hunk has no lines on the new side to edit."}
          </DialogDescription>
        </DialogHeader>

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          // Code must not soft-wrap here: a wrapped line reads as a different
          // line from the one in the diff above it.
          wrap="off"
          rows={Math.min(26, Math.max(8, text.split("\n").length + 1))}
          className="w-full resize-y overflow-auto rounded-md border border-border/70 bg-background/60 p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre outline-none focus:border-border"
        />

        {error ? (
          <p className="flex items-start gap-1.5 text-[12px] text-[color:var(--whymark-del)]">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" />
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border/70 px-2.5 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            cancel
          </button>
          <button
            type="button"
            disabled={busy || !range}
            onClick={() => onSave(text)}
            className="flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-[12.5px] font-medium text-background transition-opacity disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : null}
            write to file
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ApplySummary {
  files: number;
  discarded: number;
  restored: number;
  parts: number;
}

/**
 * Pending decisions live in the toolbar, not in a bar pinned to the bottom of
 * the window: a browser window taller than the screen puts a bottom-fixed bar
 * out of sight, and the reviewer never learns there is anything to apply.
 */
export function ApplyControls({
  summary,
  busy,
  onApply,
  onReset,
}: {
  summary: ApplySummary;
  busy: boolean;
  onApply: () => void;
  onReset: () => void;
}) {
  const pending = summary.discarded + summary.restored + summary.parts;
  if (pending === 0) return null;

  return (
    <div
      className="flex shrink-0 items-center gap-2 rounded-md border px-2 py-1"
      style={{
        borderColor: "color-mix(in oklch, var(--whymark-del) 40%, transparent)",
        backgroundColor: "color-mix(in oklch, var(--whymark-del) 8%, transparent)",
      }}
    >
      <span className="hidden text-[11.5px] lg:inline" title="writes to your working tree">
        {describe(summary)}
      </span>
      <span className="text-[11.5px] lg:hidden">{pending} to undo</span>
      <button
        type="button"
        onClick={onReset}
        className="rounded px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        reset
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onApply}
        className="flex items-center gap-1.5 rounded bg-foreground px-2 py-0.5 text-[11.5px] font-medium text-background transition-opacity disabled:opacity-50"
        title="Write these decisions to the files in your working tree"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : null}
        apply
      </button>
    </div>
  );
}

/** What happened on disk, directly under the toolbar so it cannot be missed. */
export function ApplyResult({
  result,
  onDismiss,
}: {
  result: { ok: boolean; message: string } | null;
  onDismiss: () => void;
}) {
  if (!result) return null;

  // Floated below the toolbar rather than placed in the flow: a strip of its own
  // would either scroll out of reach or fight the sticky file headers for the
  // same 56px of screen.
  return (
    <div
      role="status"
      className="fixed right-4 top-[68px] z-40 flex max-w-md items-start gap-2 rounded-lg border px-3 py-2 shadow-lg backdrop-blur"
      style={{
        borderColor: `color-mix(in oklch, ${
          result.ok ? "var(--whymark-add)" : "var(--whymark-del)"
        } 45%, transparent)`,
        backgroundColor: `color-mix(in oklch, ${
          result.ok ? "var(--whymark-add)" : "var(--whymark-del)"
        } 14%, var(--card))`,
      }}
    >
      {result.ok ? (
        <Check className="mt-0.5 size-3.5 shrink-0" style={{ color: "var(--whymark-add)" }} />
      ) : (
        <TriangleAlert
          className="mt-0.5 size-3.5 shrink-0"
          style={{ color: "var(--whymark-del)" }}
        />
      )}
      <p className="text-[12.5px] leading-relaxed">{result.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-auto shrink-0 rounded border border-border/70 px-2 py-0.5 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        dismiss
      </button>
    </div>
  );
}

function describe({ discarded, restored, parts }: ApplySummary): string {
  const phrases: string[] = [];
  if (discarded) phrases.push(`discard ${discarded} added ${plural(discarded, "line")}`);
  if (restored) phrases.push(`restore ${restored} removed ${plural(restored, "line")}`);
  if (parts) phrases.push(`revert ${parts} ${plural(parts, "part")}`);
  return join(phrases) || "no changes";
}

function join(phrases: string[]): string {
  if (phrases.length < 3) return phrases.join(" and ");
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases.at(-1)}`;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

/* Small helpers shared by the panel. */

export function verdictFor(
  row: { kind: string; newLine?: number; oldLine?: number },
  decisions: FileDecisions,
): LineVerdict {
  if (row.kind === "add" && row.newLine !== undefined) {
    if (decisions.discardAdded.includes(row.newLine)) return "discarded";
    const line = row.newLine;
    return partsOf(decisions).some((ref) => ref.line === line) ? "edited" : "kept";
  }
  if (row.kind === "del" && row.oldLine !== undefined) {
    return decisions.restoreDeleted.includes(row.oldLine) ? "restored" : "kept";
  }
  return "kept";
}

export function toggleLine(
  decisions: FileDecisions,
  row: { kind: string; newLine?: number; oldLine?: number },
): FileDecisions {
  if (row.kind === "add" && row.newLine !== undefined) {
    const has = decisions.discardAdded.includes(row.newLine);
    return {
      ...decisions,
      discardAdded: has
        ? decisions.discardAdded.filter((n) => n !== row.newLine)
        : [...decisions.discardAdded, row.newLine].sort((a, b) => a - b),
    };
  }
  if (row.kind === "del" && row.oldLine !== undefined) {
    const has = decisions.restoreDeleted.includes(row.oldLine);
    return {
      ...decisions,
      restoreDeleted: has
        ? decisions.restoreDeleted.filter((n) => n !== row.oldLine)
        : [...decisions.restoreDeleted, row.oldLine].sort((a, b) => a - b),
    };
  }
  return decisions;
}

export { isEmpty };
