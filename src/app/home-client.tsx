"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { FileUp, Play, Sparkles, Trash2, X } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { ReviewView } from "@/components/whymark/review-view";
import { CoverageBar } from "@/components/whymark/meters";
import { renderLocal, type RenderResult } from "@/lib/render-local";
import {
  clearAppData,
  clearHistory,
  deleteHistory,
  listHistory,
  saveHistory,
  type HistoryEntry,
} from "@/lib/local-history";

export interface ExampleLink {
  slug: string;
  title: string;
  summary?: string;
}

export function HomeClient({
  sample,
  examples,
}: {
  sample: string;
  examples: ExampleLink[];
}) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<RenderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refreshHistory = useCallback(async () => {
    const rows = await listHistory();
    setHistory(rows);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listHistory().then((rows) => {
      if (!cancelled) setHistory(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const render = useCallback(
    (source: string, record: boolean) => {
      setError(null);
      startTransition(async () => {
        try {
          const next = await renderLocal(source);
          setResult(next);
          if (record) {
            await saveHistory(source);
            await refreshHistory();
          }
        } catch (cause) {
          setError((cause as Error).message);
        }
      });
    },
    [refreshHistory],
  );

  const openFile = useCallback(
    async (file: File) => {
      const content = await file.text();
      setText(content);
      render(content, true);
    },
    [render],
  );

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) await openFile(file);
    },
    [openFile],
  );

  if (result) {
    return (
      <ReviewView
        review={result.review}
        issues={result.issues}
        onBack={() => setResult(null)}
      />
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <div className="mx-auto w-full max-w-6xl px-5 py-10">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">
          Open a review in this browser.
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
          Drop a <code className="font-mono text-foreground/80">.whymark</code> file, or
          paste it. Parsing, highlighting, and history all run on your device — the file
          is not uploaded, not logged, and not stored on a server.
        </p>
      </header>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-xl border border-dashed p-1 transition-colors ${
          dragging ? "border-[color:var(--kind-intent)] bg-foreground/5" : "border-border"
        }`}
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          placeholder={"---\nwhymark: 1\ntitle: …\n---\n\n@file src/thing.ts modified\n@@ -1,3 +1,4 @@\n…"}
          className="whymark-scroll whymark-code min-h-[36vh] w-full resize-y rounded-lg bg-black/20 p-3 outline-none placeholder:text-muted-foreground/50"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => render(text, true)}
          disabled={!text.trim() || pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[12.5px] font-medium text-background transition-opacity disabled:opacity-40"
        >
          <Play className="size-3.5" />
          {pending ? "rendering…" : "render"}
        </button>
        <button
          type="button"
          onClick={() => {
            setText(sample);
            render(sample, false);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Sparkles className="size-3.5" />
          try an example
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <FileUp className="size-3.5" />
          open a file
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".whymark,text/plain"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void openFile(file);
            event.target.value = "";
          }}
        />
        <span className="text-[12px] text-muted-foreground">or drop a file on the box</span>
      </div>

      {error ? (
        <p className="mt-3 text-[12.5px]" style={{ color: "var(--whymark-fail)" }}>
          {error}
        </p>
      ) : null}

      {history.length ? (
        <section className="mt-10">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[14px] font-medium">On this device</h2>
            <button
              type="button"
              onClick={async () => {
                await clearHistory();
                await refreshHistory();
                setDataMessage("History cleared. The files were only in this browser.");
              }}
              className="text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            >
              clear history
            </button>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {history.map((entry) => (
              <li key={entry.id}>
                <div className="group flex flex-col gap-2 rounded-xl border border-border/70 bg-card/40 p-4">
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setText(entry.text);
                        render(entry.text, true);
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <h3 className="text-[14px] font-medium leading-snug">{entry.title}</h3>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {new Date(entry.openedAt).toLocaleString()}
                        {entry.author ? `  ·  ${entry.author}` : ""}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteHistory(entry.id);
                        await refreshHistory();
                      }}
                      className="rounded-md p-1 text-muted-foreground opacity-70 transition-colors hover:text-foreground group-hover:opacity-100"
                      aria-label={`Remove ${entry.title} from history`}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  {entry.summary ? (
                    <p className="line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
                      {entry.summary}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground">
                    {entry.coverage !== undefined ? (
                      <CoverageBar value={entry.coverage} width={56} />
                    ) : null}
                    <span className="font-mono">
                      {entry.files ?? 0} file{(entry.files ?? 0) === 1 ? "" : "s"}
                      {entry.added !== undefined ? (
                        <>
                          {" "}
                          <span className="text-[color:var(--whymark-add)]">+{entry.added}</span>
                          <span className="text-[color:var(--whymark-del)]"> −{entry.removed}</span>
                        </>
                      ) : null}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {examples.length ? (
        <section className="mt-10">
          <h2 className="mb-3 text-[14px] font-medium">Shipped examples</h2>
          <p className="mb-3 max-w-xl text-[12.5px] text-muted-foreground">
            These live in the whymark repository and are part of the site build, not your
            history.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {examples.map((example) => (
              <li key={example.slug}>
                <Link
                  href={`/r/${example.slug}`}
                  className="block rounded-xl border border-border/70 bg-card/40 p-4 transition-colors hover:border-border hover:bg-card/70"
                >
                  <h3 className="text-[14px] font-medium">{example.title}</h3>
                  {example.summary ? (
                    <p className="mt-1 line-clamp-2 text-[12.5px] text-muted-foreground">
                      {example.summary}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-10 rounded-xl border border-border/70 bg-card/30 p-4">
        <h2 className="text-[14px] font-medium">Data on this device</h2>
        <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
          History is stored in this browser&apos;s IndexedDB, on this origin only. Clearing
          it removes the copies of reviews you opened here. Clearing app data also drops
          local/session storage and this origin&apos;s Cache Storage. It cannot erase Vercel
          request logs for the page itself (paths, IP, user-agent) — those never include
          the file you dropped.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              await clearHistory();
              await refreshHistory();
              setDataMessage("History cleared.");
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Trash2 className="size-3.5" />
            clear history
          </button>
          <button
            type="button"
            onClick={async () => {
              await clearAppData();
              setHistory([]);
              setText("");
              setDataMessage("App data cleared for this origin.");
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            clear app cache
          </button>
        </div>
        {dataMessage ? (
          <p className="mt-2 text-[12px] text-muted-foreground">{dataMessage}</p>
        ) : null}
      </section>
      </div>
      <SiteFooter />
    </div>
  );
}
