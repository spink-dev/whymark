#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWhymark } from "../lib/whymark/parse";
import { serializeWhymark } from "../lib/whymark/serialize";
import { buildSkeleton, isGitRepo, repoRoot, type StubMode } from "../lib/whymark/git";
import { computeStats, percent } from "../lib/whymark/stats";
import { validateDocument } from "../lib/whymark/validate";
import { validateDocumentInRepo } from "../lib/whymark/validate-tree";
import { summariseResults, verifyDocument, type ClaimResult } from "../lib/whymark/verify";
import type { Scope } from "../lib/whymark/types";
import { qualityCommand } from "./quality";
import { installSkill } from "../lib/skill/install";
import { renderHelp } from "./help";

const c = colors();

function colors() {
  const on = process.stdout.isTTY && !process.env.NO_COLOR;
  const wrap = (code: string) => (text: string) =>
    on ? `\u001b[${code}m${text}\u001b[0m` : text;
  return {
    bold: wrap("1"),
    dim: wrap("2"),
    red: wrap("31"),
    green: wrap("32"),
    yellow: wrap("33"),
    blue: wrap("34"),
    magenta: wrap("35"),
    cyan: wrap("36"),
    gray: wrap("90"),
  };
}

/** Flags may repeat (`--path a --path b`), so every value is kept. */
class Args {
  constructor(
    readonly command: string,
    readonly positionals: string[],
    private readonly flags: Map<string, Array<string | true>>,
  ) {}

  has(...names: string[]): boolean {
    return names.some((name) => this.flags.has(name));
  }

  /** Last value given, or undefined for a boolean or absent flag. */
  str(...names: string[]): string | undefined {
    for (const name of names) {
      const values = this.flags.get(name);
      const last = values?.[values.length - 1];
      if (typeof last === "string") return last;
    }
    return undefined;
  }

  all(name: string): string[] {
    return (this.flags.get(name) ?? []).filter(
      (value): value is string => typeof value === "string",
    );
  }
}

function parseArgs(argv: string[]): Args {
  const [command = "help", ...rest] = argv;
  const positionals: string[] = [];
  const flags = new Map<string, Array<string | true>>();
  const add = (name: string, value: string | true) => {
    const existing = flags.get(name);
    if (existing) existing.push(value);
    else flags.set(name, [value]);
  };

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    const dashes = token.startsWith("--") ? 2 : token.startsWith("-") && token.length > 1 ? 1 : 0;
    if (!dashes) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    if (dashes === 2 && eq > 0) {
      add(token.slice(2, eq), token.slice(eq + 1));
      continue;
    }
    const name = token.slice(dashes);
    const next = rest[i + 1];
    if (isValue(next)) {
      add(name, next);
      i++;
    } else {
      add(name, true);
    }
  }

  return new Args(command, positionals, flags);
}

/** `-` is stdout, not another flag. */
function isValue(token: string | undefined): token is string {
  return token !== undefined && (token === "-" || !token.startsWith("-"));
}

function isHelpToken(token: string): boolean {
  return token === "help" || token === "--help" || token === "-h";
}

function cmdHelp(topic?: string) {
  const page = renderHelp(topic, c);
  if (!page.ok) fail(page.message);
  process.stdout.write(page.text.endsWith("\n") ? page.text : `${page.text}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (isHelpToken(args.command) || args.has("help", "h")) {
    return cmdHelp(isHelpToken(args.command) ? args.positionals[0] : args.command);
  }
  switch (args.command) {
    case "quality":
      return qualityCommand(args.positionals, { run: args.has("run"), watch: args.has("watch"), write: args.has("write"), config: args.str("config"), baseline: args.str("baseline"), importPath: args.str("import"), toolVersion: args.str("tool-version") }).catch(error => fail((error as Error).message));
    case "skill": {
      if (args.positionals[0] !== "install") fail("Usage: npx whymark skill install [--agent codex|claude-code] [--global] [--dry-run] [--force]");
      try {
        const result = installSkill({ packageRoot: packageRoot(), cwd: process.cwd(), agents: args.all("agent"), global: args.has("global"), dryRun: args.has("dry-run"), force: args.has("force") });
        for (const item of result) process.stdout.write(`${item.action} ${item.path}\n`);
      } catch (error) { fail((error as Error).message); }
      return;
    }
    case "new":
    case "init":
      return cmdNew(args);
    case "prompt":
      return cmdPrompt(args);
    case "validate":
    case "check":
      return cmdValidate(args);
    case "verify":
      return cmdVerify(args);
    case "stats":
      return cmdStats(args);
    case "fmt":
    case "format":
      return cmdFmt(args);
    case "view":
    case "open":
      return cmdView();
    case "version":
    case "--version":
      process.stdout.write(`whymark ${pkgVersion()}\n`);
      return;
    default:
      fail(`Unknown command \`${args.command}\`. Run \`npx whymark help\`.`);
  }
}

