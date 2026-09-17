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
import type { Diagnostic, Note, NoteKind } from "@/lib/whymark/types";
import type { ReviewVM } from "@/lib/view-model";
import { FilePanel, type ViewMode } from "./file-panel";
import { ApplyControls, ApplyResult } from "./decide";
import { applyFileDecisions, saveEditedRange } from "@/app/r/[slug]/actions";
import { isEmpty, summarize, type FileDecisions } from "@/lib/whymark/edit";
import { KIND_META, STATUS_COLOR } from "./meta";
import { CoverageBar, Ring, Stat } from "./meters";
import { Markdown } from "./markdown";
import { NoteCard } from "./note-card";
import { useMediaQuery } from "./use-media-query";
import { QualityPanel } from "./quality-panel";
import { EvidencePanel } from "./evidence-panel";
import { NoteDisclosure } from "./note-disclosure";
import { ReviewSettings } from "./review-settings";
import { useReviewPreferences } from "./use-review-preferences";
import { type ReviewPreferences } from "@/lib/review-preferences";
import { hasPassingVerify } from "@/lib/whymark/stats";

interface ReviewViewProps {
  review: ReviewVM;
  /** Absent when the document was pasted rather than read from `reviews/`. */
  slug?: string;
  issues: Diagnostic[];
  /** When set, the back control closes this view instead of navigating home. */
  onBack?: () => void;
}

