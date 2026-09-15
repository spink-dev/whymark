import { execFileSync, spawnSync } from "node:child_process";
import {
  type CrevDocument,
  type FileSection,
  type FileStatus,
  type Hunk,
  type Note,
  type Scope,
  emptyMeta,
} from "./types";

export interface GitOptions {
  cwd?: string;
}

export function git(args: string[], options: GitOptions = {}): string {
  return execFileSync("git", args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
}

export function tryGit(args: string[], options: GitOptions = {}): string | null {
  try {
    return git(args, options);
  } catch {
    return null;
  }
}

/** `git diff --no-index` exits 1 when files differ, which is not an error here. */
function gitAllowFail(args: string[], options: GitOptions = {}): string {
  const result = spawnSync("git", args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  return result.stdout ?? "";
}

export function isGitRepo(cwd?: string): boolean {
  return tryGit(["rev-parse", "--git-dir"], { cwd }) !== null;
}

export function repoRoot(cwd?: string): string {
  return (tryGit(["rev-parse", "--show-toplevel"], { cwd }) ?? "").trim();
}

export function currentBranch(cwd?: string): string {
  return (tryGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd }) ?? "").trim();
}

export function shortSha(rev: string, cwd?: string): string {
  return (tryGit(["rev-parse", "--short", rev], { cwd }) ?? "").trim();
}

export function repoName(cwd?: string): string | undefined {
  const url = (tryGit(["remote", "get-url", "origin"], { cwd }) ?? "").trim();
  if (!url) return undefined;
  const m = /([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url);
  return m ? m[1] : url;
}

/** The branch a feature branch is most likely based on. */
export function defaultBaseBranch(cwd?: string): string {
  const head = (
    tryGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd }) ?? ""
  ).trim();
  if (head) return head;
  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    if (tryGit(["rev-parse", "--verify", "--quiet", candidate], { cwd })) {
      return candidate;
    }
  }
  return "HEAD";
}

export interface DiffRequest {
  scope: Scope;
  /** For `branch` scope: the ref to diff against. Defaults to the main branch. */
  base?: string;
  /** For `commit` scope: the commit to show. */
  commit?: string;
  /** Limit to these pathspecs. */
  paths?: string[];
  context?: number;
  cwd?: string;
  /**
   * Include files git does not track yet. A brand-new file is the most common
   * thing an agent writes, and `git diff` never mentions it.
   */
  untracked?: boolean;
}

export interface DiffResult {
  raw: string;
  files: FileSection[];
  base?: string;
  head?: string;
  scope: Scope;
}

export function collectDiff(request: DiffRequest): DiffResult {
  const cwd = request.cwd;
  const context = request.context ?? 3;
  const common = [
    "--no-ext-diff",
    "--no-color",
    `-U${context}`,
    "--find-renames",
    "--src-prefix=a/",
    "--dst-prefix=b/",
  ];
  const paths = request.paths?.length ? ["--", ...request.paths] : [];

  let args: string[];
  let base: string | undefined;
  let head: string | undefined;

  switch (request.scope) {
    case "staged":
      args = ["diff", "--cached", ...common, ...paths];
      base = `HEAD@${shortSha("HEAD", cwd)}`;
      head = "index";
      break;
    case "unstaged":
      args = ["diff", ...common, ...paths];
      base = "index";
      head = "working-tree";
      break;
    case "worktree":
      args = ["diff", "HEAD", ...common, ...paths];
      base = `HEAD@${shortSha("HEAD", cwd)}`;
      head = "working-tree";
      break;
    case "branch": {
      const baseRef = request.base ?? defaultBaseBranch(cwd);
      args = ["diff", `${baseRef}...HEAD`, ...common, ...paths];
      base = `${baseRef}@${shortSha(baseRef, cwd)}`;
      head = `${currentBranch(cwd)}@${shortSha("HEAD", cwd)}`;
      break;
    }
    case "commit": {
      const rev = request.commit ?? "HEAD";
      args = ["show", "--format=", rev, ...common, ...paths];
      base = `${rev}^@${shortSha(`${rev}^`, cwd)}`;
      head = `${rev}@${shortSha(rev, cwd)}`;
      break;
    }
    default:
      throw new Error(`Scope \`${request.scope}\` cannot be read from git.`);
  }

  const raw = git(args, { cwd });
  const files = parseUnifiedDiff(raw);

  if (request.untracked && request.scope !== "commit" && request.scope !== "branch") {
    files.push(...collectUntracked(context, cwd, request.paths));
  }

  return { raw, files, base, head, scope: request.scope };
}

