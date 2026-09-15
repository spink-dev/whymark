import YAML from "yaml";
import {
  WHYMARK_VERSION,
  NOTE_KINDS,
  VERIFY_METHODS,
  type WhymarkDocument,
  type Diagnostic,
  type DiffLine,
  type FileSection,
  type FileStatus,
  type Hunk,
  type Meta,
  type Note,
  type NoteKind,
  type Risk,
  type Scope,
  type Selector,
  type SourceRef,
  type SourceType,
  type VerifyClaim,
  type VerifyMethod,
  type VerifyStatus,
  emptyMeta,
} from "./types";

const FILE_STATUSES: FileStatus[] = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "context",
];

const SOURCE_TYPES: SourceType[] = [
  "file",
  "url",
  "doc",
  "spec",
  "commit",
  "pr",
  "issue",
  "test",
  "dep",
  "convention",
  "prompt",
  "inference",
];

const REPEATABLE = new Set([
  "source",
  "verify",
  "alt",
  "alternative",
  "todo",
  "question",
  "ref",
]);

const SCALAR_FIELDS = new Set(["why", "what", "impact"]);

/** Field names that end a free-form body and start a new field. */
const KNOWN_FIELDS = new Set([
  ...SCALAR_FIELDS,
  ...REPEATABLE,
  "kind",
  "risk",
  "confidence",
  "id",
]);

const FIELD_RE = /^([a-zA-Z][a-zA-Z0-9_-]*):([ \t]*)(.*)$/;

/**
 * `why: x` is always a field. `why:x` is one too, but only for the documented
 * field names — otherwise a body line starting with `https://…` would parse as
 * a field called `https`.
 */
function fieldAt(raw: string): { name: string; value: string } | null {
  const match = FIELD_RE.exec(raw);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const tight = match[2].length === 0 && match[3].length > 0;
  if (tight && !KNOWN_FIELDS.has(name)) return null;
  return { name, value: match[3].trim() };
}
const ARROW_RE = /\s*(?:=>|->|⇒)\s*/;

export interface ParseOptions {
  /** Reported in diagnostics so a caller can say where a bad document came from. */
  filename?: string;
}

