/**
 * whymark v1 document model. See spec/whymark-v1.md for the format itself.
 */

export const WHYMARK_VERSION = 1;

export type Scope =
  | "unstaged"
  | "staged"
  | "worktree"
  | "branch"
  | "commit"
  | "manual";

export type FileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "context";

export type NoteKind =
  | "intent"
  | "source"
  | "verify"
  | "risk"
  | "assumption"
  | "alternative"
  | "todo"
  | "question"
  | "security"
  | "perf"
  | "test"
  | "generated"
  | "note";

export const NOTE_KINDS: NoteKind[] = [
  "intent",
  "source",
  "verify",
  "risk",
  "assumption",
  "alternative",
  "todo",
  "question",
  "security",
  "perf",
  "test",
  "generated",
  "note",
];

export type Risk = "low" | "medium" | "high";

export type VerifyStatus = "pass" | "fail" | "unknown" | "skipped";

export type VerifyMethod =
  | "cmd"
  | "test"
  | "type"
  | "lint"
  | "manual"
  | "review"
  | "none";

export const VERIFY_METHODS: VerifyMethod[] = [
  "cmd",
  "test",
  "type",
  "lint",
  "manual",
  "review",
  "none",
];

export type SourceType =
  | "file"
  | "url"
  | "doc"
  | "spec"
  | "commit"
  | "pr"
  | "issue"
  | "test"
  | "dep"
  | "convention"
  | "prompt"
  | "inference"
  | "other";

export type Side = "new" | "old" | "file" | "doc";

export interface Selector {
  side: Side;
  /** Inclusive first line, 1-based, in the file's own numbering. 0 for file/doc. */
  start: number;
  /** Inclusive last line. */
  end: number;
  raw: string;
}

export interface SourceRef {
  type: SourceType;
  locator: string;
  /** Why this source matters, i.e. the text after the em dash. */
  note?: string;
  raw: string;
}

export interface VerifyClaim {
  method: VerifyMethod;
  /** The command, test name, or observation. */
  detail?: string;
  status: VerifyStatus;
  comment?: string;
  raw: string;
}

export interface Note {
  id: string;
  selector: Selector;
  kind: NoteKind;
  risk?: Risk;
  confidence?: number;
  why?: string;
  what?: string;
  impact?: string;
  sources: SourceRef[];
  verify: VerifyClaim[];
  alternatives: string[];
  todos: string[];
  questions: string[];
  refs: string[];
  /** Free-form markdown after the fields. */
  body: string;
  /** Fields the spec does not define, preserved verbatim. */
  extra: Record<string, string[]>;
  /** 1-based line of the `@note` directive in the source document. */
  sourceLine: number;
  /** Path of the enclosing file section, or null for document-level notes. */
  file: string | null;
}

export type DiffLineType = "context" | "add" | "del" | "nonewline";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface Hunk {
  raw: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  heading?: string;
  lines: DiffLine[];
}

export interface FileSection {
  path: string;
  oldPath?: string;
  status: FileStatus;
  added: number;
  removed: number;
  oldSha?: string;
  newSha?: string;
  lang?: string;
  binary: boolean;
  hunks: Hunk[];
  notes: Note[];
}

export interface Check {
  cmd: string;
  status: VerifyStatus;
  detail?: string;
  ran?: string;
  /** Set when the check came from an `@check` line rather than frontmatter. */
  inline?: boolean;
}

export interface ReviewState {
  status: "pending" | "approved" | "changes-requested";
  by?: string;
  at?: string;
}

export interface Meta {
  whymark: number;
  title: string;
  author?: string;
  date?: string;
  scope?: Scope;
  base?: string;
  head?: string;
  repo?: string;
  summary?: string;
  tags: string[];
  checks: Check[];
  review?: ReviewState;
  /** Frontmatter keys outside the spec. */
  extra: Record<string, unknown>;
}

export type DiagnosticLevel = "error" | "warning" | "info";

export interface Diagnostic {
  level: DiagnosticLevel;
  code: string;
  message: string;
  /** 1-based line in the .whymark document. */
  line?: number;
  file?: string;
  noteId?: string;
}

export interface WhymarkDocument {
  meta: Meta;
  files: FileSection[];
  /** Notes written before the first `@file`. */
  notes: Note[];
  diagnostics: Diagnostic[];
}

export function emptyMeta(title = "Untitled review"): Meta {
  return {
    whymark: WHYMARK_VERSION,
    title,
    tags: [],
    checks: [],
    extra: {},
  };
}

export function allNotes(doc: WhymarkDocument): Note[] {
  return [...doc.notes, ...doc.files.flatMap((f) => f.notes)];
}

export function isInference(source: SourceRef): boolean {
  return source.type === "inference";
}

/** Notes that carry real explanation rather than only a machine-written stub. */
export const PLACEHOLDER = /\bTODO\b|\bTBD\b|\bFIXME\b|<explain|<why|<source/i;

export function isStub(note: Note): boolean {
  const text = [note.why, note.what, note.body].filter(Boolean).join(" ");
  if (!text.trim()) return true;
  return PLACEHOLDER.test(text);
}
