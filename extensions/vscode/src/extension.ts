import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";
import { Worker } from "node:worker_threads";
import { parseWhymark } from "../../../src/lib/whymark/parse";
import { validateDocument } from "../../../src/lib/whymark/validate";
import { buildReviewVM } from "../../../src/lib/view-model";
import { applyDecisions, isActionable, replaceRange } from "../../../src/lib/whymark/edit";
import type { WhymarkDocument, Scope } from "../../../src/lib/whymark/types";
import type { ReviewVM } from "../../../src/lib/view-model";
import { parseRequest } from "./protocol";
import { blobHash, safeFile, MAX_REVIEW_BYTES } from "./safety";

const VIEW = "whymark.review";
interface Comparison { scope: Scope; cwd: string; base?: string; commit?: string; untracked: boolean }
interface Session { panel: vscode.WebviewPanel; text: () => string; root?: string; label: string; comparison?: Comparison; document?: vscode.TextDocument; revision: number; doc?: WhymarkDocument; vm?: ReviewVM; disposed: boolean; busy: boolean }
const sessions = new Set<Session>();
let extensionRoot: string;

function requireTrust() { if (!vscode.workspace.isTrusted) throw new Error("Trust this workspace before comparing Git changes or editing source files."); }
function report(error: unknown) { void vscode.window.showErrorMessage(`Whymark: ${error instanceof Error ? error.message : String(error)}`); }

export async function generateComparison(request: Comparison): Promise<{ text: string; root: string }> {
  requireTrust();
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Whymark: Reading Git changes", cancellable: true }, (_, token) => new Promise((resolve, reject) => {
    const worker = new Worker(join(extensionRoot, "dist/worker.cjs"), { workerData: request });
    const finish = (error?: Error, result?: { text: string; root: string }) => {
      clearTimeout(timer); cancel.dispose(); void worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const timer = setTimeout(() => finish(new Error("Git comparison exceeded 30 seconds.")), 30000);
    const cancel = token.onCancellationRequested(() => finish(new Error("Comparison canceled.")));
    worker.once("error", finish);
    worker.once("message", result => result.error ? finish(new Error(result.error)) : Buffer.byteLength(result.text) > MAX_REVIEW_BYTES ? finish(new Error("Comparison exceeds the 8 MB review limit; narrow the changes first.")) : finish(undefined, result));
  }));
}

async function repositoryFor(uri: vscode.Uri): Promise<string | undefined> {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder || uri.scheme !== "file") return undefined;
  // Find the nearest Git marker without invoking Git in restricted mode.
  const boundary = await realpath(folder.uri.fsPath);
  let current = await realpath(dirname(uri.fsPath));
  const rel = relative(boundary, current);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  while (true) {
    try { await vscode.workspace.fs.stat(vscode.Uri.file(join(current, ".git"))); return current; } catch { /* continue to parent */ }
    if (current === boundary) return boundary;
    current = dirname(current);
  }
}

async function openDocumentAt(path: string) {
  const matches: vscode.TextDocument[] = [];
  for (const document of vscode.workspace.textDocuments) {
    if (document.uri.scheme !== "file") continue;
    try { if (await realpath(document.uri.fsPath) === path) matches.push(document); } catch { /* deleted document */ }
  }
  if (matches.length > 1) throw new Error("Source is open through multiple paths. Close duplicate editors before editing.");
  return matches[0];
}

async function render(session: Session) {
  const revision = ++session.revision;
  try {
    const text = session.text();
    if (Buffer.byteLength(text) > MAX_REVIEW_BYTES) throw new Error("Review exceeds the 8 MB limit.");
    const doc = parseWhymark(text);
    if (doc.files.length > 1000) throw new Error("Review exceeds 1,000 files.");
    const valid = validateDocument(doc);
    const writable = new Set<string>();
    if (session.root && vscode.workspace.isTrusted && valid.ok) {
      for (const file of doc.files) {
        try {
          const path = await safeFile(session.root, file.path);
          const bytes = await readFile(path);
          const text = bytes.toString("utf8");
          if (!Buffer.from(text).equals(bytes)) continue;
          const open = await openDocumentAt(path);
          if (open?.isDirty || open && open.getText() !== text) continue;
          if (isActionable(file, blobHash(text))) writable.add(file.path);
        } catch { /* Missing, escaped and oversized paths remain read-only. */ }
      }
    }
    const vm = await buildReviewVM(doc, { isWritable: file => writable.has(file.path) });
    if (revision !== session.revision || session.disposed) return;
    vm.diagnostics = valid.diagnostics;
    session.doc = doc; session.vm = vm;
    await session.panel.webview.postMessage({ type: "review", review: vm, revision, trusted: vscode.workspace.isTrusted, label: session.label, generated: Boolean(session.comparison) });
  } catch (error) {
    if (revision === session.revision) await session.panel.webview.postMessage({ type: "error", message: String(error) });
  }
}