function scopeFrom(args: Args): { scope: Scope; base?: string; commit?: string } {
  if (args.has("unstaged")) return { scope: "unstaged" };
  if (args.has("staged", "cached")) return { scope: "staged" };
  if (args.has("worktree")) return { scope: "worktree" };
  if (args.has("branch")) {
    return { scope: "branch", base: args.str("branch") };
  }
  if (args.has("commit")) {
    return { scope: "commit", commit: args.str("commit") ?? "HEAD" };
  }
  const positional = args.positionals[0];
  if (positional && ["staged", "unstaged", "worktree", "branch"].includes(positional)) {
    return { scope: positional as Scope };
  }
  return { scope: "worktree" };
}

function buildDoc(args: Args) {
  const cwd = repoRoot() || process.cwd();
  if (!isGitRepo(cwd)) fail("Not a git repository.");

  const { scope, base, commit } = scopeFrom(args);
  const stubs = (args.str("stubs") as StubMode) ?? "hunk";
  const contextFlag = args.str("context");
  const paths = args.all("path");
  const untracked = !args.has("no-untracked");

  let result = buildSkeleton({
    scope,
    base,
    commit,
    cwd,
    paths,
    untracked,
    context: contextFlag ? Number(contextFlag) : undefined,
    stubs,
    title: args.str("title"),
    author: args.str("author") ?? process.env.WHYMARK_AUTHOR,
    checks: args.all("check"),
  });

  // `--worktree` is the friendliest default, but an agent that has already
  // staged its work should not be told there is nothing to review.
  if (!result.diff.files.length && scope === "worktree" && !args.has("worktree")) {
    result = buildSkeleton({
      scope: "staged",
      cwd,
      paths,
      untracked,
      stubs,
      title: args.str("title"),
      author: args.str("author") ?? process.env.WHYMARK_AUTHOR,
      checks: args.all("check"),
    });
  }

  return { ...result, cwd };
}

function cmdNew(args: Args) {
  const { doc, diff, cwd } = buildDoc(args);
  if (!diff.files.length) noChanges(doc.meta.scope);

  const text = serializeWhymark(doc);
  const out = args.str("out", "o");

  if (out === "-") {
    process.stdout.write(text);
    return;
  }

  const target = out
    ? resolve(cwd, out)
    : resolve(cwd, "reviews", `${slug(doc.meta.title)}.whymark`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);

  const stats = computeStats(doc);
  const rel = relative(cwd, target) || target;
  process.stdout.write(
    [
      `${c.green("✓")} wrote ${c.bold(rel)}`,
      `  ${diff.files.length} file(s), ${c.green(`+${stats.added}`)} ${c.red(
        `-${stats.removed}`,
      )}, ${stats.notes} annotation stub(s)`,
      "",
      `${c.bold("Next:")} fill in every ${c.cyan("why")}, ${c.cyan("source")} and ${c.cyan(
        "verify",
      )} field, then:`,
      `  npx whymark validate ${rel}`,
      `  npx whymark verify ${rel} --write`,
      "",
    ].join("\n"),
  );
}

function noChanges(scope: Scope | undefined): never {
  const others = ["--staged", "--unstaged", "--branch main", "--commit HEAD"].filter(
    (flag) => !flag.includes(String(scope)),
  );
  fail(
    `No changes in scope \`${scope}\`${
      "" // keep the hint on one line
    }. Nothing to review — try ${others.slice(0, 3).join(", ")}, or pass --path.`,
  );
}

function cmdPrompt(args: Args) {
  const { doc, diff, cwd } = buildDoc(args);
  if (!diff.files.length) noChanges(doc.meta.scope);
  const skeleton = serializeWhymark(doc);
  const pack = packageRoot();
  const templatePath = [join(cwd, "prompts", "whymark-author.md"), join(pack, "prompts", "whymark-author.md")].find(
    existsSync,
  );
  const template = templatePath
    ? stripPreamble(readFileSync(templatePath, "utf8"))
    : FALLBACK_PROMPT;
  const specInRepo = existsSync(join(cwd, "spec/whymark-v1.md"));
  process.stdout.write(
    template.replace("{{SKELETON}}", skeleton.trimEnd()).replace(
      "{{SPEC_PATH}}",
      specInRepo ? "spec/whymark-v1.md" : join(pack, "spec/whymark-v1.md"),
    ),
  );
}

