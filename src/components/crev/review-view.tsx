"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Columns2,
  Info,
  Keyboard,
  Rows3,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Diagnostic, Note, NoteKind } from "@/lib/crev/types";
import type { ReviewVM } from "@/lib/view-model";
import { FilePanel, type ViewMode } from "./file-panel";
import { KIND_META, STATUS_COLOR } from "./meta";
import { CoverageBar, Ring, Stat } from "./meters";
import { Markdown } from "./markdown";
import { NoteCard } from "./note-card";
import { useMediaQuery } from "./use-media-query";
import { hasPassingVerify } from "@/lib/crev/stats";

interface ReviewViewProps {
  review: ReviewVM;
  /** Absent when the document was pasted rather than read from `reviews/`. */
  slug?: string;
  issues: Diagnostic[];
}

export function ReviewView({ review, slug, issues }: ReviewViewProps) {
  const compact = !useMediaQuery("(min-width: 1180px)", true);
  const [mode, setMode] = useState<ViewMode>("unified");
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<Set<NoteKind>>(new Set());
  const [onlyUnverified, setOnlyUnverified] = useState(false);
  const [onlyInference, setOnlyInference] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const allNotes = useMemo(
    () => [...review.docNotes, ...review.files.flatMap((f) => f.notes)],
    [review],
  );

  const matches = useCallback(
    (note: Note) => {
      if (kindFilter.size && !kindFilter.has(note.kind)) return false;
      if (onlyUnverified && hasPassingVerify(note)) return false;
      if (onlyInference && !note.sources.some((s) => s.type === "inference")) return false;
      return true;
    },
    [kindFilter, onlyUnverified, onlyInference],
  );

  const visibleNoteIds = useMemo(
    () => new Set(allNotes.filter(matches).map((note) => note.id)),
    [allNotes, matches],
  );

  const orderedVisible = useMemo(
    () =>
      review.files
        .flatMap((file) => file.notes)
        .filter((note) => visibleNoteIds.has(note.id)),
    [review.files, visibleNoteIds],
  );

  const jump = useCallback(
    (delta: number) => {
      if (!orderedVisible.length) return;
      const index = orderedVisible.findIndex((note) => note.id === activeNoteId);
      const next =
        orderedVisible[
          (index + delta + orderedVisible.length * 2) % orderedVisible.length
        ];
      if (!next) return;
      setActiveNoteId(next.id);
      const element = document.getElementById(`note-${next.id}`);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      element?.classList.remove("crev-flash");
      requestAnimationFrame(() => element?.classList.add("crev-flash"));
    },
    [orderedVisible, activeNoteId],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;

      switch (event.key) {
        case "j":
          event.preventDefault();
          jump(1);
          break;
        case "k":
          event.preventDefault();
          jump(-1);
          break;
        case "u":
          setMode((m) => (m === "unified" ? "split" : "unified"));
          break;
        case "?":
          setShowHelp((s) => !s);
          break;
        case "Escape":
          setActiveNoteId(null);
          setShowHelp(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jump]);

  const { stats, meta } = review;
  const kinds = Object.entries(stats.byKind)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]) as Array<[NoteKind, number]>;

  const stale = issues.filter((issue) => issue.code === "review-stale");
  const problems = issues.filter(
    (issue) => issue.level === "error" || issue.code === "note-stub",
  );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/70 bg-[color-mix(in_oklch,var(--background)_88%,transparent)] px-4 backdrop-blur-md">
        <Link
          href="/"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          aria-label="All reviews"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[13.5px] font-medium leading-tight">{meta.title}</h1>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {[meta.scope, meta.base && `${meta.base} → ${meta.head ?? "working-tree"}`, meta.author]
              .filter(Boolean)
              .join("  ·  ")}
          </p>
        </div>

        <div className="hidden items-center gap-4 md:flex">
          <CoverageBar
            value={stats.coverage}
            label={`${stats.covered} of ${stats.added} added lines carry an annotation`}
          />
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Check className="size-3" style={{ color: STATUS_COLOR.pass }} />
            {Math.round(stats.verifiedCoverage * 100)}% verified
          </span>
        </div>

        <div className="flex items-center gap-1 rounded-md border border-border/70 p-0.5">
          <button
            onClick={() => setMode("unified")}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-1 text-[11px] transition-colors",
              mode === "unified"
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            title="Unified diff (u)"
          >
            <Rows3 className="size-3" />
            unified
          </button>
          <button
            onClick={() => setMode("split")}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-1 text-[11px] transition-colors",
              mode === "split"
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            title="Side by side (u)"
          >
            <Columns2 className="size-3" />
            split
          </button>
        </div>

        <button
          onClick={() => setShowHelp(true)}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          title="Keyboard shortcuts (?)"
        >
          <Keyboard className="size-4" />
        </button>
      </header>

      <div className="mx-auto max-w-[1800px] px-4 py-5">
        {/* overview */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-3">
            {meta.summary ? (
              <Markdown
                text={meta.summary}
                className="max-w-[75ch] text-[13.5px] leading-relaxed text-foreground/90 [&>*:first-child]:mt-0"
              />
            ) : (
              <p className="text-[13px] text-muted-foreground">
                This review has no summary.
              </p>
            )}

            {stale.length ? (
              <div className="flex gap-2 rounded-lg border border-[color-mix(in_oklch,var(--crev-unknown)_40%,transparent)] bg-[color-mix(in_oklch,var(--crev-unknown)_10%,transparent)] p-2.5 text-[12.5px]">
                <AlertTriangle
                  className="mt-0.5 size-3.5 shrink-0"
                  style={{ color: "var(--crev-unknown)" }}
                />
                <div>
                  <strong className="font-medium">The code moved on.</strong>{" "}
                  {stale.length === 1
                    ? stale[0].message
                    : `${stale.length} files changed since this review was written, so its annotations may no longer match.`}
                </div>
              </div>
            ) : null}

            {problems.length ? (
              <details className="rounded-lg border border-border/70 bg-card/40 p-2.5 text-[12.5px]">
                <summary className="cursor-pointer text-muted-foreground">
                  {problems.length} structural issue{problems.length === 1 ? "" : "s"} in this
                  review file
                </summary>
                <ul className="mt-2 space-y-1">
                  {problems.map((issue, index) => (
                    <li key={index} className="flex gap-2">
                      <Info className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                      <span>
                        <code className="font-mono text-[11px] text-muted-foreground">
                          {issue.code}
                        </code>{" "}
                        {issue.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {review.docNotes.length ? (
              <div className="space-y-2">
                {review.docNotes.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    scopeLabel="whole change"
                    active={activeNoteId === note.id}
                    onSelect={setActiveNoteId}
                  />
                ))}
              </div>
            ) : null}
          </div>

          {/* evidence panel */}
          <div className="space-y-3 rounded-xl border border-border/70 bg-card/40 p-3">
            <div className="flex items-center gap-3">
              <Ring value={stats.coverage} size={44} stroke={4}>
                {Math.round(stats.coverage * 100)}
              </Ring>
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium">Explained</div>
                <div className="text-[11.5px] text-muted-foreground">
                  {stats.covered} of {stats.added} added lines
                </div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-[12.5px] font-medium">
                  {Math.round(stats.verifiedCoverage * 100)}%
                </div>
                <div className="text-[11.5px] text-muted-foreground">verified</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-2.5">
              <Stat
                label="sourced"
                value={stats.sourced}
                hint="Annotations citing something outside the model"
              />
              <Stat
                label="inferred"
                value={stats.inferenceOnly}
                color="var(--crev-inference)"
                hint="Annotations whose only provenance is the model's own inference"
              />
              <Stat
                label="stubs"
                value={stats.stubs}
                color={stats.stubs ? "var(--crev-fail)" : undefined}
                hint="Annotations still holding generated placeholder text"
              />
              <Stat
                label="high risk"
                value={
                  stats.unverifiedHighRisk
                    ? `${stats.byRisk.high} (${stats.unverifiedHighRisk} unverified)`
                    : stats.byRisk.high
                }
                color={stats.unverifiedHighRisk ? "var(--crev-fail)" : undefined}
              />
              <Stat label="todos" value={stats.openTodos} />
              <Stat label="questions" value={stats.openQuestions} />
            </div>

            {meta.checks.length ? (
              <ul className="space-y-1 border-t border-border/60 pt-2.5">
                {meta.checks.map((check, index) => (
                  <li key={index} className="flex items-start gap-2 text-[12px]">
                    <Terminal
                      className="mt-[3px] size-3 shrink-0"
                      style={{ color: STATUS_COLOR[check.status] }}
                    />
                    <div className="min-w-0 flex-1">
                      <code className="break-all font-mono text-[11.5px]">{check.cmd}</code>
                      {check.detail ? (
                        <div className="text-[11px] text-muted-foreground">{check.detail}</div>
                      ) : null}
                    </div>
                    <span
                      className="shrink-0 text-[10px] font-medium uppercase tracking-wide"
                      style={{ color: STATUS_COLOR[check.status] }}
                    >
                      {check.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="space-y-1.5 border-t border-border/60 pt-2.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                files
              </div>
              {review.files.map((file, index) => (
                <a
                  key={file.path}
                  href={`#file-${index}`}
                  className="flex items-center gap-2 rounded-md px-1 py-0.5 text-[12px] transition-colors hover:bg-foreground/5"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                    {file.path.split("/").slice(-2).join("/")}
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                    <span className="text-[color:var(--crev-add)]">+{file.added}</span>{" "}
                    <span className="text-[color:var(--crev-del)]">−{file.removed}</span>
                  </span>
                  <CoverageBar value={file.stats.coverage} width={40} />
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* filters */}
        <div className="mt-5 flex flex-wrap items-center gap-1.5 border-y border-border/60 py-2.5">
          <span className="mr-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            annotations
          </span>
          {kinds.map(([kind, count]) => {
            const active = kindFilter.has(kind);
            const meta = KIND_META[kind];
            const Icon = meta.icon;
            return (
              <button
                key={kind}
                onClick={() =>
                  setKindFilter((previous) => {
                    const next = new Set(previous);
                    if (next.has(kind)) next.delete(kind);
                    else next.add(kind);
                    return next;
                  })
                }
                title={meta.hint}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                  active
                    ? "border-transparent text-background"
                    : "border-border/70 text-muted-foreground hover:text-foreground",
                )}
                style={
                  active
                    ? { backgroundColor: meta.color, color: "var(--background)" }
                    : undefined
                }
              >
                <Icon className="size-3" style={active ? undefined : { color: meta.color }} />
                {meta.label}
                <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}

          <span className="mx-1 h-4 w-px bg-border" />

          <FilterToggle
            active={onlyUnverified}
            onClick={() => setOnlyUnverified((v) => !v)}
            icon={<AlertTriangle className="size-3" />}
            label="unverified only"
          />
          <FilterToggle
            active={onlyInference}
            onClick={() => setOnlyInference((v) => !v)}
            icon={<Sparkles className="size-3" />}
            label="inferred only"
          />

          {kindFilter.size || onlyUnverified || onlyInference ? (
            <button
              onClick={() => {
                setKindFilter(new Set());
                setOnlyUnverified(false);
                setOnlyInference(false);
              }}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
              clear
            </button>
          ) : null}

          <span className="ml-auto text-[11px] text-muted-foreground">
            {visibleNoteIds.size} of {allNotes.length} shown ·{" "}
            <kbd className="rounded border border-border/70 px-1 font-mono text-[10px]">j</kbd>{" "}
            <kbd className="rounded border border-border/70 px-1 font-mono text-[10px]">k</kbd>{" "}
            to step through
          </span>
        </div>

        {/* files */}
        <div className="mt-4 space-y-5">
          {review.files.map((file, index) => (
            <FilePanel
              key={file.path}
              file={file}
              index={index}
              mode={mode}
              compact={compact}
              visibleNoteIds={visibleNoteIds}
              activeNoteId={activeNoteId}
              onActivate={setActiveNoteId}
            />
          ))}
        </div>

        <footer className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-4 text-[11.5px] text-muted-foreground">
          {slug ? (
            <>
              <span className="font-mono">reviews/{slug}.crev</span>
              <a
                href={`/api/raw/${slug}`}
                className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
              >
                view source
              </a>
              <span>
                re-check every claim with{" "}
                <code className="font-mono">crev verify reviews/{slug}.crev</code>
              </span>
            </>
          ) : (
            <span>
              Pasted document — save it under <code className="font-mono">reviews/</code> to
              keep it, then <code className="font-mono">crev verify</code> its claims.
            </span>
          )}
        </footer>
      </div>

      {showHelp ? <HelpOverlay onClose={() => setShowHelp(false)} /> : null}
    </div>
  );
}

function FilterToggle({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
        active
          ? "border-transparent bg-foreground text-background"
          : "border-border/70 text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function HelpOverlay({ onClose }: { onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ["j / k", "next / previous annotation"],
    ["u", "unified ↔ side by side"],
    ["?", "toggle this help"],
    ["esc", "clear selection"],
    ["click a line", "select the annotation covering it"],
    ["click a card", "highlight the lines it explains"],
  ];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[min(420px,92vw)] rounded-xl border border-border bg-card p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-medium">Reviewing with the keyboard</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <dl className="space-y-1.5">
          {rows.map(([keys, description]) => (
            <div key={keys} className="flex items-baseline gap-3 text-[12.5px]">
              <dt className="w-28 shrink-0 font-mono text-[11px] text-muted-foreground">
                {keys}
              </dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