export async function applyRequest(session: Session, input: unknown) {
  const request = parseRequest(input);
  if (!request || request.type !== "apply" && request.type !== "edit") throw new Error("Invalid edit request.");
  requireTrust();
  if (!session.root || !session.doc || request.revision !== session.revision) throw new Error("The review changed. Refresh before editing.");
  if (!validateDocument(session.doc).ok) throw new Error("Fix invalid review data before editing.");
  const file = session.doc.files.find(f => f.path === request.path);
  if (!file) throw new Error("File is not part of this review.");
  const path = await safeFile(session.root, file.path);
  const disk = await readFile(path);
  const text = disk.toString("utf8");
  if (!Buffer.from(text).equals(disk) || !isActionable(file, blobHash(text))) throw new Error("File no longer matches this review. Refresh or regenerate it first.");
  const document = await openDocumentAt(path) ?? await vscode.workspace.openTextDocument(vscode.Uri.file(path));
  if (document.isDirty || document.getText() !== text) throw new Error("Save or revert the source file's unsaved changes before editing from Whymark.");
  const newLines = new Set(file.hunks.flatMap(h => h.lines.filter(l => l.type !== "del").map(l => l.newLine)));
  if (request.type === "apply") {
    const adds = new Set(file.hunks.flatMap(h => h.lines.filter(l => l.type === "add").map(l => l.newLine)));
    const dels = new Set(file.hunks.flatMap(h => h.lines.filter(l => l.type === "del").map(l => l.oldLine)));
    if (request.decisions.discardAdded.some(n => !adds.has(n)) || request.decisions.restoreDeleted.some(n => !dels.has(n))) throw new Error("Decisions must address changed lines in this review.");
  } else {
    if (request.end - request.start > 100000) throw new Error("Edit range is too large.");
    for (let line = request.start; line <= request.end; line++) if (!newLines.has(line)) throw new Error("Edit must stay inside a reviewed hunk.");
  }
  const result = request.type === "apply" ? applyDecisions(text, file.hunks, request.decisions) : { text: replaceRange(text, request.start, request.end, request.text) };
  // No await between the final document check and submitting the edit. VS Code's
  // versioned WorkspaceEdit rejects concurrent document changes and supports undo.
  if (request.revision !== session.revision || document.getText() !== text || document.isDirty) throw new Error("Source or review changed during editing.");
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), result.text);
  if (!await vscode.workspace.applyEdit(edit)) throw new Error("VS Code rejected the edit because the document changed.");
  void vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
  return { ok: true, ...("discarded" in result ? { discarded: result.discarded, restored: result.restored, partsReverted: result.partsReverted } : {}) };
}

export async function saveReview(text: string, target: vscode.Uri) {
  const edit = new vscode.WorkspaceEdit();
  edit.createFile(target, { overwrite: false });
  edit.insert(target, new vscode.Position(0, 0), text);
  if (!await vscode.workspace.applyEdit(edit)) throw new Error("Choose a new filename; existing reviews are not overwritten.");
  const document = await vscode.workspace.openTextDocument(target);
  if (!await document.save()) throw new Error("Review remains unsaved. Save it from the editor.");
  return document;
}

function attach(session: Session, context: vscode.ExtensionContext) {
  sessions.add(session);
  const webview = session.panel.webview;
  const media = vscode.Uri.joinPath(context.extensionUri, "dist");
  webview.options = { enableScripts: true, localResourceRoots: [media] };
  const nonce = randomBytes(24).toString("base64");
  webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};"><link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(media, "webview.css"))}"></head><body><div id="root">Loading Whymark…</div><script nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.joinPath(media, "webview.js"))}"></script></body></html>`;
  const subscriptions: vscode.Disposable[] = [];
  subscriptions.push(webview.onDidReceiveMessage(async input => {
    const m = parseRequest(input);
    if (!m) return;
    try {
      if (m.type === "ready") { await render(session); return; }
      if (m.type === "external") { await vscode.env.openExternal(vscode.Uri.parse(m.url)); return; }
      if (m.type === "source") {
        if (session.document) await vscode.commands.executeCommand("vscode.openWith", session.document.uri, "default", vscode.ViewColumn.Beside);
        else await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: "whymark", content: session.text() }), vscode.ViewColumn.Beside);
        return;
      }
      if (m.type === "open") {
        if (!session.root || !session.doc?.files.some(f => f.path === m.path)) throw new Error("File is not in this review's repository.");
        const path = await safeFile(session.root, m.path);
        const position = new vscode.Position((m.line ?? 1) - 1, 0);
        await vscode.window.showTextDocument(vscode.Uri.file(path), { viewColumn: vscode.ViewColumn.Beside, selection: new vscode.Range(position, position) }); return;
      }
      if (m.type === "save") {
        const target = await vscode.window.showSaveDialog({ defaultUri: session.root ? vscode.Uri.file(join(session.root, "review.whymark")) : undefined, filters: { Whymark: ["whymark"] } });
        if (target) {
          await saveReview(session.text(), target);
          await vscode.commands.executeCommand("vscode.openWith", target, VIEW);
        }
        return;
      }
      if (session.busy) throw new Error("Another operation is still running.");
      session.busy = true;
      try {
        if (m.type === "refresh") {
          if (session.comparison) {
            const result = await generateComparison(session.comparison);
            session.text = () => result.text; session.root = result.root;
          }
          await render(session);
        } else if (m.type === "apply" || m.type === "edit") {
          const result = await applyRequest(session, m);
          await webview.postMessage({ type: "result", id: m.id, result });
          // Keep UI selections until the next explicit refresh; every edit still
          // revalidates the actual source and refuses a stale second write.
        }
      } finally { session.busy = false; }
    } catch (error) {
      if ("id" in m) await webview.postMessage({ type: "result", id: m.id, result: { ok: false, error: String(error) } });
      else { await webview.postMessage({ type: "error", message: String(error) }); report(error); }
    }
  }));
  subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => { if (e.document === session.document) void render(session); }));
  subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => { void render(session); }));
  session.panel.onDidDispose(() => { session.disposed = true; sessions.delete(session); subscriptions.forEach(d => d.dispose()); });
}