/** The template file explains itself to a human above the first `---`; the
 *  agent only needs what comes after it. */
function stripPreamble(template: string): string {
  const lines = template.split("\n");
  const separator = lines.findIndex((line) => line.trim() === "---");
  return separator === -1 ? template : lines.slice(separator + 1).join("\n").trimStart();
}

const FALLBACK_PROMPT = `Fill in this whymark review of your own changes. Replace every TODO.
For each annotation give: why the code is that way, a \`source:\` for the evidence
(use \`inference\` when there was none), and a \`verify:\` claim naming the exact
command you ran. Do not narrate what the code does. Keep the diff bytes untouched.

\`\`\`whymark
{{SKELETON}}
\`\`\`
`;

function loadDoc(path: string) {
  if (!existsSync(path)) fail(`No such file: ${path}`);
  const text = readFileSync(path, "utf8");
  return parseWhymark(text, { filename: path });
}

function cmdValidate(args: Args) {
  const paths = args.positionals;
  if (!paths.length) fail("Usage: npx whymark validate <file...>");
  const cwd = repoRoot() || process.cwd();
  const minCoverage = args.str("min-coverage");
  const json = args.has("json");

  let worstExit = 0;
  const payload: unknown[] = [];

  for (const path of paths) {
    const doc = loadDoc(path);
    const result = validateDocumentInRepo(doc, {
      cwd,
      strict: args.has("strict"),
      skipStaleness: args.has("no-staleness"),
      minCoverage: minCoverage ? Number(minCoverage) : undefined,
    });

    if (json) {
      payload.push({ path, ...result });
    } else {
      printValidation(path, result);
    }
    if (!result.ok) worstExit = 1;
  }

  if (json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(worstExit);
}

function printValidation(
  path: string,
  result: ReturnType<typeof validateDocument>,
) {
  const { stats } = result;
  process.stdout.write(`${c.bold(path)}\n`);
  for (const level of ["error", "warning", "info"] as const) {
    for (const d of result.diagnostics.filter((x) => x.level === level)) {
      const tag =
        level === "error" ? c.red("error") : level === "warning" ? c.yellow("warn ") : c.gray("info ");
      const where = [d.file, d.line ? `:${d.line}` : ""].filter(Boolean).join("");
      process.stdout.write(
        `  ${tag} ${c.gray(d.code.padEnd(24))} ${d.message}${
          where ? ` ${c.gray(`(${where})`)}` : ""
        }\n`,
      );
    }
  }
  process.stdout.write(
    `  ${bar(stats.coverage)} ${c.bold(percent(stats.coverage))} of ${stats.added} added lines annotated · ` +
      `${percent(stats.verifiedCoverage)} claimed verified · ${stats.notes} notes · ` +
      `${stats.sourced} sourced / ${stats.inferenceOnly} inference-only\n`,
  );
  const verdict = result.ok
    ? c.green("passes")
    : `${c.red("fails")} (${result.errors} error(s), ${result.warnings} warning(s))`;
  process.stdout.write(`  ${verdict}\n\n`);
}

function bar(fraction: number, width = 16): string {
  const filled = Math.round(fraction * width);
  const glyph = "█".repeat(filled) + "░".repeat(width - filled);
  if (fraction >= 0.8) return c.green(glyph);
  if (fraction >= 0.5) return c.yellow(glyph);
  return c.red(glyph);
}

function cmdVerify(args: Args) {
  const path = args.positionals[0];
  if (!path) fail("Usage: npx whymark verify <file> [--write]");
  const cwd = repoRoot() || process.cwd();
  const doc = loadDoc(path);
  const filter = args.str("filter");
  const json = args.has("json");

  const results = verifyDocument(doc, {
    cwd,
    recordEvidence: args.has("write"),
    toolVersion: pkgVersion(),
    filter: filter ? new RegExp(filter) : undefined,
    onStart: (cmd) => {
      if (!json) process.stdout.write(`${c.gray("→ running")} ${cmd}\n`);
    },
    onFinish: (result) => {
      if (json) return;
      process.stdout.write(`  ${outcomeLabel(result)}\n`);
    },
  });

  const summary = summariseResults(results);
  if (json) {
    process.stdout.write(`${JSON.stringify({ path, summary, results }, null, 2)}\n`);
  } else {
    process.stdout.write(
      `\n${c.bold("verified")} ${summary.total} claim(s): ` +
        `${c.green(`${summary.confirmed} confirmed`)}, ` +
        `${summary.contradicted ? c.red(`${summary.contradicted} contradicted`) : "0 contradicted"}, ` +
        `${summary.unrunnable} unrunnable, ${summary.recorded} newly recorded\n`,
    );
  }

  if (args.has("write")) {
    writeFileSync(path, serializeWhymark(doc));
    if (!json) process.stdout.write(`${c.green("✓")} updated ${path} with real results\n`);
  }

  process.exit(summary.contradicted > 0 || summary.unrunnable > 0 || results.some(result => result.run?.status === "fail") ? 1 : 0);
}

function outcomeLabel(result: ClaimResult): string {
  const where = result.noteId ? c.gray(` [${result.noteId}]`) : c.gray(" [check]");
  switch (result.outcome) {
    case "confirmed":
      return `${c.green("confirmed")} ${result.cmd}${where}`;
    case "contradicted":
      return `${c.red("CONTRADICTED")} ${result.cmd} — claimed ${result.claimed}, got ${
        result.run?.status
      }${where}\n    ${c.gray(result.run?.output.split("\n").slice(-3).join("\n    ") ?? "")}`;
    case "unrunnable":
      return `${c.yellow("unrunnable")} ${result.cmd || "(no command)"}${where} — ${result.reason ?? ""}`;
    default:
      return `${c.blue("recorded")} ${result.cmd} → ${result.run?.status}${where}`;
  }
}

function cmdStats(args: Args) {
  const path = args.positionals[0];
  if (!path) fail("Usage: npx whymark stats <file>");
  const doc = loadDoc(path);
  const stats = computeStats(doc);
  if (args.has("json")) {
    process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${c.bold(doc.meta.title)}\n`);
  process.stdout.write(
    `${c.gray(
      `${doc.meta.scope ?? "manual"} · ${doc.meta.author ?? "unknown author"} · ${
        doc.meta.date ?? "no date"
      }`,
    )}\n\n`,
  );
  process.stdout.write(
    `  coverage        ${bar(stats.coverage)} ${percent(stats.coverage)} (${stats.covered}/${stats.added} added lines)\n`,
  );
  process.stdout.write(
    `  verified        ${bar(stats.verifiedCoverage)} ${percent(stats.verifiedCoverage)}\n`,
  );
  process.stdout.write(
    `  evidence        ${stats.sourced} sourced · ${stats.inferenceOnly} inference-only · ${stats.stubs} stub(s)\n`,
  );
  process.stdout.write(
    `  risk            ${stats.byRisk.high} high · ${stats.byRisk.medium} medium · ${stats.byRisk.low} low` +
      (stats.unverifiedHighRisk
        ? c.red(`  (${stats.unverifiedHighRisk} high-risk unverified)`)
        : "") +
      "\n",
  );
  process.stdout.write(
    `  open items      ${stats.openTodos} todo · ${stats.openQuestions} question(s)\n`,
  );
  process.stdout.write(
    `  checks          ${stats.checks.pass} pass · ${stats.checks.fail} fail · ${stats.checks.unknown} unrun\n\n`,
  );

  for (const file of stats.perFile) {
    process.stdout.write(
      `  ${bar(file.coverage, 10)} ${percent(file.coverage).padStart(4)} ${c.bold(
        file.path,
      )} ${c.gray(`+${file.added} -${file.removed} · ${file.notes} note(s)`)}\n`,
    );
  }
  process.stdout.write("\n");
}

function cmdFmt(args: Args) {
  const path = args.positionals[0];
  if (!path) fail("Usage: npx whymark fmt <file> [--write]");
  const doc = loadDoc(path);
  const text = serializeWhymark(doc);
  if (args.has("write")) {
    writeFileSync(path, text);
    process.stdout.write(`${c.green("✓")} formatted ${path}\n`);
  } else {
    process.stdout.write(text);
  }
}

function cmdView() {
  cmdHelp("view");
}

/* helpers */

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "review"
  );
}

/** Directory of this published package, not the caller's git repo. */
function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const dir of [join(here, ".."), join(here, "../..")]) {
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    try {
      if (JSON.parse(readFileSync(pkgPath, "utf8")).name === "whymark") return dir;
    } catch {
      // keep walking
    }
  }
  return join(here, "../..");
}

function pkgVersion(): string {
  try {
    return JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function fail(message: string): never {
  process.stderr.write(`${c.red("error")} ${message}\n`);
  process.exit(2);
}

main();