export function parseWhymark(input: string, options: ParseOptions = {}): WhymarkDocument {
  const text = input.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const diagnostics: Diagnostic[] = [];

  let cursor = 0;
  let meta = emptyMeta();

  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (close === -1) {
      diagnostics.push({
        level: "error",
        code: "frontmatter-unterminated",
        message: "Frontmatter opened with `---` but never closed.",
        line: 1,
      });
    } else {
      meta = parseFrontmatter(lines.slice(1, close).join("\n"), diagnostics);
      cursor = close + 1;
    }
  } else {
    diagnostics.push({
      level: "error",
      code: "frontmatter-missing",
      message:
        "Document has no YAML frontmatter. A whymark file must start with `---` and declare `whymark: 1` and `title`.",
      line: 1,
    });
  }

  const files: FileSection[] = [];
  const docNotes: Note[] = [];
  let file: FileSection | null = null;
  let hunk: Hunk | null = null;
  let noteCtx: NoteContext | null = null;
  let noteCounter = 0;
  const usedIds = new Set<string>();

  const closeHunk = () => {
    if (!hunk) return;
    while (
      hunk.lines.length &&
      hunk.lines[hunk.lines.length - 1].type === "context" &&
      hunk.lines[hunk.lines.length - 1].text === ""
    ) {
      hunk.lines.pop();
    }
    hunk = null;
  };

  const closeNote = () => {
    if (!noteCtx) return;
    finishNote(noteCtx, diagnostics);
    noteCtx = null;
  };

  while (cursor < lines.length) {
    const raw = lines[cursor];
    const lineNo = cursor + 1;

    if (hunk) {
      const consumed = consumeHunkLine(hunk, raw);
      if (consumed) {
        cursor++;
        continue;
      }
      closeHunk();
    }

    if (raw.startsWith("@file ") || raw === "@file") {
      closeNote();
      file = parseFileDirective(raw, lineNo, diagnostics);
      files.push(file);
      cursor++;
      continue;
    }

    if (raw.startsWith("@@")) {
      closeNote();
      if (!file) {
        diagnostics.push({
          level: "error",
          code: "hunk-outside-file",
          message: "A hunk appeared before any `@file` directive.",
          line: lineNo,
        });
        file = blankFile("(unknown)");
        files.push(file);
      }
      hunk = parseHunkHeader(raw, file, diagnostics, lineNo);
      file.hunks.push(hunk);
      cursor++;
      continue;
    }

    if (raw.startsWith("@note")) {
      closeNote();
      noteCounter++;
      const note = parseNoteHeader(
        raw,
        lineNo,
        file?.path ?? null,
        noteCounter,
        usedIds,
        diagnostics,
      );
      if (file && note.selector.side !== "doc") file.notes.push(note);
      else docNotes.push(note);
      noteCtx = { note, lastField: null, inBody: false, bodyLines: [] };
      cursor++;
      continue;
    }

    if (raw.startsWith("@check")) {
      closeNote();
      const claim = parseVerifyClaim(raw.slice("@check".length).trim());
      meta.checks.push({
        cmd: claim.detail ?? claim.raw,
        status: claim.status,
        detail: claim.comment,
        inline: true,
      });
      cursor++;
      continue;
    }

    if (noteCtx) {
      applyNoteLine(noteCtx, raw, lineNo, diagnostics);
      cursor++;
      continue;
    }

    if (raw.startsWith("#") || raw.trim() === "") {
      cursor++;
      continue;
    }

    diagnostics.push({
      level: "warning",
      code: "stray-line",
      message: `Line is not part of any section and was ignored: ${truncate(raw)}`,
      line: lineNo,
      file: file?.path,
    });
    cursor++;
  }

  closeHunk();
  closeNote();

  for (const f of files) recountFile(f);
  for (const f of files) {
    for (const note of f.notes) validateSelectorAgainstFile(note, f, diagnostics);
  }

  if (options.filename) {
    for (const d of diagnostics) d.file ??= options.filename;
  }

  return { meta, files, notes: docNotes, diagnostics };
}

/* ------------------------------------------------------------------ */
/* frontmatter                                                         */
/* ------------------------------------------------------------------ */

