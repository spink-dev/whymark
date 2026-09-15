"use client";

import { Fragment, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { Token } from "@/lib/highlight";

const FONT_STYLE: Record<number, CSSProperties> = {
  1: { fontStyle: "italic" },
  2: { fontWeight: 600 },
  4: { textDecoration: "underline" },
};

/**
 * Renders shiki tokens, optionally emphasising the character range that changed
 * within a replaced line.
 */
export function Tokens({
  tokens,
  intra,
  tone,
}: {
  tokens: Token[];
  intra?: [number, number];
  tone?: "add" | "del";
}) {
  if (!tokens.length) return <span>{"\u00a0"}</span>;
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
              ? "bg-[var(--crev-add-strong)]"
              : "bg-[var(--crev-del-strong)]",
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
