import {
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
  type ThemedToken,
} from "shiki";
import { languageFor } from "@/lib/crev/lang";
import type { FileSection } from "@/lib/crev/types";

/** A syntax-highlighted span, trimmed to what the client actually needs. */
export interface Token {
  text: string;
  color?: string;
  /** Shiki font style bitmask: 1 italic, 2 bold, 4 underline. */
  style?: number;
}

const THEME = "vesper";

const LANGS: BundledLanguage[] = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "md",
  "css",
  "html",
  "python",
  "rust",
  "go",
  "java",
  "ruby",
  "bash",
  "sql",
  "yaml",
  "toml",
  "ini",
  "xml",
  "diff",
  "c",
  "cpp",
  "csharp",
  "php",
  "graphql",
  "docker",
  "lua",
  "swift",
  "kotlin",
  "scala",
  "dart",
  "elixir",
  "haskell",
  "vue",
  "svelte",
  "astro",
  "prisma",
  "make",
  "scss",
  "mdx",
  "zig",
  "erlang",
];

let instance: Promise<Highlighter> | null = null;

function highlighter(): Promise<Highlighter> {
  instance ??= createHighlighter({ themes: [THEME], langs: LANGS });
  return instance;
}

function supported(lang: string): BundledLanguage | "text" {
  return (LANGS as string[]).includes(lang) ? (lang as BundledLanguage) : "text";
}

function toTokens(line: ThemedToken[]): Token[] {
  return line.map((token) => ({
    text: token.content,
    color: token.color,
    style: token.fontStyle && token.fontStyle > 0 ? token.fontStyle : undefined,
  }));
}

/**
 * Highlights each hunk as one block so that multi-line constructs (template
 * literals, block comments) colour correctly, then hands back one token list
 * per diff line.
 */
export async function highlightFile(file: FileSection): Promise<Token[][][]> {
  const lang = supported(languageFor(file.path, file.lang));
  if (lang === "text") {
    return file.hunks.map((hunk) => hunk.lines.map((line) => [{ text: line.text }]));
  }

  const shiki = await highlighter();
  return file.hunks.map((hunk) => {
    const code = hunk.lines.map((line) => line.text).join("\n");
    try {
      const { tokens } = shiki.codeToTokens(code, { lang, theme: THEME });
      return hunk.lines.map((line, index) =>
        tokens[index] ? toTokens(tokens[index]) : [{ text: line.text }],
      );
    } catch {
      return hunk.lines.map((line) => [{ text: line.text }]);
    }
  });
}

export async function highlightCode(code: string, lang: string): Promise<Token[][]> {
  const resolved = supported(lang);
  if (resolved === "text") return code.split("\n").map((line) => [{ text: line }]);
  const shiki = await highlighter();
  const { tokens } = shiki.codeToTokens(code, { lang: resolved, theme: THEME });
  return tokens.map(toTokens);
}