function parseFrontmatter(source: string, diagnostics: Diagnostic[]): Meta {
  let data: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(source) as unknown;
    if (parsed && typeof parsed === "object") {
      data = parsed as Record<string, unknown>;
    }
  } catch (error) {
    diagnostics.push({
      level: "error",
      code: "frontmatter-invalid",
      message: `Frontmatter is not valid YAML: ${(error as Error).message}`,
      line: 2,
    });
  }

  const known = new Set([
    "whymark",
    "title",
    "author",
    "date",
    "scope",
    "base",
    "head",
    "repo",
    "summary",
    "tags",
    "checks",
    "review",
    "stats",
  ]);

  const meta = emptyMeta();
  meta.whymark = typeof data.whymark === "number" ? data.whymark : NaN;
  if (Number.isNaN(meta.whymark)) {
    diagnostics.push({
      level: "error",
      code: "version-missing",
      message: "Frontmatter must declare `whymark: 1`.",
      line: 2,
    });
    meta.whymark = WHYMARK_VERSION;
  } else if (meta.whymark !== WHYMARK_VERSION) {
    diagnostics.push({
      level: "warning",
      code: "version-unsupported",
      message: `Document declares whymark ${meta.whymark}; this tool implements ${WHYMARK_VERSION}.`,
      line: 2,
    });
  }

  if (typeof data.title === "string" && data.title.trim()) {
    meta.title = data.title.trim();
  } else {
    diagnostics.push({
      level: "error",
      code: "title-missing",
      message: "Frontmatter must declare a `title`.",
      line: 2,
    });
  }

  if (typeof data.author === "string") meta.author = data.author;
  if (typeof data.date === "string") meta.date = data.date;
  else if (data.date instanceof Date) meta.date = data.date.toISOString();
  if (typeof data.base === "string") meta.base = data.base;
  if (typeof data.head === "string") meta.head = data.head;
  if (typeof data.repo === "string") meta.repo = data.repo;
  if (typeof data.summary === "string") meta.summary = data.summary.trim();

  if (typeof data.scope === "string") {
    const scopes: Scope[] = [
      "unstaged",
      "staged",
      "worktree",
      "branch",
      "commit",
      "manual",
    ];
    if (scopes.includes(data.scope as Scope)) meta.scope = data.scope as Scope;
    else
      diagnostics.push({
        level: "warning",
        code: "scope-unknown",
        message: `Unknown scope \`${data.scope}\`.`,
        line: 2,
      });
  }

  if (Array.isArray(data.tags)) {
    meta.tags = data.tags.filter((t): t is string => typeof t === "string");
  }

  if (Array.isArray(data.checks)) {
    for (const entry of data.checks) {
      if (typeof entry === "string") {
        meta.checks.push({ cmd: entry, status: "unknown" });
        continue;
      }
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        const cmd = typeof e.cmd === "string" ? e.cmd : undefined;
        if (!cmd) continue;
        meta.checks.push({
          cmd,
          status: normaliseStatus(e.status),
          detail: typeof e.detail === "string" ? e.detail : undefined,
          ran: typeof e.ran === "string" ? e.ran : undefined,
        });
      }
    }
  }

  if (data.review && typeof data.review === "object") {
    const r = data.review as Record<string, unknown>;
    const status = typeof r.status === "string" ? r.status : "pending";
    meta.review = {
      status:
        status === "approved" || status === "changes-requested"
          ? status
          : "pending",
      by: typeof r.by === "string" ? r.by : undefined,
      at: typeof r.at === "string" ? r.at : undefined,
    };
  }

  for (const key of Object.keys(data)) {
    if (!known.has(key)) {
      meta.extra[key] = data[key];
      diagnostics.push({
        level: "info",
        code: "frontmatter-extra",
        message: `Frontmatter key \`${key}\` is outside the spec and was preserved as-is.`,
        line: 2,
      });
    }
  }

  return meta;
}

function normaliseStatus(value: unknown): VerifyStatus {
  if (typeof value !== "string") return "unknown";
  const v = value.toLowerCase();
  if (v === "pass" || v === "ok" || v === "passed") return "pass";
  if (v === "fail" || v === "failed" || v === "error") return "fail";
  if (v === "skipped" || v === "skip") return "skipped";
  return "unknown";
}

/* ------------------------------------------------------------------ */
/* @file                                                               */
/* ------------------------------------------------------------------ */

function blankFile(path: string): FileSection {
  return {
    path,
    status: "modified",
    added: 0,
    removed: 0,
    binary: false,
    hunks: [],
    notes: [],
  };
}

function parseFileDirective(
  raw: string,
  lineNo: number,
  diagnostics: Diagnostic[],
): FileSection {
  const rest = raw.slice("@file".length).trim();
  const { value: path, rest: tail } = takePath(rest);
  if (!path) {
    diagnostics.push({
      level: "error",
      code: "file-path-missing",
      message: "`@file` needs a path.",
      line: lineNo,
    });
  }
  const section = blankFile(path || "(unknown)");
  let sawStatus = false;

  for (const token of tokenise(tail)) {
    const eq = token.indexOf("=");
    if (eq > 0) {
      const key = token.slice(0, eq);
      const value = unquote(token.slice(eq + 1));
      switch (key) {
        case "from":
          section.oldPath = value;
          break;
        case "oldsha":
          section.oldSha = value;
          break;
        case "newsha":
          section.newSha = value;
          break;
        case "lang":
          section.lang = value;
          break;
        default:
          diagnostics.push({
            level: "info",
            code: "file-attr-unknown",
            message: `Unknown \`@file\` attribute \`${key}\`.`,
            line: lineNo,
            file: section.path,
          });
      }
      continue;
    }
    if (FILE_STATUSES.includes(token as FileStatus)) {
      section.status = token as FileStatus;
      sawStatus = true;
      continue;
    }
    if (token === "binary") {
      section.binary = true;
      continue;
    }
    // `+12` / `-3` counts are recomputed from the diff; accept and ignore.
    if (/^[+-]\d+$/.test(token)) continue;
    diagnostics.push({
      level: "info",
      code: "file-token-unknown",
      message: `Unrecognised \`@file\` token \`${token}\`.`,
      line: lineNo,
      file: section.path,
    });
  }

  if (!sawStatus && section.oldPath && section.oldPath !== section.path) {
    section.status = "renamed";
  }
  return section;
}

