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
  side = "new",
  handlers,
}: {
  tokens: Token[];
  intra?: [number, number];
  tone?: "add" | "del";
  parts?: InlinePart[];
  side?: "old" | "new";
  handlers?: PartHandlers;
}) {
  if (!tokens.length) return <span>{"\u00a0"}</span>;

  if (parts?.some((part) => part.changed)) {
    return (
      <PartedLine
        tokens={tokens}
        parts={parts}
        side={side}
        tone={tone}
        handlers={handlers}
      />
    );
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

/**
 * A replaced line drawn part by part. On the new side the changed parts are
 * clickable; on the old side they are the same parts, marked, so both columns
 * agree about what changed.
 */
function PartedLine({
  tokens,
  parts,
  side,
  tone,
  handlers,
}: {
  tokens: Token[];
  parts: InlinePart[];
  side: "old" | "new";
  tone?: "add" | "del";
  handlers?: PartHandlers;
}) {
  const reverted = new Set(handlers?.reverted ?? []);
  const bounds = (part: InlinePart): [number, number] =>
    side === "new" ? [part.newStart, part.newEnd] : [part.oldStart, part.oldEnd];

  return (
    <>
      {parts.map((part, index) => {
        const [from, to] = bounds(part);
        if (!part.changed) {
          return <Fragment key={index}>{slice(tokens, from, to)}</Fragment>;
        }

        const marked = cn(
          "rounded-[2px]",
          tone === "del" ? "bg-[var(--whymark-del-strong)]" : "bg-[var(--whymark-add-strong)]",
        );

        if (!handlers) {
          return (
            <span key={index} className={from === to ? undefined : marked}>
              {slice(tokens, from, to)}
            </span>
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
                ? // Its own colour: red would read as "this text is going away"
                  // when it is the text that will stay.
                  "bg-[color-mix(in_oklch,var(--whymark-part)_30%,transparent)] underline decoration-dotted decoration-1 underline-offset-2"
                : cn(marked, "hover:outline hover:outline-1 hover:outline-foreground/40"),
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
              slice(tokens, from, to)
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
