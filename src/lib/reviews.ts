import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parseWhymark } from "@/lib/whymark/parse";
import { computeStats, type DocStats } from "@/lib/whymark/stats";
import type { WhymarkDocument } from "@/lib/whymark/types";

export const REVIEWS_DIR = join(process.cwd(), "reviews");

export interface ReviewEntry {
  slug: string;
  file: string;
  mtime: number;
  doc: WhymarkDocument;
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
  for (const name of names.filter((n) => n.endsWith(".whymark"))) {
    const file = join(REVIEWS_DIR, name);
    const [text, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    const doc = parseWhymark(text, { filename: name });
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
  const file = join(REVIEWS_DIR, `${safe}.whymark`);
  let text: string;
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    [text, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
  } catch {
    return null;
  }
  const doc = parseWhymark(text, { filename: `${safe}.whymark` });
  return {
    slug: safe,
    file: `${safe}.whymark`,
    mtime: info.mtimeMs,
    doc,
    stats: computeStats(doc),
  };
}

export async function loadRawReview(slug: string): Promise<string | null> {
  const safe = slug.replace(/[^a-zA-Z0-9._-]/g, "");
  try {
    return await readFile(join(REVIEWS_DIR, `${safe}.whymark`), "utf8");
  } catch {
    return null;
  }
}