async function chooseFolder(resource?: vscode.Uri | { rootUri?: vscode.Uri }): Promise<vscode.WorkspaceFolder | undefined> {
  const uri = resource instanceof vscode.Uri ? resource : resource?.rootUri;
  if (uri) { const folder = vscode.workspace.getWorkspaceFolder(uri); if (folder) return folder; }
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) throw new Error("Open a Git workspace folder first.");
  return folders.length === 1 ? folders[0] : vscode.window.showWorkspaceFolderPick();
}

export function activate(context: vscode.ExtensionContext) {
  extensionRoot = context.extensionPath;
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW, {
    async resolveCustomTextEditor(document, panel) {
      attach({ document, panel, text: () => document.getText(), root: await repositoryFor(document.uri), label: vscode.workspace.asRelativePath(document.uri), revision: 0, disposed: false, busy: false }, context);
    },
  }, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }));
  context.subscriptions.push(vscode.commands.registerCommand("whymark.open", async (uri?: vscode.Uri) => {
    try {
      uri ??= vscode.window.activeTextEditor?.document.uri.path.endsWith(".whymark") ? vscode.window.activeTextEditor.document.uri : (await vscode.window.showOpenDialog({ filters: { Whymark: ["whymark"] }, canSelectMany: false }))?.[0];
      if (uri) await vscode.commands.executeCommand("vscode.openWith", uri, VIEW);
    } catch (error) { report(error); }
  }));
  for (const scope of ["staged", "unstaged", "worktree", "branch", "commit"] as const) {
    context.subscriptions.push(vscode.commands.registerCommand(`whymark.${scope}`, async (resource?: vscode.Uri | { rootUri?: vscode.Uri }) => {
      try {
        requireTrust();
        const folder = await chooseFolder(resource); if (!folder) return;
        if (folder.uri.scheme !== "file") throw new Error("This extension requires a filesystem workspace.");
        const ref = scope === "branch" || scope === "commit" ? await vscode.window.showInputBox({ prompt: scope === "branch" ? "Base branch or revision (merge base with HEAD)" : "Commit to review", value: scope === "branch" ? "main" : "HEAD", validateInput: value => !value.trim() || value.startsWith("-") || /[\s\x00-\x1f]/.test(value) ? "Enter a Git ref without whitespace or leading hyphens." : undefined }) : undefined;
        if ((scope === "branch" || scope === "commit") && ref === undefined) return;
        const resourceUri = resource instanceof vscode.Uri ? resource : resource?.rootUri;
        const comparison: Comparison = { scope, cwd: resourceUri?.scheme === "file" ? resourceUri.fsPath : folder.uri.fsPath, base: scope === "branch" ? ref : undefined, commit: scope === "commit" ? ref : undefined, untracked: vscode.workspace.getConfiguration("whymark", folder.uri).get("includeUntracked", true) };
        if (vscode.workspace.textDocuments.some(d => d.isDirty && vscode.workspace.getWorkspaceFolder(d.uri)?.uri.toString() === folder.uri.toString())) void vscode.window.showInformationMessage("Whymark compares saved files on disk. Unsaved editor changes are not included.");
        const result = await generateComparison(comparison);
        const panel = vscode.window.createWebviewPanel(VIEW, `Whymark: ${scope}`, vscode.ViewColumn.Active, { retainContextWhenHidden: true });
        attach({ panel, text: () => result.text, root: result.root, label: `${scope} comparison · ${folder.name}`, comparison, revision: 0, disposed: false, busy: false }, context);
      } catch (error) { report(error); }
    }));
  }
  return { sessions, applyRequest, saveReview };
}
export function deactivate() { for (const session of sessions) session.panel.dispose(); }
