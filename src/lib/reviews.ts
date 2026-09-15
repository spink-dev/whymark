import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parseCrev } from "@/lib/crev/parse";
import { computeStats, type DocStats } from "@/lib/crev/stats";
import type { CrevDocument } from "@/lib/crev/types";

export const REVIEWS_DIR = join(process.cwd(), "reviews");

export interface ReviewEntry {
  slug: string;
  file: string;
  mtime: number;
  doc: CrevDocument;
  stats: DocStats;
}

export function slugFor(file: string): string {
  return basename(file, extname(file));
}

export async function listReviews(): Promise<ReviewEntry[]> {
  let names: string[];
  try {
    names = await readdir(REVIEWS_DIR);
  } catch {
    return [];
  }

  const entries: ReviewEntry[] = [];
  for (const name of names.filter((n) => n.endsWith(".crev"))) {
    const file = join(REVIEWS_DIR, name);
    const [text, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    const doc = parseCrev(text, { filename: name });
    entries.push({
      slug: slugFor(name),
      file: name,
      mtime: info.mtimeMs,
      doc,
      stats: computeStats(doc),
    });
  }

  return entries.sort((a, b) => {
    const aDate = Date.parse(a.doc.meta.date ?? "") || a.mtime;
    const bDate = Date.parse(b.doc.meta.date ?? "") || b.mtime;
    return bDate - aDate;
  });
}

export async function loadReview(slug: string): Promise<ReviewEntry | null> {
  const safe = slug.replace(/[^a-zA-Z0-9._-]/g, "");
  const file = join(REVIEWS_DIR, `${safe}.crev`);
  let text: string;
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    [text, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
  } catch {
    return null;
  }
  const doc = parseCrev(text, { filename: `${safe}.crev` });
  return {
    slug: safe,
    file: `${safe}.crev`,
    mtime: info.mtimeMs,
    doc,
    stats: computeStats(doc),
  };
}

export async function loadRawReview(slug: string): Promise<string | null> {
  const safe = slug.replace(/[^a-zA-Z0-9._-]/g, "");
  try {
    return await readFile(join(REVIEWS_DIR, `${safe}.crev`), "utf8");
  } catch {
    return null;
  }
}
