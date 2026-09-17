import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync, realpathSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { WhymarkDocument } from "./types";
import { evidenceViews, type ExecutionEvidence } from "./evidence";

export const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

export function gitHead(cwd: string): string | null {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}

function excluded(path: string) {
  return (path.startsWith("reviews/") && (path.endsWith(".whymark") || path.endsWith(".quality.json"))) || path.startsWith(".artifacts/");
}

export function cleanSource(cwd: string): boolean {
  try {
    const entries = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd, encoding: "utf8" }).split("\0").filter(Boolean);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!excluded(entry.slice(3))) return false;
      if (/[RC]/.test(entry.slice(0, 2)) && !excluded(entries[++i] ?? "")) return false;
    }
    return true;
  } catch { return false; }
}

export function resolveRevision(cwd: string, value: string | undefined): string | null {
  const hash = value?.match(/(?:^|@)([a-f0-9]{7,40})$/)?.[1];
  if (!hash) return null;
  try { return execFileSync("git", ["rev-parse", "--verify", `${hash}^{commit}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}

export function sourceFingerprint(cwd: string): string | null {
  try {
    const names = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    const paths = [...new Set(names.split("\0").filter(Boolean))].sort();
    if (paths.length > 50000) return null;
    const digest = createHash("sha256").update("whymark-source-v1\0").update(gitHead(cwd) ?? "unborn");
    let bytes = 0;
    for (const path of paths) {
      if (excluded(path)) continue;
      digest.update(`\0${path}\0`);
      try {
        const info = lstatSync(join(cwd, path));
        digest.update(String(info.mode));
        if (info.isSymbolicLink()) digest.update(`link:${readlinkSync(join(cwd, path))}`);
        else if (info.isFile()) {
          bytes += info.size;
          if (info.size > 32 * 1024 * 1024 || bytes > 128 * 1024 * 1024) return null;
          digest.update(readFileSync(join(cwd, path)));
        } else return null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
        digest.update("missing");
      }
    }
    return digest.digest("hex");
  } catch { return null; }
}

export function reviewFingerprint(doc: WhymarkDocument): string {
  return sha256(JSON.stringify({ base: doc.meta.base, head: doc.meta.head, files: doc.files.map(file => ({ path: file.path, oldSha: file.oldSha, newSha: file.newSha, hunks: file.hunks.map(hunk => ({ oldStart: hunk.oldStart, newStart: hunk.newStart, heading: hunk.heading, lines: hunk.lines })) })) }));
}

export function writeOutput(cwd: string, output: string): { outputHash: string; outputArtifact: string } {
  const outputHash = sha256(output);
  const outputArtifact = `.artifacts/whymark/${outputHash}.log`;
  const root = realpathSync(cwd);
  const directory = join(root, ".artifacts/whymark");
  for (const part of [join(root, ".artifacts"), directory]) {
    try { if (lstatSync(part).isSymbolicLink()) throw new Error("Evidence artifact directory is a symlink."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  mkdirSync(directory, { recursive: true });
  const path = join(root, outputArtifact);
  try { writeFileSync(path, output, { flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || lstatSync(path).isSymbolicLink() || sha256(readFileSync(path)) !== outputHash) throw error;
  }
  return { outputHash, outputArtifact };
}

export function localEvidence(doc: WhymarkDocument, cwd: string) {
  return evidenceViews(doc, {
    source: sourceFingerprint(cwd), reviewHash: reviewFingerprint(doc),
    outputAvailable: (record: ExecutionEvidence) => {
      try {
        if (!/^\.artifacts\/whymark\/[a-f0-9]{64}\.log$/.test(record.outputArtifact)) return false;
        const root = realpathSync(cwd);
        const path = realpathSync(resolve(root, record.outputArtifact));
        const rel = relative(root, path);
        if (rel === ".." || rel.startsWith(`..${sep}`)) return false;
        if (lstatSync(path).size > 32 * 1024 * 1024) return false;
        return sha256(readFileSync(path)) === record.outputHash;
      } catch { return false; }
    },
  });
}