function collectUntracked(
  context: number,
  cwd?: string,
  paths?: string[],
): FileSection[] {
  const listed = tryGit(
    ["ls-files", "--others", "--exclude-standard", ...(paths?.length ? ["--", ...paths] : [])],
    { cwd },
  );
  if (!listed) return [];

  const out: FileSection[] = [];
  for (const path of listed.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const raw = gitAllowFail(
      [
        "diff",
        "--no-index",
        "--no-color",
        `-U${context}`,
        "--",
        "/dev/null",
        path,
      ],
      { cwd },
    );
    const [section] = parseUnifiedDiff(raw);
    if (!section) continue;
    section.path = path;
    section.oldPath = undefined;
    section.status = "added";
    section.newSha = hashObject(path, cwd) ?? undefined;
    out.push(section);
  }
  return out;
}

const HUNK_RE = /^@@+\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@+(.*)$/;

export function parseUnifiedDiff(raw: string): FileSection[] {
  const normalised = raw.replace(/\r\n?/g, "\n");
  const lines = normalised.split("\n");
  // A trailing newline yields one empty element that is not a diff line.
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const files: FileSection[] = [];
  let file: FileSection | null = null;
  let hunk: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const start = (path: string): FileSection => {
    const section: FileSection = {
      path,
      status: "modified",
      added: 0,
      removed: 0,
      binary: false,
      hunks: [],
      notes: [],
    };
    files.push(section);
    return section;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const paths = splitDiffGitPaths(line.slice("diff --git ".length));
      file = start(paths.b ?? paths.a ?? "(unknown)");
      hunk = null;
      continue;
    }
    if (!file) continue;

    if (line.startsWith("new file mode")) {
      file.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      file.status = "deleted";
      continue;
    }
    if (line.startsWith("rename from ")) {
      file.oldPath = line.slice("rename from ".length).trim();
      file.status = "renamed";
      continue;
    }
    if (line.startsWith("rename to ")) {
      file.path = line.slice("rename to ".length).trim();
      continue;
    }
    if (line.startsWith("index ")) {
      const m = /^index ([0-9a-f]+)\.\.([0-9a-f]+)/.exec(line);
      if (m) {
        if (!/^0+$/.test(m[1])) file.oldSha = m[1];
        if (!/^0+$/.test(m[2])) file.newSha = m[2];
      }
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      file.binary = true;
      continue;
    }
    if (line.startsWith("--- ")) {
      const path = stripPrefix(line.slice(4));
      if (path && path !== "/dev/null") file.oldPath ??= path;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const path = stripPrefix(line.slice(4));
      if (path && path !== "/dev/null") file.path = path;
      continue;
    }
    if (line.startsWith("old mode") || line.startsWith("new mode")) continue;
    if (line.startsWith("similarity index")) continue;

    const m = HUNK_RE.exec(line);
    if (m) {
      hunk = {
        raw: line,
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        heading: m[5]?.trim() || undefined,
        lines: [],
      };
      file.hunks.push(hunk);
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      continue;
    }

    if (!hunk) continue;

    if (line.startsWith("\\")) {
      hunk.lines.push({ type: "nonewline", text: line.slice(1).trim() });
      continue;
    }
    const prefix = line[0];
    const text = line.slice(1);
    if (prefix === "+") {
      hunk.lines.push({ type: "add", text, newLine: newLine++ });
      file.added++;
    } else if (prefix === "-") {
      hunk.lines.push({ type: "del", text, oldLine: oldLine++ });
      file.removed++;
    } else if (prefix === " ") {
      hunk.lines.push({
        type: "context",
        text,
        oldLine: oldLine++,
        newLine: newLine++,
      });
    }
  }

  for (const f of files) {
    while (
      f.hunks.length &&
      f.hunks[f.hunks.length - 1].lines.length === 0 &&
      !f.binary
    ) {
      f.hunks.pop();
    }
  }

  return files;
}

function splitDiffGitPaths(rest: string): { a?: string; b?: string } {
  const quoted = /^"(.+)"\s+"(.+)"$/.exec(rest);
  if (quoted) return { a: stripPrefix(quoted[1]), b: stripPrefix(quoted[2]) };
  const halves = rest.trim().split(" b/");
  if (halves.length === 2) {
    return { a: stripPrefix(halves[0]), b: halves[1] };
  }
  return {};
}