function takePath(input: string): { value: string; rest: string } {
  const s = input.trimStart();
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1);
    if (end > 0) return { value: s.slice(1, end), rest: s.slice(end + 1) };
  }
  const space = s.search(/\s/);
  if (space === -1) return { value: s, rest: "" };
  return { value: s.slice(0, space), rest: s.slice(space) };
}

function tokenise(input: string): string[] {
  const out: string[] = [];
  const re = /"[^"]*"|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) out.push(m[0]);
  return out;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* hunks                                                               */
/* ------------------------------------------------------------------ */

const HUNK_RE = /^@@+\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@+(.*)$/;

function parseHunkHeader(
  raw: string,
  file: FileSection,
  diagnostics: Diagnostic[],
  lineNo: number,
): Hunk {
  const m = HUNK_RE.exec(raw);
  if (m) {
    return {
      raw,
      oldStart: Number(m[1]),
      oldLines: m[2] === undefined ? 1 : Number(m[2]),
      newStart: Number(m[3]),
      newLines: m[4] === undefined ? 1 : Number(m[4]),
      heading: m[5]?.trim() || undefined,
      lines: [],
    };
  }

  const previous = file.hunks[file.hunks.length - 1];
  const oldStart = previous ? lastOldLine(previous) + 1 : 1;
  const newStart = previous ? lastNewLine(previous) + 1 : 1;
  diagnostics.push({
    level: "warning",
    code: "hunk-header-loose",
    message:
      "Hunk header has no line ranges; numbering continues from the previous hunk.",
    line: lineNo,
    file: file.path,
  });
  return {
    raw,
    oldStart,
    oldLines: 0,
    newStart,
    newLines: 0,
    heading: raw.replace(/^@@+/, "").replace(/@@+$/, "").trim() || undefined,
    lines: [],
  };
}

function lastOldLine(hunk: Hunk): number {
  for (let i = hunk.lines.length - 1; i >= 0; i--) {
    const l = hunk.lines[i];
    if (l.oldLine !== undefined) return l.oldLine;
  }
  return hunk.oldStart - 1;
}

function lastNewLine(hunk: Hunk): number {
  for (let i = hunk.lines.length - 1; i >= 0; i--) {
    const l = hunk.lines[i];
    if (l.newLine !== undefined) return l.newLine;
  }
  return hunk.newStart - 1;
}

/** Returns false when the line does not belong to the hunk. */
function consumeHunkLine(hunk: Hunk, raw: string): boolean {
  if (raw === "") {
    push(hunk, { type: "context", text: "" });
    return true;
  }
  const prefix = raw[0];
  if (prefix === "\\") {
    hunk.lines.push({ type: "nonewline", text: raw.slice(1).trim() });
    return true;
  }
  if (prefix === " ") {
    push(hunk, { type: "context", text: raw.slice(1) });
    return true;
  }
  if (prefix === "+") {
    push(hunk, { type: "add", text: raw.slice(1) });
    return true;
  }
  if (prefix === "-") {
    push(hunk, { type: "del", text: raw.slice(1) });
    return true;
  }
  return false;
}

function push(hunk: Hunk, line: Omit<DiffLine, "oldLine" | "newLine">) {
  const next: DiffLine = { ...line };
  if (line.type === "context") {
    next.oldLine = lastOldLine(hunk) + 1;
    next.newLine = lastNewLine(hunk) + 1;
  } else if (line.type === "add") {
    next.newLine = lastNewLine(hunk) + 1;
  } else if (line.type === "del") {
    next.oldLine = lastOldLine(hunk) + 1;
  }
  hunk.lines.push(next);
}

function recountFile(file: FileSection) {
  let added = 0;
  let removed = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") added++;
      else if (line.type === "del") removed++;
    }
  }
  file.added = added;
  file.removed = removed;
}