export function ReviewView({ review, slug, issues, onBack }: ReviewViewProps) {
  const compact = !useMediaQuery("(min-width: 1180px)", true);
  const [preferences, setPreferences] = useReviewPreferences();
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [disclosures, setDisclosures] = useState<Record<string, boolean>>({});
  const updatePreferences = (next: ReviewPreferences) => {
    setPreferences(next);
    if (next.collapseNotes !== preferences.collapseNotes) setDisclosures({});
  };
  const activate = useCallback((id: string | null) => {
    setActiveNoteId(id);
    if (id) setDisclosures(current => ({ ...current, [id]: true }));
  }, []);
  useEffect(() => {
    const reveal = () => {
      let hash: string;
      try { hash = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      if (hash.startsWith("note-")) activate(hash.slice(5));
    };
    const frame = requestAnimationFrame(reveal);
    window.addEventListener("hashchange", reveal);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("hashchange", reveal); };
  }, [activate]);
  const [mode, setMode] = useState<ViewMode>("unified");
  const [kindFilter, setKindFilter] = useState<Set<NoteKind>>(new Set());
  const [onlyUnverified, setOnlyUnverified] = useState(false);
  const [onlyInference, setOnlyInference] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, FileDecisions>>({});
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

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
      allNotes.filter((note) => visibleNoteIds.has(note.id)),
    [allNotes, visibleNoteIds],
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
      activate(next.id);
      const element = document.getElementById(`note-${next.id}`);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      element?.classList.remove("whymark-flash");
      requestAnimationFrame(() => element?.classList.add("whymark-flash"));
    },
    [orderedVisible, activeNoteId, activate],
  );

  const setFileDecisions = useCallback((path: string, next: FileDecisions) => {
    setApplyResult(null);
    setDecisions((current) => {
      const updated = { ...current, [path]: next };
      if (isEmpty(next)) delete updated[path];
      return updated;
    });
  }, []);

  /**
   * Writing happens one file at a time so a failure on the third file leaves a
   * message naming it, rather than an all-or-nothing result the reviewer cannot
   * act on. Each file's own hash is re-checked server-side before it is written.
   */
  const apply = useCallback(async () => {
    if (!slug) return;
    setApplying(true);
    const failures: string[] = [];
    let discarded = 0;
    let restored = 0;
    let parts = 0;

    for (const [path, fileDecisions] of Object.entries(decisions)) {
      const result = await applyFileDecisions(slug, path, fileDecisions);
      if (result.ok) {
        discarded += result.discarded ?? 0;
        restored += result.restored ?? 0;
        parts += result.partsReverted ?? 0;
      } else {
        failures.push(result.error ?? `${path} could not be written.`);
      }
    }

    setApplying(false);
    if (failures.length) {
      setApplyResult({ ok: false, message: failures.join(" ") });
      return;
    }
    setDecisions({});
    const undone = [
      discarded ? `${discarded} added ${discarded === 1 ? "line" : "lines"} dropped` : "",
      restored
        ? `${restored} removed ${restored === 1 ? "line" : "lines"} restored`
        : "",
      parts ? `${parts} ${parts === 1 ? "part" : "parts"} reverted in place` : "",
    ]
      .filter(Boolean)
      .join(", ");
    setApplyResult({
      ok: true,
      message: `Working tree updated: ${undone}. This review now describes code you changed — regenerate it with \`whymark new --worktree\` before sharing.`,
    });
  }, [decisions, slug]);

  /**
   * Deciding by keyboard, for a reviewer stepping through with j/k: `x` rejects
   * everything the selected annotation covers, which is the unit a reader has
   * just formed an opinion about.
   */
  const toggleActiveNote = useCallback(() => {
    if (!slug || !activeNoteId) return;
    const file = review.files.find((candidate) =>
      candidate.notes.some((note) => note.id === activeNoteId),
    );
    if (!file || !file.actionable) return;

    const covered = file.rows.filter((row) => row.noteIds.includes(activeNoteId));
    const adds = covered
      .filter((row) => row.kind === "add" && row.newLine !== undefined)
      .map((row) => row.newLine as number);
    const dels = covered
      .filter((row) => row.kind === "del" && row.oldLine !== undefined)
      .map((row) => row.oldLine as number);
    if (!adds.length && !dels.length) return;

    const current = decisions[file.path] ?? { discardAdded: [], restoreDeleted: [] };
    const alreadyDone =
      adds.every((line) => current.discardAdded.includes(line)) &&
      dels.every((line) => current.restoreDeleted.includes(line));

    setFileDecisions(
      file.path,
      alreadyDone
        ? {
            discardAdded: current.discardAdded.filter((line) => !adds.includes(line)),
            restoreDeleted: current.restoreDeleted.filter((line) => !dels.includes(line)),
          }
        : {
            discardAdded: [...new Set([...current.discardAdded, ...adds])].sort(
              (a, b) => a - b,
            ),
            restoreDeleted: [...new Set([...current.restoreDeleted, ...dels])].sort(
              (a, b) => a - b,
            ),
          },
    );
  }, [activeNoteId, decisions, review.files, setFileDecisions, slug]);

  const onSaveEdit = useCallback(
    async (path: string, start: number, end: number, text: string) => {
      if (!slug) return { ok: false, error: "A pasted review has no file to write to." };
      const result = await saveEditedRange(slug, path, start, end, text);
      if (result.ok) {
        setApplyResult({
          ok: true,
          message: `Saved your edit to ${path}. Regenerate the review so its diff matches the file again.`,
        });
      }
      return result;
    },
    [slug],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (/input|textarea|select/i.test(target.tagName) || target.isContentEditable || target.closest('[role="dialog"]'))) return;

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
        case "x":
          event.preventDefault();
          toggleActiveNote();
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
  }, [jump, toggleActiveNote]);

  const { stats, meta } = review;
  const kinds = Object.entries(stats.byKind)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]) as Array<[NoteKind, number]>;

  const stale = issues.filter(
    (issue) => issue.code === "review-stale" || issue.code === "file-missing",
  );
  const problems = issues.filter(
    (issue) => issue.level === "error" || ["note-stub", "source-unavailable", "evidence-invalid", "quality-invalid"].includes(issue.code),
  );

  return (
    <NoteDisclosure.Provider value={{
      expanded: id => disclosures[id] ?? !preferences.collapseNotes,
      toggle: id => setDisclosures(current => ({ ...current, [id]: !(current[id] ?? !preferences.collapseNotes) })),
    }}>
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/70 bg-[color-mix(in_oklch,var(--background)_88%,transparent)] px-4 backdrop-blur-md">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            aria-label="Close review"
          >
            <ArrowLeft className="size-4" />
          </button>
        ) : (
          <Link
            href="/"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            aria-label="Home"
          >
            <ArrowLeft className="size-4" />
          </Link>
        )}
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
            {Math.round(stats.verifiedCoverage * 100)}% claimed verified
          </span>
        </div>

        <ApplyControls
          summary={summarize(decisions)}
          busy={applying}
          onApply={apply}
          onReset={() => setDecisions({})}
        />

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

        <ReviewSettings value={preferences} onChange={updatePreferences} />

        <button
          onClick={() => setShowHelp(true)}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          title="Keyboard shortcuts (?)"
        >
          <Keyboard className="size-4" />
        </button>
      </header>

      <ApplyResult result={applyResult} onDismiss={() => setApplyResult(null)} />
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
              <div className="flex gap-2 rounded-lg border border-[color-mix(in_oklch,var(--whymark-unknown)_40%,transparent)] bg-[color-mix(in_oklch,var(--whymark-unknown)_10%,transparent)] p-2.5 text-[12.5px]">
                <AlertTriangle
                  className="mt-0.5 size-3.5 shrink-0"
                  style={{ color: "var(--whymark-unknown)" }}
                />
                <div className="space-y-0.5">
                  <strong className="font-medium">
                    {stale.every((issue) => issue.code === "file-missing")
                      ? "This review describes code that is not in the working tree."
                      : "The code moved on since this review was written."}
                  </strong>
                  <ul className="space-y-0.5 text-muted-foreground">
                    {stale.slice(0, 4).map((issue, index) => (
                      <li key={index}>{issue.message}</li>
                    ))}
                    {stale.length > 4 ? <li>and {stale.length - 4} more.</li> : null}
                  </ul>
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

            {review.docNotes.some(note => visibleNoteIds.has(note.id)) ? (
              <div className="space-y-2">
                {review.docNotes.filter(note => visibleNoteIds.has(note.id)).map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    scopeLabel="whole change"
                    active={activeNoteId === note.id}
                    onSelect={activate}
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
                <div className="text-[11.5px] text-muted-foreground">claimed verified</div>
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
                color="var(--whymark-inference)"
                hint="Annotations whose only provenance is the model's own inference"
              />
              <Stat
                label="stubs"
                value={stats.stubs}
                color={stats.stubs ? "var(--whymark-fail)" : undefined}
                hint="Annotations still holding generated placeholder text"
              />
              <Stat
                label="high risk"
                value={
                  stats.unverifiedHighRisk
                    ? `${stats.byRisk.high} (${stats.unverifiedHighRisk} unverified)`
                    : stats.byRisk.high
                }
                color={stats.unverifiedHighRisk ? "var(--whymark-fail)" : undefined}
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
                    <span className="text-[color:var(--whymark-add)]">+{file.added}</span>{" "}
                    <span className="text-[color:var(--whymark-del)]">−{file.removed}</span>
                  </span>
                  <CoverageBar value={file.stats.coverage} width={40} />
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4"><EvidencePanel evidence={review.evidence} /><QualityPanel report={review.quality} state={review.qualityState} files={review.files} /></div>

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

          <button className="rounded border px-2 py-0.5 text-[11px]" onClick={() => setDisclosures(Object.fromEntries(allNotes.map(note => [note.id, false])))}>Collapse all</button>
          <button className="rounded border px-2 py-0.5 text-[11px]" onClick={() => setDisclosures(Object.fromEntries(allNotes.map(note => [note.id, true])))}>Expand all</button>
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
              syncScroll={preferences.syncScroll}
              compactRail={preferences.compactRail}
              visibleNoteIds={visibleNoteIds}
              activeNoteId={activeNoteId}
              onActivate={activate}
              editable={Boolean(slug)}
              decisions={decisions[file.path]}
              onDecisions={setFileDecisions}
              onSaveEdit={onSaveEdit}
            />
          ))}
        </div>

        <footer className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-4 text-[11.5px] text-muted-foreground">
          {slug ? (
            <>
              <span className="font-mono">reviews/{slug}.whymark</span>
              <a
                href={`/api/raw/${slug}`}
                className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
              >
                view source
              </a>
              <span>
                re-check every claim with{" "}
                <code className="font-mono">whymark verify reviews/{slug}.whymark</code>
              </span>
            </>
          ) : (
            <span>
              Pasted document — save it under <code className="font-mono">reviews/</code> to
              keep it, then <code className="font-mono">whymark verify</code> its claims.
            </span>
          )}
        </footer>
      </div>

      {showHelp ? <HelpOverlay onClose={() => setShowHelp(false)} /> : null}
    </div>
    </NoteDisclosure.Provider>
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
    ["x", "reject what the selected annotation covers"],
    ["u", "unified ↔ side by side"],
    ["?", "toggle this help"],
    ["esc", "clear selection"],
    ["click a line", "select the annotation covering it"],
    ["click a highlight", "revert just that part of a changed line"],
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
