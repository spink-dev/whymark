"use client";

import { forwardRef } from "react";
import { CircleHelp, ListTodo, Shuffle, Waypoints } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Note } from "@/lib/whymark/types";
import { KIND_META } from "./meta";
import { Markdown, inline } from "./markdown";
import { Confidence, RiskPill, SourceRow, VerifyRow } from "./pills";

interface NoteCardProps {
  note: Note;
  active?: boolean;
  dimmed?: boolean;
  onHover?: (noteId: string | null) => void;
  onSelect?: (noteId: string) => void;
  /** Shown instead of the line selector when the note is not tied to lines. */
  scopeLabel?: string;
}

export const NoteCard = forwardRef<HTMLDivElement, NoteCardProps>(function NoteCard(
  { note, active, dimmed, onHover, onSelect, scopeLabel },
  ref,
) {
  const kind = KIND_META[note.kind] ?? KIND_META.note;
  const Icon = kind.icon;

  return (
    <div
      ref={ref}
      id={`note-${note.id}`}
      onMouseEnter={() => onHover?.(note.id)}
      onMouseLeave={() => onHover?.(null)}
      onClick={() => onSelect?.(note.id)}
      className={cn(
        "group cursor-default rounded-lg border bg-card/80 shadow-sm backdrop-blur-[2px] transition-all",
        active
          ? "border-transparent ring-1 shadow-md"
          : "border-border/60 hover:border-border",
        dimmed && "opacity-35",
      )}
      style={{
        borderLeft: `2px solid ${kind.color}`,
        ...(active
          ? ({
              "--tw-ring-color": `color-mix(in oklch, ${kind.color} 55%, transparent)`,
              backgroundColor: `color-mix(in oklch, ${kind.color} 7%, var(--card))`,
            } as React.CSSProperties)
          : {}),
      }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 pt-2">
        <span
          className="inline-flex items-center gap-1 text-[11px] font-medium"
          style={{ color: kind.color }}
          title={kind.hint}
        >
          <Icon className="size-3" />
          {kind.label}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {scopeLabel ?? note.selector.raw}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {note.risk ? <RiskPill risk={note.risk} /> : null}
          {note.confidence !== undefined ? <Confidence value={note.confidence} /> : null}
        </span>
      </div>

      <div className="space-y-2 px-2.5 pt-1.5 pb-2.5">
        {note.why ? (
          <p className="text-[13px] leading-[1.5] text-foreground/95">{inline(note.why)}</p>
        ) : null}

        {note.what ? (
          <p className="text-[12.5px] leading-[1.5] text-muted-foreground">
            {inline(note.what)}
          </p>
        ) : null}

        {note.sources.length ? (
          <ul className="space-y-1">
            {note.sources.map((source, index) => (
              <SourceRow key={index} source={source} />
            ))}
          </ul>
        ) : null}

        {note.verify.length ? (
          <ul className="space-y-1">
            {note.verify.map((claim, index) => (
              <VerifyRow key={index} claim={claim} />
            ))}
          </ul>
        ) : null}

        {note.alternatives.length ? (
          <ul className="space-y-1">
            {note.alternatives.map((alt, index) => (
              <li
                key={index}
                className="flex gap-2 rounded-md bg-foreground/[0.035] px-2 py-1.5 text-[12px] leading-snug"
              >
                <Shuffle
                  className="mt-[3px] size-3 shrink-0"
                  style={{ color: "var(--kind-alternative)" }}
                />
                <span className="text-muted-foreground">
                  <span className="text-[10px] uppercase tracking-wide">rejected </span>
                  {inline(alt)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {note.impact ? (
          <div className="flex gap-2 text-[12px] leading-snug text-muted-foreground">
            <Waypoints className="mt-[3px] size-3 shrink-0" />
            <span>{inline(note.impact)}</span>
          </div>
        ) : null}

        {Object.entries(note.extra).map(([key, values]) =>
          values.map((value, index) => (
            <p key={`${key}${index}`} className="text-[12.5px] leading-[1.5] text-muted-foreground">
              <span className="mr-1 text-[10px] uppercase tracking-wide opacity-70">
                {key}
              </span>
              {inline(value)}
            </p>
          )),
        )}

        {note.refs.length ? (
          <ul className="space-y-0.5 text-[11.5px] text-muted-foreground">
            {note.refs.map((ref, index) => (
              <li key={index} className="font-mono break-all">
                → {ref}
              </li>
            ))}
          </ul>
        ) : null}

        {note.body ? (
          <Markdown
            text={note.body}
            className="border-t border-border/50 pt-1.5 text-[12.5px] text-muted-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
          />
        ) : null}

        {note.todos.length || note.questions.length ? (
          <ul className="space-y-1 border-t border-border/50 pt-2">
            {note.todos.map((todo, index) => (
              <li key={`t${index}`} className="flex gap-2 text-[12px] leading-snug">
                <ListTodo
                  className="mt-[3px] size-3 shrink-0"
                  style={{ color: "var(--kind-todo)" }}
                />
                <span className="text-foreground/90">{inline(todo)}</span>
              </li>
            ))}
            {note.questions.map((question, index) => (
              <li key={`q${index}`} className="flex gap-2 text-[12px] leading-snug">
                <CircleHelp
                  className="mt-[3px] size-3 shrink-0"
                  style={{ color: "var(--kind-question)" }}
                />
                <span className="text-foreground/90">{inline(question)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
});
