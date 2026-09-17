import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReviewView } from "../../../src/components/whymark/review-view";
import type { ReviewActions, EditResult } from "../../../src/lib/review-actions";
import type { ReviewMessage, Request } from "./protocol";
declare function acquireVsCodeApi(): { postMessage(message: Request): void; getState(): unknown; setState(state: unknown): void };
const api = acquireVsCodeApi();
let nextId = 0;
const pending = new Map<number, { resolve: (result: EditResult) => void; timer: ReturnType<typeof setTimeout> }>();
function call(message: Omit<Extract<Request, { type: "apply" }>, "id"> | Omit<Extract<Request, { type: "edit" }>, "id">): Promise<EditResult> {
  return new Promise(resolve => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: "VS Code did not respond. Check the source file before retrying." }); }, 30000);
    pending.set(id, { resolve, timer }); api.postMessage({ ...message, id });
  });
}
function App() {
  const [state, setState] = useState<ReviewMessage>();
  const [error, setError] = useState("");
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const m = event.data;
      if (m.type === "review") { setState(m); setError(""); }
      else if (m.type === "error") setError(m.message);
      else if (m.type === "result") {
        const request = pending.get(m.id);
        if (request) { clearTimeout(request.timer); request.resolve(m.result); pending.delete(m.id); }
      }
    };
    const link = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest("a");
      const href = anchor?.getAttribute("href");
      if (href && !href.startsWith("#")) { event.preventDefault(); if (/^https?:\/\//.test(href)) api.postMessage({ type: "external", url: href }); }
    };
    window.addEventListener("message", listener); document.addEventListener("click", link);
    api.postMessage({ type: "ready" });
    return () => { window.removeEventListener("message", listener); document.removeEventListener("click", link); };
  }, []);
  const actions: ReviewActions | undefined = state?.trusted ? {
    applyFileDecisions: (_, path, decisions) => call({ type: "apply", revision: state.revision, path, decisions }),
    saveEditedRange: (_, path, start, end, text) => call({ type: "edit", revision: state.revision, path, start, end, text }),
  } : undefined;
  return <>
    <div className="extension-toolbar">
      <button onClick={() => api.postMessage({ type: "refresh" })}>Refresh comparison</button>
      <button onClick={() => api.postMessage({ type: "source" })}>Open review source</button>
      {state?.generated && <button onClick={() => api.postMessage({ type: "save" })}>Save review as…</button>}
      <select aria-label="Open source file" value="" onChange={e => { if (e.target.value) api.postMessage({ type: "open", path: e.target.value }); }}>
        <option value="">Open source file…</option>
        {state?.review.files.map(f => <option key={f.path} value={f.path}>{f.path}</option>)}
      </select>
    </div>
    <div className="extension-notice">{state?.trusted ? "Edits affect the working-tree editor buffer and support Undo. Save the source file to write it to disk. Git index is unchanged." : "Read-only review. Trust the workspace to compare Git changes or edit source files."} Evidence from review files is shown as imported, not independently re-run.</div>
    {error && <div role="alert" className="extension-notice">{error}</div>}
    {state ? <ReviewView key={state.revision} review={state.review} issues={state.review.diagnostics} slug="vscode" mutationTarget="Editor buffer" actions={actions} sourceLabel={state.label} onViewSource={() => api.postMessage({ type: "source" })} onBack={() => api.postMessage({ type: "source" })} /> : <p className="extension-notice">Loading review…</p>}
  </>;
}
createRoot(document.getElementById("root")!).render(<App />);