/* ------------------------------------------------------------------ */
/* notes                                                               */
/* ------------------------------------------------------------------ */

interface NoteContext {
  note: Note;
  lastField: { name: string; index: number } | null;
  inBody: boolean;
  bodyLines: string[];
}

export function parseSelector(raw: string): Selector | null {
  const token = raw.trim();
  if (!token) return null;
  if (token === "file") return { side: "file", start: 0, end: 0, raw: token };
  if (token === "doc" || token === "change") {
    return { side: "doc", start: 0, end: 0, raw: token };
  }
  const sided = /^([+-])(\d+)(?:\s*\.\.\s*[+-]?(\d+))?$/.exec(token);
  if (sided) {
    const start = Number(sided[2]);
    const end = sided[3] === undefined ? start : Number(sided[3]);
    return {
      side: sided[1] === "+" ? "new" : "old",
      start: Math.min(start, end),
      end: Math.max(start, end),
      raw: token,
    };
  }
  const bare = /^L?(\d+)(?:\s*\.\.\s*L?(\d+))?$/.exec(token);
  if (bare) {
    const start = Number(bare[1]);
    const end = bare[2] === undefined ? start : Number(bare[2]);
    return {
      side: "new",
      start: Math.min(start, end),
      end: Math.max(start, end),
      raw: token,
    };
  }
  return null;
}

function parseNoteHeader(
  raw: string,
  lineNo: number,
  filePath: string | null,
  counter: number,
  usedIds: Set<string>,
  diagnostics: Diagnostic[],
): Note {
  const rest = raw.slice("@note".length).trim();
  const tokens = tokenise(rest);
  let selector: Selector | null = null;
  const attrs: Record<string, string> = {};

  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq > 0) {
      attrs[token.slice(0, eq).toLowerCase()] = unquote(token.slice(eq + 1));
      continue;
    }
    if (!selector) {
      selector = parseSelector(token);
      if (!selector) {
        diagnostics.push({
          level: "error",
          code: "selector-invalid",
          message: `Cannot read selector \`${token}\`. Use \`+12\`, \`+12..18\`, \`-30\`, \`file\`, or \`doc\`.`,
          line: lineNo,
          file: filePath ?? undefined,
        });
      }
      continue;
    }
    diagnostics.push({
      level: "info",
      code: "note-token-unknown",
      message: `Unrecognised \`@note\` token \`${token}\`.`,
      line: lineNo,
      file: filePath ?? undefined,
    });
  }

  if (!selector) {
    selector = filePath
      ? { side: "file", start: 0, end: 0, raw: "file" }
      : { side: "doc", start: 0, end: 0, raw: "doc" };
    diagnostics.push({
      level: "warning",
      code: "selector-missing",
      message: `\`@note\` has no selector; treated as \`${selector.raw}\`.`,
      line: lineNo,
      file: filePath ?? undefined,
    });
  }

  let kind: NoteKind = "note";
  if (attrs.kind) {
    if (NOTE_KINDS.includes(attrs.kind as NoteKind)) kind = attrs.kind as NoteKind;
    else
      diagnostics.push({
        level: "warning",
        code: "kind-unknown",
        message: `Unknown note kind \`${attrs.kind}\`; treated as \`note\`.`,
        line: lineNo,
        file: filePath ?? undefined,
      });
  }

  let risk: Risk | undefined;
  if (attrs.risk) {
    if (["low", "medium", "high"].includes(attrs.risk)) risk = attrs.risk as Risk;
    else
      diagnostics.push({
        level: "warning",
        code: "risk-unknown",
        message: `Unknown risk \`${attrs.risk}\`; expected low, medium, or high.`,
        line: lineNo,
        file: filePath ?? undefined,
      });
  }

  let confidence: number | undefined;
  if (attrs.confidence) {
    const value = Number(attrs.confidence.replace("%", ""));
    if (Number.isFinite(value)) {
      confidence = attrs.confidence.includes("%") ? value / 100 : value;
      if (confidence > 1) confidence = confidence / 100;
      if (confidence < 0) confidence = 0;
    } else {
      diagnostics.push({
        level: "warning",
        code: "confidence-invalid",
        message: `Confidence \`${attrs.confidence}\` is not a number between 0 and 1.`,
        line: lineNo,
        file: filePath ?? undefined,
      });
    }
  }

  let id = attrs.id?.trim() || `n${counter}`;
  if (usedIds.has(id)) {
    diagnostics.push({
      level: "warning",
      code: "id-duplicate",
      message: `Note id \`${id}\` is used more than once; renamed to \`${id}-${counter}\`.`,
      line: lineNo,
      file: filePath ?? undefined,
    });
    id = `${id}-${counter}`;
  }
  usedIds.add(id);

  return {
    id,
    selector,
    kind,
    risk,
    confidence,
    sources: [],
    verify: [],
    alternatives: [],
    todos: [],
    questions: [],
    refs: [],
    body: "",
    extra: {},
    sourceLine: lineNo,
    file: filePath,
  };
}

