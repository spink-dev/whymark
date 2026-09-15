"use client";

import { useCallback, useState, useTransition } from "react";
import { FileUp, Play, Sparkles } from "lucide-react";
import { ReviewView } from "@/components/whymark/review-view";
import { renderPasted, type RenderResult } from "./actions";

export function InspectClient({ sample }: { sample: string }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<RenderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState(false);

  const render = useCallback((source: string) => {
    setError(null);
    startTransition(async () => {
      try {
        setResult(await renderPasted(source));
      } catch (cause) {
        setError((cause as Error).message);
      }
    });
  }, []);

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      const content = await file.text();
      setText(content);
      render(content);
    },
    [render],
  );

  if (result) {
    return (
      <div className="-mx-5 -mt-8">
        <ReviewView review={result.review} issues={result.issues} />
        <div className="mx-auto max-w-[1800px] px-4 pb-8">
          <button
            onClick={() => setResult(null)}
            className="rounded-lg border border-border/70 px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            paste another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
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
          className="whymark-scroll whymark-code min-h-[45vh] w-full resize-y rounded-lg bg-black/20 p-3 outline-none placeholder:text-muted-foreground/50"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => render(text)}
          disabled={!text.trim() || pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[12.5px] font-medium text-background transition-opacity disabled:opacity-40"
        >
          <Play className="size-3.5" />
          {pending ? "rendering…" : "render"}
        </button>
        <button
          onClick={() => {
            setText(sample);
            render(sample);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Sparkles className="size-3.5" />
          try an example
        </button>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <FileUp className="size-3.5" />
          or drop a .whymark file anywhere above
        </span>
      </div>

      {error ? (
        <p className="text-[12.5px]" style={{ color: "var(--whymark-fail)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
