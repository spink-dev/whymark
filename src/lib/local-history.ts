import { historyMeta } from "./render-local";

const DB_NAME = "whymark";
const STORE = "history";
const DB_VERSION = 1;
const MAX_ITEMS = 25;

export interface HistoryEntry {
  id: string;
  title: string;
  author?: string;
  summary?: string;
  openedAt: number;
  bytes: number;
  coverage?: number;
  files?: number;
  added?: number;
  removed?: number;
  text: string;
}

function available(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" }).createIndex("openedAt", "openedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listHistory(): Promise<HistoryEntry[]> {
  if (!available()) return [];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => {
      const rows = (request.result as HistoryEntry[]).sort((a, b) => b.openedAt - a.openedAt);
      resolve(rows);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getHistory(id: string): Promise<HistoryEntry | undefined> {
  if (!available()) return undefined;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result as HistoryEntry | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function saveHistory(text: string): Promise<HistoryEntry> {
  const meta = historyMeta(text);
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    title: meta.title,
    author: meta.author,
    summary: meta.summary,
    openedAt: Date.now(),
    bytes: new TextEncoder().encode(text).length,
    coverage: meta.coverage,
    files: meta.files,
    added: meta.added,
    removed: meta.removed,
    text,
  };
  if (!available()) return entry;

  const db = await openDb();
  const existing = await listHistory();
  const duplicate = existing.find((row) => row.text === text);
  if (duplicate) {
    duplicate.openedAt = entry.openedAt;
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(duplicate);
    await txDone(tx);
    return duplicate;
  }

  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  store.put(entry);
  for (const stale of existing.slice(MAX_ITEMS - 1)) store.delete(stale.id);
  await txDone(tx);
  return entry;
}

export async function deleteHistory(id: string): Promise<void> {
  if (!available()) return;
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await txDone(tx);
}

export async function clearHistory(): Promise<void> {
  if (!available()) return;
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).clear();
  await txDone(tx);
}

/** Drops this origin's IndexedDB, local/session storage, and Cache Storage. */
export async function clearAppData(): Promise<void> {
  if (typeof localStorage !== "undefined") localStorage.clear();
  if (typeof sessionStorage !== "undefined") sessionStorage.clear();
  if (available()) {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  }
  if (typeof caches !== "undefined") {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
}
