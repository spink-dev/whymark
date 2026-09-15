const BY_EXTENSION: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  mts: "ts",
  cts: "ts",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  json: "json",
  jsonc: "json",
  md: "md",
  mdx: "mdx",
  css: "css",
  scss: "scss",
  html: "html",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  xml: "xml",
  svg: "xml",
  graphql: "graphql",
  gql: "graphql",
  prisma: "prisma",
  dockerfile: "docker",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  lua: "lua",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  scala: "scala",
  dart: "dart",
  zig: "zig",
  whymark: "yaml",
};

const BY_FILENAME: Record<string, string> = {
  dockerfile: "docker",
  makefile: "make",
  ".gitignore": "ini",
  ".env": "ini",
  "package.json": "json",
};

export function languageFor(path: string, override?: string): string {
  if (override) return override;
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  if (BY_FILENAME[name]) return BY_FILENAME[name];
  const ext = name.includes(".") ? name.split(".").pop()! : name;
  return BY_EXTENSION[ext] ?? "text";
}

export const SUPPORTED_LANGUAGES = Array.from(
  new Set([...Object.values(BY_EXTENSION), ...Object.values(BY_FILENAME), "text"]),
);
