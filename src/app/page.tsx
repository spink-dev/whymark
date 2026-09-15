import Link from "next/link";
import {
  ArrowUpRight,
  Braces,
  ClipboardList,
  FileDiff,
  Sparkles,
  Terminal,
} from "lucide-react";
import { listReviews } from "@/lib/reviews";
import { CoverageBar, Ring } from "@/components/crev/meters";
import { KIND_META, STATUS_COLOR } from "@/components/crev/meta";
import type { NoteKind } from "@/lib/crev/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const reviews = await listReviews();

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10">
      <header className="mb-9 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-foreground px-1.5 py-0.5 font-mono text-[13px] font-semibold text-background">
              crev
            </span>
            <span className="font-mono text-[12px] text-muted-foreground">v1</span>
          </div>
          <h1 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight">
            Read AI-written code with the reasoning attached to it.
          </h1>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
            A <code className="font-mono text-foreground/80">.crev</code> file is a diff on
            the left and annotations on the right, addressed to individual lines: why the
            code is that way, which source it came from, and what was actually run to check
            it. Written by the agent, checkable by you.
          </p>
        </div>
        <nav className="flex gap-2 text-[12.5px]">
          <Link
            href="/format"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            <Braces className="size-3.5" />
            format
          </Link>
          <Link
            href="/inspect"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            <ClipboardList className="size-3.5" />
            paste a review
          </Link>
        </nav>
      </header>

      {reviews.length === 0 ? <EmptyState /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {reviews.map(({ slug, doc, stats }) => {
          const kinds = (Object.entries(stats.byKind) as Array<[NoteKind, number]>)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

          return (
            <Link
              key={slug}
              href={`/r/${slug}`}
              className="group flex flex-col gap-3 rounded-xl border border-border/70 bg-card/40 p-4 transition-all hover:border-border hover:bg-card/70"
            >
              <div className="flex items-start gap-3">
                <Ring value={stats.coverage} size={40} stroke={3.5} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[14px] font-medium leading-snug">{doc.meta.title}</h2>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {[doc.meta.scope, doc.meta.author, doc.meta.date?.slice(0, 10)]
                      .filter(Boolean)
                      .join("  ·  ")}
                  </p>
                </div>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </div>

              {doc.meta.summary ? (
                <p className="line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
                  {doc.meta.summary.replace(/\s+/g, " ")}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-1.5">
                {kinds.map(([kind, count]) => {
                  const meta = KIND_META[kind];
                  const Icon = meta.icon;
                  return (
                    <span
                      key={kind}
                      className="inline-flex items-center gap-1 rounded-full border border-border/60 px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
                    >
                      <Icon className="size-2.5" style={{ color: meta.color }} />
                      {meta.label}
                      <span className="tabular-nums opacity-70">{count}</span>
                    </span>
                  );
                })}
              </div>

              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/60 pt-3 text-[11.5px] text-muted-foreground">
                <span className="inline-flex items-center gap-1 font-mono">
                  <FileDiff className="size-3" />
                  {stats.files}
                  <span className="text-[color:var(--crev-add)]">+{stats.added}</span>
                  <span className="text-[color:var(--crev-del)]">−{stats.removed}</span>
                </span>
                <CoverageBar value={stats.coverage} width={56} />
                {stats.inferenceOnly ? (
                  <span
                    className="inline-flex items-center gap-1"
                    style={{ color: "var(--crev-inference)" }}
                    title="Annotations whose only provenance is the model's own inference"
                  >
                    <Sparkles className="size-3" />
                    {stats.inferenceOnly} inferred
                  </span>
                ) : null}
                {stats.checks.total ? (
                  <span
                    className="inline-flex items-center gap-1"
                    style={{
                      color: stats.checks.fail
                        ? STATUS_COLOR.fail
                        : stats.checks.unknown
                          ? STATUS_COLOR.unknown
                          : STATUS_COLOR.pass,
                    }}
                  >
                    <Terminal className="size-3" />
                    {stats.checks.pass}/{stats.checks.total} checks
                  </span>
                ) : null}
                {stats.stubs ? (
                  <span style={{ color: STATUS_COLOR.fail }}>{stats.stubs} unfilled</span>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>

      <section className="mt-10 grid gap-3 border-t border-border/60 pt-8 sm:grid-cols-3">
        <Step
          n="1"
          title="Generate"
          body={
            <>
              <code className="font-mono">npm run crev -- new --staged</code> turns your
              staged, unstaged, branch, or commit diff into a skeleton with one annotation
              stub per hunk.
            </>
          }
        />
        <Step
          n="2"
          title="Annotate"
          body={
            <>
              The agent fills every <code className="font-mono">why</code>,{" "}
              <code className="font-mono">source</code> and{" "}
              <code className="font-mono">verify</code> field. The skill in{" "}
              <code className="font-mono">.agents/skills/crev</code> tells it how, in Cursor
              and Codex alike.
            </>
          }
        />
        <Step
          n="3"
          title="Check"
          body={
            <>
              <code className="font-mono">crev verify</code> re-runs every command the review
              claims to have run and rewrites the file with what actually happened. Then read
              it here.
            </>
          }
        />
      </section>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/30 p-4">
      <div className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded-full bg-foreground/10 font-mono text-[11px]">
          {n}
        </span>
        <h3 className="text-[13px] font-medium">{title}</h3>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mb-6 rounded-xl border border-dashed border-border bg-card/30 p-6">
      <h2 className="text-[14px] font-medium">No reviews yet</h2>
      <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
        Drop a <code className="font-mono">.crev</code> file into{" "}
        <code className="font-mono">reviews/</code> and it shows up here. To create one from
        changes you already have:
      </p>
      <pre className="crev-scroll mt-3 overflow-x-auto rounded-lg border border-border/60 bg-black/30 p-3 font-mono text-[12px]">
        <code>{`npm run crev -- new --staged --author "your model"\nnpm run crev -- prompt --branch main   # hand the diff to an agent`}</code>
      </pre>
    </div>
  );
}
