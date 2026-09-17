"use server";

import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { revalidatePath } from "next/cache";
import { loadReview } from "@/lib/reviews";
import { hashObject } from "@/lib/whymark/git";
import {
  applyDecisions,
  isActionable,
  replaceRange,
  type FileDecisions,
} from "@/lib/whymark/edit";
import { canWriteWorkingTree } from "@/lib/site";
import type { FileSection } from "@/lib/whymark/types";

import type { EditResult } from "@/lib/review-actions";

/**
 * These actions write to the working tree of whoever is running the dev server,
 * which is the point: a reviewer decides here instead of on a pull request page.
 * Two guards make that safe to expose. The path must resolve inside the repo,
 * and the file must still hash to the side the review recorded — so a file that
 * changed under the reviewer is refused rather than silently overwritten.
 */
async function locate(
  slug: string,
  path: string,
): Promise<{ file: FileSection; absolute: string; current: string } | { error: string }> {
  if (!canWriteWorkingTree()) {
    return { error: "This hosted viewer cannot write files. Run it against your own checkout." };
  }
  const review = await loadReview(slug);
  if (!review) return { error: "That review no longer exists." };

  const file = review.doc.files.find((candidate) => candidate.path === path);
  if (!file) return { error: `${path} is not part of this review.` };

  const cwd = process.cwd();
  const absolute = resolve(cwd, path);
  const inside = relative(cwd, absolute);
  if (isAbsolute(path) || !inside || inside === ".." || inside.startsWith(`..${sep}`)) {
    return { error: `${path} resolves outside the repository.` };
  }

  const actual = hashObject(path, cwd);
  if (!isActionable(file, actual)) {
    return {
      error: `${path} no longer matches this review, so it will not be edited. Regenerate the review first.`,
    };
  }

  let current: string;
  try {
    current = await readFile(absolute, "utf8");
  } catch {
    return { error: `${path} could not be read.` };
  }
  return { file, absolute, current };
}

/** Undo the parts of a change the reviewer rejected, in the working tree. */
export async function applyFileDecisions(
  slug: string,
  path: string,
  decisions: FileDecisions,
): Promise<EditResult> {
  const found = await locate(slug, path);
  if ("error" in found) return { ok: false, error: found.error };

  const result = applyDecisions(found.current, found.file.hunks, decisions);
  if (result.text === found.current) {
    return {
      ok: true,
      discarded: 0,
      restored: 0,
      partsReverted: 0,
      newSha: found.file.newSha,
    };
  }

  await writeFile(found.absolute, result.text, "utf8");
  revalidatePath(`/r/${slug}`);
  return {
    ok: true,
    discarded: result.discarded,
    restored: result.restored,
    partsReverted: result.partsReverted,
    newSha: hashObject(path, process.cwd()) ?? undefined,
  };
}

/** Save a reviewer's own edit of a run of lines. */
export async function saveEditedRange(
  slug: string,
  path: string,
  startNewLine: number,
  endNewLine: number,
  text: string,
): Promise<EditResult> {
  const found = await locate(slug, path);
  if ("error" in found) return { ok: false, error: found.error };

  let next: string;
  try {
    next = replaceRange(found.current, startNewLine, endNewLine, text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (next === found.current) return { ok: true, newSha: found.file.newSha };

  await writeFile(found.absolute, next, "utf8");
  revalidatePath(`/r/${slug}`);
  return { ok: true, newSha: hashObject(path, process.cwd()) ?? undefined };
}