function applyNoteLine(
  ctx: NoteContext,
  raw: string,
  lineNo: number,
  diagnostics: Diagnostic[],
) {
  if (ctx.inBody) {
    // Models often write a field after a paragraph. Recognise the documented
    // field names again rather than silently swallowing them into prose.
    const resumed = fieldAt(raw);
    if (resumed && KNOWN_FIELDS.has(resumed.name)) {
      ctx.inBody = false;
      setField(ctx, resumed.name, resumed.value, lineNo, diagnostics);
      return;
    }
    ctx.bodyLines.push(raw);
    return;
  }

  if (raw.trim() === "") {
    ctx.lastField = null;
    if (ctx.bodyLines.length) ctx.bodyLines.push("");
    return;
  }

  const indented = /^[ \t]{2,}\S/.test(raw);
  if (indented && ctx.lastField) {
    appendToField(ctx, raw.trim());
    return;
  }

  const field = indented ? null : fieldAt(raw);
  if (field) {
    setField(ctx, field.name, field.value, lineNo, diagnostics);
    return;
  }

  ctx.inBody = true;
  ctx.lastField = null;
  ctx.bodyLines.push(raw);
}

function setField(
  ctx: NoteContext,
  name: string,
  value: string,
  lineNo: number,
  diagnostics: Diagnostic[],
) {
  const note = ctx.note;
  const key = name === "alternative" ? "alt" : name;

  if (SCALAR_FIELDS.has(key)) {
    if (key === "why") note.why = value;
    else if (key === "what") note.what = value;
    else note.impact = value;
    ctx.lastField = { name: key, index: 0 };
    return;
  }

  if (REPEATABLE.has(key)) {
    switch (key) {
      case "source":
        note.sources.push(parseSourceRef(value));
        ctx.lastField = { name: "source", index: note.sources.length - 1 };
        return;
      case "verify":
        note.verify.push(parseVerifyClaim(value));
        ctx.lastField = { name: "verify", index: note.verify.length - 1 };
        return;
      case "alt":
        note.alternatives.push(value);
        ctx.lastField = { name: "alt", index: note.alternatives.length - 1 };
        return;
      case "todo":
        note.todos.push(value);
        ctx.lastField = { name: "todo", index: note.todos.length - 1 };
        return;
      case "question":
        note.questions.push(value);
        ctx.lastField = { name: "question", index: note.questions.length - 1 };
        return;
      case "ref":
        note.refs.push(value);
        ctx.lastField = { name: "ref", index: note.refs.length - 1 };
        return;
    }
  }

  // Attributes are allowed as fields too, which is how models often write them.
  if (key === "kind" || key === "risk" || key === "confidence" || key === "id") {
    const num = Number(value.replace("%", ""));
    if (key === "kind" && NOTE_KINDS.includes(value as NoteKind)) {
      note.kind = value as NoteKind;
      ctx.lastField = null;
      return;
    }
    if (key === "risk" && ["low", "medium", "high"].includes(value)) {
      note.risk = value as Risk;
      ctx.lastField = null;
      return;
    }
    if (key === "confidence" && Number.isFinite(num)) {
      note.confidence = num > 1 ? num / 100 : num;
      ctx.lastField = null;
      return;
    }
    if (key === "id" && /^[\w.-]+$/.test(value)) {
      note.id = value;
      ctx.lastField = null;
      return;
    }
    // `risk: if the CDN rule is ever removed…` is prose, not a level. Keep the
    // text instead of dropping it on the floor.
    diagnostics.push({
      level: "warning",
      code: "attribute-as-prose",
      message: `\`${key}: ${truncate(value, 30)}\` is not a valid ${key} value, so it was kept as a plain field. Attribute values are fixed: kind, risk (low|medium|high), confidence (0..1), id.`,
      line: lineNo,
      file: note.file ?? undefined,
      noteId: note.id,
    });
  }

  note.extra[key] ??= [];
  note.extra[key].push(value);
  ctx.lastField = { name: `extra:${key}`, index: note.extra[key].length - 1 };
  if (!KNOWN_FIELDS.has(key)) {
    diagnostics.push({
      level: "info",
      code: "field-unknown",
      message: `Field \`${name}\` is outside the spec and was preserved as-is.`,
      line: lineNo,
      file: note.file ?? undefined,
      noteId: note.id,
    });
  }
}

