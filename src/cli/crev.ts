#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseCrev } from "../lib/crev/parse";
import { serializeCrev } from "../lib/crev/serialize";
import { buildSkeleton, isGitRepo, repoRoot, type StubMode } from "../lib/crev/git";
import { computeStats, percent } from "../lib/crev/stats";
import { validateDocument } from "../lib/crev/validate";
import { summariseResults, verifyDocument, type ClaimResult } from "../lib/crev/verify";
import type { Scope } from "../lib/crev/types";

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

interface Args {
  command: string;
  positionals: string[];
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const [command = "help", ...rest] = argv;
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq > 0) {
        flags.set(token.slice(2, eq), token.slice(eq + 1));
      } else {
        const next = rest[i + 1];
        if (isValue(next)) {
          flags.set(token.slice(2), next);
          i++;
        } else {
          flags.set(token.slice(2), true);
        }
      }
    } else if (token.startsWith("-") && token.length > 1) {
      const next = rest[i + 1];
      if (isValue(next)) {
        flags.set(token.slice(1), next);
        i++;
      } else {
        flags.set(token.slice(1), true);
      }
    } else {
      positionals.push(token);
    }
  }
  return { command, positionals, flags };
}

/** `-` is stdout, not another flag. */
function isValue(token: string | undefined): token is string {
  return token !== undefined && (token === "-" || !token.startsWith("-"));
}

const HELP = `${c.bold("crev")} — review AI-written code with evidence attached

${c.bold("USAGE")}
  crev new [scope]            build a .crev skeleton from a git diff
  crev prompt [scope]         print an authoring prompt with the diff embedded
  crev validate <file...>     check structure, staleness, coverage
  crev verify <file>          re-run every \`verify: cmd\` claim
  crev stats <file>           coverage and evidence metrics
  crev fmt <file>             rewrite in canonical form
  crev view                   how to open the visual reviewer

${c.bold("SCOPE")}  (default: --worktree, falling back to --staged)
  --unstaged                  git diff
  --staged                    git diff --cached
  --worktree                  git diff HEAD
  --branch [<base>]           git diff <base>...HEAD   (base defaults to origin/HEAD)
  --commit <rev>              git show <rev>

${c.bold("OPTIONS")}
  -o, --out <path>            output file (default reviews/<slug>.crev, - for stdout)
  --title <text>              review title
  --author <text>             e.g. "claude-opus-5 (cursor)"
  --stubs hunk|file|none      how many annotation stubs to pre-create (default hunk)
  --check <cmd>               record a command to verify (repeatable)
  --context <n>               diff context lines (default 3)
  --path <pathspec>           limit to a pathspec (repeatable)
  --no-untracked              skip files git does not track yet (included by default)
  --write                     for fmt/verify: write the file back
  --strict                    for validate: warnings fail too
  --min-coverage <0..1>       for validate: fail below this line coverage
  --filter <regex>            for verify: only run matching commands
  --json                      machine-readable output

${c.bold("EXAMPLES")}
  crev new --staged --author "claude-opus-5 (cursor)" -o reviews/auth.crev
  crev prompt --branch main | pbcopy
  crev validate reviews/*.crev --min-coverage 0.8
  crev verify reviews/auth.crev --write
`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
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
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return;
    case "version":
    case "--version":
      process.stdout.write(`crev ${pkgVersion()}\n`);
      return;
    default:
      fail(`Unknown command \`${args.command}\`. Run \`crev help\`.`);
  }
}

