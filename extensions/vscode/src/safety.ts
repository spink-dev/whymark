import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
export const MAX_REVIEW_BYTES = 8 * 1024 * 1024;
export function blobHash(text: string): string {
  return createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");
}
export async function safeFile(root: string, path: string): Promise<string> {
  if (!path || isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.includes("\\") || path.split("/").some(p => p === ".." || p === ".git") || path.includes("\0")) throw new Error("Path must stay inside the repository.");
  const base = await realpath(root);
  const target = await realpath(resolve(base, path));
  const rel = relative(base, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Path escapes the repository.");
  const info = await stat(target);
  if (!info.isFile() || info.size > MAX_REVIEW_BYTES) throw new Error("Only files up to 8 MB can be opened or edited.");
  return target;
}
