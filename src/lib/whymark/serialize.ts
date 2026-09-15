import YAML from "yaml";
import {
  type Check,
  type WhymarkDocument,
  type FileSection,
  type Hunk,
  type Meta,
  type Note,
} from "./types";

export interface SerializeOptions {
  /** Soft wrap column for field values. 0 disables wrapping. */
  wrap?: number;
}

export function serializeWhymark(
  doc: WhymarkDocument,
  options: SerializeOptions = {},
): string {
  const wrap = options.wrap ?? 78;
  const out: string[] = [];

  out.push("---");
  out.push(serializeFrontmatter(doc.meta).trimEnd());
  out.push("---");
  out.push("");

  for (const note of doc.notes) {
    out.push(serializeNote(note, wrap));
    out.push("");
  }

  for (const file of doc.files) {
    out.push(serializeFileHeader(file));
    for (const hunk of file.hunks) {
      out.push(serializeHunk(hunk));
    }
    if (file.notes.length) out.push("");
    for (let i = 0; i < file.notes.length; i++) {
      out.push(serializeNote(file.notes[i], wrap));
      if (i < file.notes.length - 1) out.push("");
    }
    out.push("");
  }

  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

export function serializeFrontmatter(meta: Meta): string {
  const data: Record<string, unknown> = { whymark: meta.whymark, title: meta.title };
  if (meta.author) data.author = meta.author;
  if (meta.date) data.date = meta.date;
  if (meta.scope) data.scope = meta.scope;
  if (meta.base) data.base = meta.base;
  if (meta.head) data.head = meta.head;
  if (meta.repo) data.repo = meta.repo;
  if (meta.tags.length) data.tags = meta.tags;
  if (meta.summary) data.summary = ensureBlock(meta.summary);
  const fmChecks = meta.checks.filter((c) => !c.inline);
  if (fmChecks.length) data.checks = fmChecks.map(serializeCheck);
  if (meta.review) data.review = meta.review;
  for (const [key, value] of Object.entries(meta.extra)) data[key] = value;

  return YAML.stringify(data, {
    lineWidth: 78,
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
    blockQuote: "literal",
  });
}

function serializeCheck(check: Check): Record<string, unknown> {
  const out: Record<string, unknown> = { cmd: check.cmd, status: check.status };
  if (check.detail) out.detail = check.detail;
  if (check.ran) out.ran = check.ran;
  return out;
}

/** YAML emits a literal block for multi-line strings only if they end in \n. */
function ensureBlock(text: string): string {
  return text.includes("\n") ? `${text.trimEnd()}\n` : text;
}

export function serializeFileHeader(file: FileSection): string {
  const parts = ["@file", quoteIfNeeded(file.path), file.status];
  if (file.added) parts.push(`+${file.added}`);
  if (file.removed) parts.push(`-${file.removed}`);
  if (file.oldPath && file.oldPath !== file.path) {
    parts.push(`from=${quoteIfNeeded(file.oldPath)}`);
  }
  if (file.oldSha) parts.push(`oldsha=${file.oldSha}`);
  if (file.newSha) parts.push(`newsha=${file.newSha}`);
  if (file.lang) parts.push(`lang=${file.lang}`);
  if (file.binary) parts.push("binary");
  return parts.join(" ");
}

export function serializeHunk(hunk: Hunk): string {
  const header = `@@ -${hunk.oldStart},${countOld(hunk)} +${hunk.newStart},${countNew(
    hunk,
  )} @@${hunk.heading ? ` ${hunk.heading}` : ""}`;
  const body = hunk.lines.map((line) => {
    switch (line.type) {
      case "add":
        return `+${line.text}`;
      case "del":
        return `-${line.text}`;
      case "nonewline":
        return `\\ ${line.text}`;
      default:
        return ` ${line.text}`;
    }
  });
  return [header, ...body].join("\n");
}

function countOld(hunk: Hunk): number {
  return hunk.lines.filter((l) => l.type === "context" || l.type === "del").length;
}

function countNew(hunk: Hunk): number {
  return hunk.lines.filter((l) => l.type === "context" || l.type === "add").length;
}

export function serializeNote(note: Note, wrap = 78): string {
  const head = ["@note", note.selector.raw];
  if (note.kind !== "note") head.push(`kind=${note.kind}`);
  if (note.risk) head.push(`risk=${note.risk}`);
  if (note.confidence !== undefined) {
    head.push(`confidence=${round(note.confidence)}`);
  }
  if (!/^n\d+$/.test(note.id)) head.push(`id=${note.id}`);

  const lines = [head.join(" ")];
  const field = (name: string, value: string) =>
    lines.push(...wrapField(name, value, wrap));

  if (note.why) field("why", note.why);
  if (note.what) field("what", note.what);
  for (const source of note.sources) field("source", source.raw);
  for (const claim of note.verify) field("verify", claim.raw);
  for (const alt of note.alternatives) field("alt", alt);
  if (note.impact) field("impact", note.impact);
  for (const ref of note.refs) field("ref", ref);
  for (const todo of note.todos) field("todo", todo);
  for (const question of note.questions) field("question", question);
  for (const [key, values] of Object.entries(note.extra)) {
    for (const value of values) field(key, value);
  }

  if (note.body) {
    lines.push("");
    lines.push(note.body.trimEnd());
  }

  return lines.join("\n");
}

/**
 * Wraps a field value at `wrap` columns, continuing on lines indented by two
 * spaces. Backtick and quote spans are never broken, so a command stays
 * re-runnable, and a line only breaks where whitespace already was.
 */
function wrapField(name: string, value: string, wrap: number): string[] {
  const first = `${name}: ${value}`;
  if (!wrap || first.length <= wrap) return [first];

  const pieces = splitPreservingSpans(value);
  const out: string[] = [];
  let current = `${name}:`;
  let breakable = false;

  for (const piece of pieces) {
    const candidate = `${current}${piece.space ? " " : ""}${piece.text}`;
    if (candidate.length > wrap && piece.space && breakable) {
      out.push(current);
      current = `  ${piece.text}`;
    } else {
      current = candidate;
    }
    breakable = true;
  }
  if (current.trim()) out.push(current);
  return out;
}

interface Piece {
  text: string;
  /** Whether whitespace separated this piece from the previous one. */
  space: boolean;
}

function splitPreservingSpans(value: string): Piece[] {
  const re = /`[^`]*`|"[^"]*"|[^\s`"]+|\s+/g;
  const pieces: Piece[] = [];
  let space = false;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    if (/^\s+$/.test(match[0])) {
      space = true;
      continue;
    }
    pieces.push({ text: match[0], space });
    space = false;
  }
  // The first piece always follows `name:`, which needs its space.
  if (pieces.length) pieces[0].space = true;
  return pieces;
}

function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}