function appendToField(ctx: NoteContext, text: string) {
  const note = ctx.note;
  const field = ctx.lastField;
  if (!field) return;
  const join = (existing: string | undefined) =>
    existing ? `${existing} ${text}` : text;

  if (field.name === "why") note.why = join(note.why);
  else if (field.name === "what") note.what = join(note.what);
  else if (field.name === "impact") note.impact = join(note.impact);
  else if (field.name === "source") {
    const ref = note.sources[field.index];
    ref.note = join(ref.note);
    ref.raw = `${ref.raw} ${text}`;
  } else if (field.name === "verify") {
    const claim = note.verify[field.index];
    claim.comment = join(claim.comment);
    claim.raw = `${claim.raw} ${text}`;
  } else if (field.name === "alt") {
    note.alternatives[field.index] = join(note.alternatives[field.index]);
  } else if (field.name === "todo") {
    note.todos[field.index] = join(note.todos[field.index]);
  } else if (field.name === "question") {
    note.questions[field.index] = join(note.questions[field.index]);
  } else if (field.name === "ref") {
    note.refs[field.index] = join(note.refs[field.index]);
  } else if (field.name.startsWith("extra:")) {
    const key = field.name.slice("extra:".length);
    note.extra[key][field.index] = join(note.extra[key][field.index]);
  }
}

function finishNote(ctx: NoteContext, diagnostics: Diagnostic[]) {
  ctx.note.body = ctx.bodyLines.join("\n").trim();
  if (
    !ctx.note.why &&
    !ctx.note.what &&
    !ctx.note.body &&
    !ctx.note.sources.length &&
    !ctx.note.verify.length &&
    !ctx.note.todos.length &&
    !ctx.note.questions.length
  ) {
    diagnostics.push({
      level: "warning",
      code: "note-empty",
      message: `Note \`${ctx.note.id}\` has no content.`,
      line: ctx.note.sourceLine,
      file: ctx.note.file ?? undefined,
      noteId: ctx.note.id,
    });
  }
}

/* ------------------------------------------------------------------ */
/* source / verify values                                              */
/* ------------------------------------------------------------------ */

const NOTE_SPLIT = /\s+(?:[—–]|--)\s+/;

export function parseSourceRef(raw: string): SourceRef {
  const value = raw.trim();
  let type: SourceType = "other";
  let body = value;

  const typed = /^([a-zA-Z]+)\s*:\s*(.*)$/.exec(value);
  if (typed && SOURCE_TYPES.includes(typed[1].toLowerCase() as SourceType)) {
    type = typed[1].toLowerCase() as SourceType;
    body = typed[2];
  } else if (/^https?:\/\//.test(value)) {
    type = "url";
  } else if (/^inference\b/i.test(value)) {
    type = "inference";
    body = value.replace(/^inference\b\s*[:—–-]*\s*/i, "");
  }

  let locator = body.trim();
  let note: string | undefined;
  const split = locator.split(NOTE_SPLIT);
  if (split.length > 1) {
    locator = split[0].trim();
    note = split.slice(1).join(" — ").trim();
  } else {
    const dash = / - (?=\S)/.exec(locator);
    if (dash && dash.index > 0 && !locator.startsWith("http")) {
      note = locator.slice(dash.index + 3).trim();
      locator = locator.slice(0, dash.index).trim();
    }
  }

  if (type === "inference" && !note && locator) {
    note = locator;
    locator = "";
  }

  return { type, locator, note: note || undefined, raw: value };
}