function stripPrefix(path: string): string {
  const p = path.trim().replace(/^"|"$/g, "");
  if (p.startsWith("a/") || p.startsWith("b/")) return p.slice(2);
  return p;
}

/* ------------------------------------------------------------------ */
/* skeleton generation                                                 */
/* ------------------------------------------------------------------ */

export type StubMode = "hunk" | "file" | "none";

export interface SkeletonOptions extends DiffRequest {
  title?: string;
  author?: string;
  stubs?: StubMode;
  /** Commands to record as unrun checks. */
  checks?: string[];
}

export function buildSkeleton(options: SkeletonOptions): {
  doc: CrevDocument;
  diff: DiffResult;
} {
  const diff = collectDiff(options);
  const meta = emptyMeta(options.title ?? titleFor(options.scope, diff));
  meta.author = options.author;
  meta.date = new Date().toISOString();
  meta.scope = options.scope;
  meta.base = diff.base;
  meta.head = diff.head;
  meta.repo = repoName(options.cwd);
  meta.summary = SUMMARY_STUB;
  meta.checks = (options.checks ?? []).map((cmd) => ({
    cmd,
    status: "unknown" as const,
  }));

  const stubs = options.stubs ?? "hunk";
  let counter = 0;
  for (const file of diff.files) {
    if (stubs === "none" || file.binary) continue;
    if (stubs === "file") {
      file.notes.push(stubNote(`file`, ++counter, file.path));
      continue;
    }
    for (const hunk of file.hunks) {
      const selector = hunkSelector(hunk);
      if (!selector) continue;
      file.notes.push(stubNote(selector, ++counter, file.path));
    }
  }

  return {
    doc: { meta, files: diff.files, notes: [], diagnostics: [] },
    diff,
  };
}

const SUMMARY_STUB =
  "TODO: what this change does, in a paragraph, for a reviewer who has not seen it.";

function hunkSelector(hunk: Hunk): string | null {
  const added = hunk.lines.filter((l) => l.type === "add" && l.newLine);
  if (added.length) {
    const first = added[0].newLine!;
    const last = added[added.length - 1].newLine!;
    return first === last ? `+${first}` : `+${first}..${last}`;
  }
  const removed = hunk.lines.filter((l) => l.type === "del" && l.oldLine);
  if (removed.length) {
    const first = removed[0].oldLine!;
    const last = removed[removed.length - 1].oldLine!;
    return first === last ? `-${first}` : `-${first}..${last}`;
  }
  return null;
}

function stubNote(selector: string, counter: number, file: string): Note {
  const parsed = selector === "file"
    ? { side: "file" as const, start: 0, end: 0, raw: "file" }
    : parseSelectorLoose(selector);
  return {
    id: `n${counter}`,
    selector: parsed,
    kind: "intent",
    sources: [
      {
        type: "inference",
        locator: "",
        note: "TODO: replace with a real source, or keep `inference` and say what it was pattern-matched from.",
        raw: "inference — TODO: replace with a real source, or keep `inference` and say what it was pattern-matched from.",
      },
    ],
    verify: [
      {
        method: "none",
        status: "unknown",
        raw: "none => unknown (TODO: run something and record it)",
        comment: "TODO: run something and record it",
      },
    ],
    alternatives: [],
    todos: [],
    questions: [],
    refs: [],
    why: "TODO: why this code is the way it is. Not what it does.",
    body: "",
    extra: {},
    sourceLine: 0,
    file,
  };
}

function parseSelectorLoose(raw: string) {
  const m = /^([+-])(\d+)(?:\.\.(\d+))?$/.exec(raw);
  const side = m?.[1] === "-" ? ("old" as const) : ("new" as const);
  const start = m ? Number(m[2]) : 0;
  const end = m?.[3] ? Number(m[3]) : start;
  return { side, start, end, raw };
}

function titleFor(scope: Scope, diff: DiffResult): string {
  const count = diff.files.length;
  const noun = count === 1 ? diff.files[0]?.path : `${count} files`;
  switch (scope) {
    case "staged":
      return `Staged changes to ${noun}`;
    case "unstaged":
      return `Unstaged changes to ${noun}`;
    case "branch":
      return `Branch changes to ${noun}`;
    case "commit":
      return `Commit touching ${noun}`;
    default:
      return `Changes to ${noun}`;
  }
}

/** Current blob hash of a working-tree file, for staleness detection. */
export function hashObject(path: string, cwd?: string): string | null {
  const out = tryGit(["hash-object", "--", path], { cwd });
  return out ? out.trim() : null;
}
