"use client";

import { Fragment, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { Token } from "@/lib/highlight";
import type { InlinePart } from "@/lib/whymark/inline";

const FONT_STYLE: Record<number, CSSProperties> = {
  1: { fontStyle: "italic" },
  2: { fontWeight: 600 },
  4: { textDecoration: "underline" },
};

export interface PartHandlers {
  /** Indices of this line's parts the reviewer has taken back to the old text. */
  reverted: number[];
  onToggle: (part: number) => void;
}

/**
 * Renders shiki tokens, emphasising what changed within a replaced line.
 *
 * When the caller passes handlers, each changed part becomes its own control: a
 * reviewer who wants the rename but not the new timeout clicks the timeout. A
 * reverted part shows the old text in place, so the line on screen reads as the
 * line that will be written.
 */
export function Tokens({
  tokens,
  intra,
  tone,
  parts,
  handlers,
}: {
  tokens: Token[];
  intra?: [number, number];
  tone?: "add" | "del";
  parts?: InlinePart[];
  handlers?: PartHandlers;
}) {
  if (!tokens.length) return <span>{"\u00a0"}</span>;

  if (parts && handlers) {
    return <PartedLine tokens={tokens} parts={parts} handlers={handlers} />;
  }

  if (!intra) {
    return (
      <>
        {tokens.map((token, index) => (
          <span key={index} style={{ color: token.color, ...FONT_STYLE[token.style ?? 0] }}>
            {token.text}
          </span>
        ))}
      </>
    );
  }

  const [from, to] = intra;
  const nodes: React.ReactNode[] = [];
  let offset = 0;

  tokens.forEach((token, index) => {
    const start = offset;
    const end = offset + token.text.length;
    offset = end;

    const style = { color: token.color, ...FONT_STYLE[token.style ?? 0] };
    if (end <= from || start >= to) {
      nodes.push(
        <span key={index} style={style}>
          {token.text}
        </span>,
      );
      return;
    }

    const localFrom = Math.max(0, from - start);
    const localTo = Math.min(token.text.length, to - start);
    nodes.push(
      <Fragment key={index}>
        {localFrom > 0 ? <span style={style}>{token.text.slice(0, localFrom)}</span> : null}
        <span
          style={style}
          className={cn(
            "rounded-[2px]",
            tone === "add"
              ? "bg-[var(--whymark-add-strong)]"
              : "bg-[var(--whymark-del-strong)]",
          )}
        >
          {token.text.slice(localFrom, localTo)}
        </span>
        {localTo < token.text.length ? (
          <span style={style}>{token.text.slice(localTo)}</span>
        ) : null}
      </Fragment>,
    );
  });

  return <>{nodes}</>;
}

/** A replaced line drawn part by part, with the changed ones clickable. */
function PartedLine({
  tokens,
  parts,
  handlers,
}: {
  tokens: Token[];
  parts: InlinePart[];
  handlers: PartHandlers;
}) {
  const reverted = new Set(handlers.reverted);

  return (
    <>
      {parts.map((part, index) => {
        if (!part.changed) {
          return (
            <Fragment key={index}>{slice(tokens, part.newStart, part.newEnd)}</Fragment>
          );
        }

        const undone = reverted.has(index);
        const label = undone
          ? `Keep this part of the change${part.new ? `: ${part.new}` : ""}`
          : part.old
            ? `Revert this part to: ${part.old}`
            : `Drop this addition: ${part.new}`;

        return (
          <button
            key={index}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={undone}
            onClick={(event) => {
              event.stopPropagation();
              handlers.onToggle(index);
            }}
            className={cn(
              "rounded-[2px] whitespace-pre",
              undone
                ? "bg-[var(--whymark-del-strong)] underline decoration-dotted decoration-1 underline-offset-2"
                : "bg-[var(--whymark-add-strong)] hover:outline hover:outline-1 hover:outline-foreground/40",
            )}
          >
            {undone ? (
              part.old ? (
                <span>{part.old}</span>
              ) : (
                // Nothing to go back to: the addition simply goes away.
                <span className="line-through opacity-60">{part.new}</span>
              )
            ) : (
              slice(tokens, part.newStart, part.newEnd)
            )}
          </button>
        );
      })}
    </>
  );
}

/** The highlighted tokens covering a character range of the line. */
function slice(tokens: Token[], from: number, to: number): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let offset = 0;

  tokens.forEach((token, index) => {
    const start = offset;
    const end = offset + token.text.length;
    offset = end;
    if (end <= from || start >= to) return;

    const text = token.text.slice(Math.max(0, from - start), Math.min(token.text.length, to - start));
    if (!text) return;
    nodes.push(
      <span key={index} style={{ color: token.color, ...FONT_STYLE[token.style ?? 0] }}>
        {text}
      </span>,
    );
  });

  return nodes;
}