export function parseVerifyClaim(raw: string): VerifyClaim {
  const value = raw.trim();
  let rest = value;
  let method: VerifyMethod = "manual";

  const lead = /^([a-zA-Z]+)\s*[:\s]\s*/.exec(rest);
  const leadWord = lead?.[1]?.toLowerCase();
  if (leadWord && VERIFY_METHODS.includes(leadWord as VerifyMethod)) {
    method = leadWord as VerifyMethod;
    rest = rest.slice(lead![0].length);
  } else if (VERIFY_METHODS.includes(rest.toLowerCase() as VerifyMethod)) {
    method = rest.toLowerCase() as VerifyMethod;
    rest = "";
  } else if (/^`/.test(rest)) {
    method = "cmd";
  }

  let status: VerifyStatus | undefined;
  let comment: string | undefined;
  const arrow = rest.split(ARROW_RE);
  if (arrow.length > 1) {
    const tail = arrow[arrow.length - 1].trim();
    rest = arrow.slice(0, -1).join(" ").trim();
    const statusMatch = /^(pass|fail|unknown|skipped|ok|passed|failed)\b/i.exec(
      tail,
    );
    if (statusMatch) {
      status = normaliseStatus(statusMatch[1]);
      const after = tail.slice(statusMatch[0].length).trim();
      comment = stripParens(after) || undefined;
    } else {
      comment = tail || undefined;
    }
  } else {
    const trailing = /\((pass|fail|unknown|skipped)\)\s*$/i.exec(rest);
    if (trailing) {
      status = normaliseStatus(trailing[1]);
      rest = rest.slice(0, trailing.index).trim();
    }
  }

  let detail = rest.trim();
  const paren = /\(([^()]*)\)\s*$/.exec(detail);
  if (paren && !comment) {
    comment = paren[1].trim();
    detail = detail.slice(0, paren.index).trim();
  }
  detail = detail.replace(/^`+|`+$/g, "").replace(/^"|"$/g, "").trim();

  if (!status) status = method === "none" ? "unknown" : "unknown";

  return {
    method,
    detail: detail || undefined,
    status,
    comment,
    raw: value,
  };
}

function stripParens(text: string): string {
  const m = /^\((.*)\)$/.exec(text.trim());
  return (m ? m[1] : text).trim();
}

/* ------------------------------------------------------------------ */
/* selector checking                                                   */
/* ------------------------------------------------------------------ */

function validateSelectorAgainstFile(
  note: Note,
  file: FileSection,
  diagnostics: Diagnostic[],
) {
  const { selector } = note;
  if (selector.side === "file" || selector.side === "doc") return;
  if (!file.hunks.length) return;

  const present = new Set<number>();
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      const n = selector.side === "new" ? line.newLine : line.oldLine;
      if (n !== undefined) present.add(n);
    }
  }

  const missing: number[] = [];
  for (let n = selector.start; n <= selector.end; n++) {
    if (!present.has(n)) missing.push(n);
  }

  if (missing.length === selector.end - selector.start + 1) {
    diagnostics.push({
      level: "error",
      code: "selector-out-of-range",
      message: `Note \`${note.id}\` points at ${selector.raw} but no such line appears in the diff of ${file.path}. The annotation has drifted off its code.`,
      line: note.sourceLine,
      file: file.path,
      noteId: note.id,
    });
  } else if (missing.length) {
    diagnostics.push({
      level: "warning",
      code: "selector-partial",
      message: `Note \`${note.id}\` covers ${selector.raw}, but ${missing.length} line(s) in that range are outside the diff.`,
      line: note.sourceLine,
      file: file.path,
      noteId: note.id,
    });
  }
}

function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
