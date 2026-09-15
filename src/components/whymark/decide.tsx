"use client";

/**
 * Deciding, not just reading. A reviewer working through a branch locally wants
 * to drop the two lines they disagree with and fix a third, without moving to a
 * pull request page. These controls collect those decisions; the review view
 * writes them to the working tree.
 */
import { useEffect, useState } from "react";
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
import { isEmpty, type FileDecisions } from "@/lib/whymark/edit";

export type LineVerdict = "kept" | "discarded" | "restored";

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
    return <span className="w-[18px] shrink-0" aria-hidden />;
  }
  if (disabled) {
    return <span className="w-[18px] shrink-0" aria-hidden />;
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
      className={cn(
        "flex w-[18px] shrink-0 items-center justify-center text-muted-foreground/70 transition-opacity",
        decided ? "opacity-100" : "opacity-0 group-hover/row:opacity-70 hover:!opacity-100",
      )}
    >
      {kind === "add" ? (
        <X
          className={cn(
            "size-3",
            verdict === "discarded" && "text-[color:var(--whymark-del)]",
          )}
        />
      ) : (
        <Undo2
          className={cn(
            "size-3",
            verdict === "restored" && "text-[color:var(--whymark-add)]",
          )}
        />
      )}
    </button>
  );
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
    <span className="ml-auto flex shrink-0 items-center gap-1 pr-1 opacity-0 transition-opacity group-hover/hunk:opacity-100 focus-within:opacity-100">
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
  const [text, setText] = useState(initial);
  useEffect(() => {
    if (open) setText(initial);
  }, [open, initial]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="max-w-3xl">
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
          rows={Math.min(24, Math.max(6, text.split("\n").length + 1))}
          className="w-full resize-y rounded-md border border-border/70 bg-background/60 p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-border"
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
}

/** The bar that appears once there is something to apply. */
export function ApplyBar({
  summary,
  busy,
  result,
  onApply,
  onReset,
  onDismiss,
}: {
  summary: ApplySummary;
  busy: boolean;
  result: { ok: boolean; message: string } | null;
  onApply: () => void;
  onReset: () => void;
  onDismiss: () => void;
}) {
  const pending = summary.discarded + summary.restored > 0;
  if (!pending && !result) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
      <div className="pointer-events-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-[color-mix(in_oklch,var(--card)_92%,var(--background))] px-3.5 py-2.5 shadow-lg backdrop-blur">
        {result ? (
          <>
            {result.ok ? (
              <Check
                className="size-3.5 shrink-0"
                style={{ color: "var(--whymark-add)" }}
              />
            ) : (
              <TriangleAlert
                className="size-3.5 shrink-0"
                style={{ color: "var(--whymark-del)" }}
              />
            )}
            <p className="text-[12.5px] leading-relaxed">{result.message}</p>
            <button
              type="button"
              onClick={onDismiss}
              className="ml-auto rounded-md border border-border/70 px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            >
              dismiss
            </button>
          </>
        ) : (
          <>
            <span className="text-[12.5px]">
              {describe(summary)} in{" "}
              {summary.files === 1 ? "1 file" : `${summary.files} files`}
            </span>
            <span className="text-[11.5px] text-muted-foreground">
              writes to your working tree
            </span>
            <span className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onReset}
                className="rounded-md border border-border/70 px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
              >
                reset
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onApply}
                className="flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[12.5px] font-medium text-background transition-opacity disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-3 animate-spin" /> : null}
                apply
              </button>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function describe({ discarded, restored }: ApplySummary): string {
  const parts: string[] = [];
  if (discarded) parts.push(`discard ${discarded} added ${plural(discarded, "line")}`);
  if (restored) parts.push(`restore ${restored} removed ${plural(restored, "line")}`);
  return parts.join(" and ") || "no changes";
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
    return decisions.discardAdded.includes(row.newLine) ? "discarded" : "kept";
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