function scopeFrom(args: Args): { scope: Scope; base?: string; commit?: string } {
  if (args.flags.has("unstaged")) return { scope: "unstaged" };
  if (args.flags.has("staged") || args.flags.has("cached")) return { scope: "staged" };
  if (args.flags.has("worktree")) return { scope: "worktree" };
  if (args.flags.has("branch")) {
    const value = args.flags.get("branch");
    return { scope: "branch", base: typeof value === "string" ? value : undefined };
  }
  if (args.flags.has("commit")) {
    const value = args.flags.get("commit");
    return { scope: "commit", commit: typeof value === "string" ? value : "HEAD" };
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
  const stubs = (args.flags.get("stubs") as StubMode) ?? "hunk";
  const contextFlag = args.flags.get("context");
  const paths = collect(args, "path");
  const untracked = !args.flags.has("no-untracked");

  let result = buildSkeleton({
    scope,
    base,
    commit,
    cwd,
    paths,
    untracked,
    context: typeof contextFlag === "string" ? Number(contextFlag) : undefined,
    stubs,
    title: str(args.flags.get("title")),
    author: str(args.flags.get("author")) ?? process.env.CREV_AUTHOR,
    checks: collect(args, "check"),
  });

  // `--worktree` is the friendliest default, but an agent that has already
  // staged its work should not be told there is nothing to review.
  if (!result.diff.files.length && scope === "worktree" && !args.flags.has("worktree")) {
    result = buildSkeleton({
      scope: "staged",
      cwd,
      paths,
      untracked,
      stubs,
      title: str(args.flags.get("title")),
      author: str(args.flags.get("author")) ?? process.env.CREV_AUTHOR,
      checks: collect(args, "check"),
    });
  }

  return { ...result, cwd };
}

function cmdNew(args: Args) {
  const { doc, diff, cwd } = buildDoc(args);
  if (!diff.files.length) noChanges(doc.meta.scope);

  const text = serializeCrev(doc);
  const out = str(args.flags.get("out")) ?? str(args.flags.get("o"));

  if (out === "-") {
    process.stdout.write(text);
    return;
  }

  const target = out
    ? resolve(cwd, out)
    : resolve(cwd, "reviews", `${slug(doc.meta.title)}.crev`);
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
      `  crev validate ${rel}`,
      `  crev verify ${rel} --write`,
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
  const skeleton = serializeCrev(doc);
  const templatePath = join(cwd, "prompts", "crev-author.md");
  const template = existsSync(templatePath)
    ? stripPreamble(readFileSync(templatePath, "utf8"))
    : FALLBACK_PROMPT;
  process.stdout.write(
    template.replace("{{SKELETON}}", skeleton.trimEnd()).replace(
      "{{SPEC_PATH}}",
      existsSync(join(cwd, "spec/crev-v1.md")) ? "spec/crev-v1.md" : "the CREV v1 spec",
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

const FALLBACK_PROMPT = `Fill in this CREV review of your own changes. Replace every TODO.
For each annotation give: why the code is that way, a \`source:\` for the evidence
(use \`inference\` when there was none), and a \`verify:\` claim naming the exact
command you ran. Do not narrate what the code does. Keep the diff bytes untouched.

\`\`\`crev
{{SKELETON}}
\`\`\`
`;

function loadDoc(path: string) {
  if (!existsSync(path)) fail(`No such file: ${path}`);
  const text = readFileSync(path, "utf8");
  return parseCrev(text, { filename: path });
}

function cmdValidate(args: Args) {
  const paths = args.positionals;
  if (!paths.length) fail("Usage: crev validate <file...>");
  const cwd = repoRoot() || process.cwd();
  const minCoverage = args.flags.get("min-coverage");
  const json = args.flags.has("json");

  let worstExit = 0;
  const payload: unknown[] = [];

  for (const path of paths) {
    const doc = loadDoc(path);
    const result = validateDocument(doc, {
      cwd,
      strict: args.flags.has("strict"),
      skipStaleness: args.flags.has("no-staleness"),
      minCoverage: typeof minCoverage === "string" ? Number(minCoverage) : undefined,
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
      `${percent(stats.verifiedCoverage)} verified · ${stats.notes} notes · ` +
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
  if (!path) fail("Usage: crev verify <file> [--write]");
  const cwd = repoRoot() || process.cwd();
  const doc = loadDoc(path);
  const filter = str(args.flags.get("filter"));
  const json = args.flags.has("json");

  const results = verifyDocument(doc, {
    cwd,
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

  if (args.flags.has("write")) {
    writeFileSync(path, serializeCrev(doc));
    if (!json) process.stdout.write(`${c.green("✓")} updated ${path} with real results\n`);
  }

  process.exit(summary.contradicted > 0 ? 1 : 0);
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
  if (!path) fail("Usage: crev stats <file>");
  const doc = loadDoc(path);
  const stats = computeStats(doc);
  if (args.flags.has("json")) {
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
  if (!path) fail("Usage: crev fmt <file> [--write]");
  const doc = loadDoc(path);
  const text = serializeCrev(doc);
  if (args.flags.has("write")) {
    writeFileSync(path, text);
    process.stdout.write(`${c.green("✓")} formatted ${path}\n`);
  } else {
    process.stdout.write(text);
  }
}

function cmdView() {
  const port = process.env.PORT ?? "43917";
  process.stdout.write(
    [
      `${c.bold("crev viewer")}`,
      "",
      `  npm run dev            then open http://localhost:${port}`,
      `  reviews/*.crev         every file in this directory is listed automatically`,
      `  /inspect               paste a .crev file to render it without saving`,
      "",
    ].join("\n"),
  );
}

/* helpers */

function collect(args: Args, name: string): string[] {
  const value = args.flags.get(name);
  if (typeof value === "string") return [value];
  return [];
}

function str(value: string | true | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "review"
  );
}

function pkgVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot() || process.cwd(), "package.json"), "utf8"),
    );
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function fail(message: string): never {
  process.stderr.write(`${c.red("error")} ${message}\n`);
  process.exit(2);
}

main();
