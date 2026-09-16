/** Colour wrappers from the CLI. Identity functions are fine for tests. */
export type Palette = {
  bold: (text: string) => string;
  dim: (text: string) => string;
  cyan: (text: string) => string;
  gray: (text: string) => string;
};

const TOPICS: Record<string, { aliases: string[]; render: (c: Palette) => string }> = {
  new: { aliases: ["init"], render: helpNew },
  prompt: { aliases: [], render: helpPrompt },
  validate: { aliases: ["check"], render: helpValidate },
  verify: { aliases: [], render: helpVerify },
  stats: { aliases: [], render: helpStats },
  fmt: { aliases: ["format"], render: helpFmt },
  view: { aliases: ["open"], render: helpView },
  help: { aliases: [], render: helpHelp },
  version: { aliases: [], render: helpVersion },
  annotate: { aliases: ["annotating", "fields", "note", "notes"], render: helpAnnotate },
};

function canonicalTopic(raw: string): string | undefined {
  const key = raw.replace(/^-+/, "").toLowerCase();
  if (key in TOPICS) return key;
  for (const [name, topic] of Object.entries(TOPICS)) {
    if (topic.aliases.includes(key)) return name;
  }
  return undefined;
}

export function renderHelp(
  topic: string | undefined,
  c: Palette,
): { ok: true; text: string } | { ok: false; message: string } {
  if (!topic) return { ok: true, text: overview(c) };
  const name = canonicalTopic(topic);
  if (!name) {
    return {
      ok: false,
      message: `Unknown help topic \`${topic}\`. Run \`npx whymark help\` to list commands.`,
    };
  }
  return { ok: true, text: TOPICS[name].render(c) };
}

function overview(c: Palette): string {
  return `${c.bold("whymark")} — review AI-written code with evidence attached

A .whymark file is a git diff with line-addressed annotations. The diff shows
what changed; the annotations say why, what evidence backs it, and how it was
checked. Run from any git repo — no install:

  ${c.cyan("npx whymark")} <command> [options]
  ${c.cyan("npx whymark help")} [command]

${c.bold("WORKFLOW")}
  1.  npx whymark new --staged --author "<model>"
      writes reviews/<slug>.whymark from the git diff, one stub per hunk
  2.  Fill summary and every why / source / verify field. Delete empty stubs.
  3.  npx whymark validate reviews/<slug>.whymark
  4.  npx whymark verify   reviews/<slug>.whymark --write
  5.  open https://whymark.x47.dev     drop the file; it stays in the browser

${c.bold("COMMANDS")}
  new          skeleton from a git diff                 ${c.gray("alias: init")}
  prompt       authoring prompt with the diff embedded
  validate     structure, staleness, coverage           ${c.gray("alias: check")}
  verify       re-run every ${c.cyan("verify: cmd")} claim
  stats        coverage and evidence metrics
  fmt          rewrite in canonical form                ${c.gray("alias: format")}
  view         how to open the visual reviewer          ${c.gray("alias: open")}
  help         this page, or details for a command
  version      print the version

  npx whymark help <command>     options and examples
  npx whymark help annotate      how to write why / source / verify

${c.bold("THE THREE FIELDS")}
  ${c.cyan("why:")}     the reason the code is that way — never what it does
  ${c.cyan("source:")}  cite only files, docs, or prompts you actually read
            if there was none:  source: inference — <what you generalised from>
  ${c.cyan("verify:")}  claim pass only for a command you ran; ${c.cyan("npx whymark verify")} re-runs it

${c.bold("SCOPE")}  ${c.gray("(new / prompt; default --worktree, falling back to --staged)")}
  --unstaged              git diff
  --staged                git diff --cached
  --worktree              git diff HEAD   ${c.gray("(includes untracked files)")}
  --branch [<base>]       git diff <base>...HEAD   ${c.gray("(base: origin/HEAD)")}
  --commit <rev>          git show <rev>

${c.bold("EXAMPLES")}
  npx whymark new --staged --author "claude-opus-5 (cursor)"
  npx whymark prompt --branch main | pbcopy
  npx whymark validate reviews/*.whymark --min-coverage 0.8
  npx whymark verify reviews/auth.whymark --write

${c.bold("ENV")}
  WHYMARK_AUTHOR     default for --author
  PORT               viewer port ${c.gray("(default 43917)")}
  NO_COLOR           disable ANSI colour
`;
}

function helpNew(c: Palette): string {
  return `${c.bold("npx whymark new")} — build a .whymark skeleton from a git diff

${c.bold("USAGE")}
  npx whymark new [scope] [options]
  alias: init

Writes reviews/<slug>.whymark containing the real unified diff plus annotation
stubs. Fill the stubs; do not edit the diff body. If the code is wrong, change
the code and regenerate.

${c.bold("SCOPE")}  ${c.gray("(default: --worktree, then --staged if that is empty)")}
  --unstaged              git diff
  --staged, --cached      git diff --cached
  --worktree              git diff HEAD   ${c.gray("(includes untracked files)")}
  --branch [<base>]       git diff <base>...HEAD   ${c.gray("(base: origin/HEAD)")}
  --commit <rev>          git show <rev>
  unstaged|staged|worktree|branch
                          same, as a positional

${c.bold("OPTIONS")}
  -o, --out <path>        output file ${c.gray("(default reviews/<slug>.whymark, - for stdout)")}
  --title <text>          review title
  --author <text>         e.g. "claude-opus-5 (cursor)"  ${c.gray("(or $WHYMARK_AUTHOR)")}
  --stubs hunk|file|none  how many annotation stubs to pre-create ${c.gray("(default hunk)")}
  --check <cmd>           record a whole-change command to verify ${c.gray("(repeatable)")}
  --context <n>           diff context lines ${c.gray("(default 3)")}
  --path <pathspec>       limit to a pathspec ${c.gray("(repeatable)")}
  --no-untracked          skip files git does not track yet ${c.gray("(included by default)")}

${c.bold("EXAMPLES")}
  npx whymark new --staged --author "claude-opus-5 (cursor)"
  npx whymark new --branch main --path src/lib -o reviews/lib.whymark
  npx whymark new --commit HEAD --stubs none -o -

${c.bold("NEXT")}
  Fill every why / source / verify field, then:
    npx whymark validate reviews/<slug>.whymark
    npx whymark verify   reviews/<slug>.whymark --write
  See ${c.cyan("npx whymark help annotate")} for how to write those fields.
`;
}

function helpPrompt(c: Palette): string {
  return `${c.bold("npx whymark prompt")} — print an authoring prompt with the diff embedded

${c.bold("USAGE")}
  npx whymark prompt [scope] [options]

Prints a filled-in prompt (skeleton + rules) for any coding agent that does not
read the skill files. Pipe it into the clipboard or a chat.

Accepts the same ${c.bold("SCOPE")} and generation flags as ${c.cyan("new")}
(--staged, --unstaged, --worktree, --branch, --commit, --path, --stubs,
--context, --no-untracked, --title, --author, --check).

Looks for prompts/whymark-author.md in the current repo first, then the copy
shipped with this package.

${c.bold("EXAMPLES")}
  npx whymark prompt --staged | pbcopy
  npx whymark prompt --branch main > /tmp/whymark-prompt.md
`;
}

function helpValidate(c: Palette): string {
  return `${c.bold("npx whymark validate")} — check structure, selectors, staleness, coverage

${c.bold("USAGE")}
  npx whymark validate <file...> [options]
  alias: check

Reports:
  • the file parses as whymark v1
  • every annotation selector points at a real line in the diff
  • leftover TODO stubs and a missing summary
  • file newsha still matches the working tree ${c.gray("(review has not gone stale)")}
  • optional coverage floor over added lines

Exit 0 when every file passes, 1 when any fails.

${c.bold("OPTIONS")}
  --strict                warnings fail too
  --min-coverage <0..1>   fail when annotated added-line coverage is below this
  --no-staleness          skip working-tree hash comparison
  --json                  machine-readable diagnostics

${c.bold("EXAMPLES")}
  npx whymark validate reviews/auth.whymark
  npx whymark validate reviews/*.whymark --min-coverage 0.8 --strict
`;
}

function helpVerify(c: Palette): string {
  return `${c.bold("npx whymark verify")} — re-run every ${c.cyan("verify: cmd")} claim

${c.bold("USAGE")}
  npx whymark verify <file> [options]

Re-runs each command named in a ${c.cyan("verify: cmd `...`")} annotation and in
frontmatter ${c.cyan("checks:")}. Compares the exit code to the claimed status.

${c.bold("OUTCOMES")}
  confirmed      claimed pass/fail and the command agreed
  contradicted   claimed one status, got the other ${c.gray("(exit 1)")}
  unrunnable     no command, or it could not be executed
  recorded       no status was claimed; the real result is now known

A false ${c.cyan("pass")} is worse than ${c.cyan("none")} — this command will catch it.

${c.bold("OPTIONS")}
  --write                 rewrite the file with real statuses, detail, and ran:
  --filter <regex>        only run matching commands
  --json                  machine-readable results

${c.bold("EXAMPLES")}
  npx whymark verify reviews/auth.whymark --write
  npx whymark verify reviews/auth.whymark --filter "npm test"
`;
}

function helpStats(c: Palette): string {
  return `${c.bold("npx whymark stats")} — coverage and evidence metrics

${c.bold("USAGE")}
  npx whymark stats <file> [--json]

Prints line coverage, verified share, sourced vs inference-only counts, risk,
open questions, and per-file breakdown. Coverage is over ${c.bold("added")} lines only.

${c.bold("EXAMPLES")}
  npx whymark stats reviews/auth.whymark
  npx whymark stats reviews/auth.whymark --json
`;
}

function helpFmt(c: Palette): string {
  return `${c.bold("npx whymark fmt")} — rewrite a file in canonical form

${c.bold("USAGE")}
  npx whymark fmt <file> [--write]
  alias: format

Parses and re-serialises the document. Without --write, prints to stdout.
Does not change meaning; use it to normalise spacing and field order.

${c.bold("EXAMPLES")}
  npx whymark fmt reviews/auth.whymark --write
  npx whymark fmt reviews/auth.whymark > /tmp/canonical.whymark
`;
}

function helpView(c: Palette): string {
  return `${c.bold("npx whymark view")} — open the visual reviewer

${c.bold("USAGE")}
  npx whymark view
  alias: open

The CLI does not serve the UI. Open a file at ${c.cyan("https://whymark.x47.dev")} —
it is parsed in your browser and is not uploaded.

  git clone https://github.com/spink-dev/whymark.git
  cd whymark && npm install && npm run dev
  open http://localhost:43917          ${c.gray("(PORT overrides the port, default 43917)")}

On a local checkout, reviews/*.whymark are listed and a reviewer can apply
decisions to the working tree. The hosted site cannot write files.

${c.bold("KEYBOARD")}  ${c.gray("(inside the reviewer, press ? )")}
  j / k              next / previous annotation
  x                  reject what the selected annotation covers
  u                  unified ↔ side by side
  ?                  toggle this help
  esc                clear selection
`;
}

function helpHelp(c: Palette): string {
  return `${c.bold("npx whymark help")} — show usage

${c.bold("USAGE")}
  npx whymark help [command]
  npx whymark <command> --help
  npx whymark -h

Commands: new, prompt, validate, verify, stats, fmt, view, version.
Also:     ${c.cyan("annotate")} — how to fill why / source / verify.
`;
}

function helpVersion(c: Palette): string {
  return `${c.bold("npx whymark version")} — print the version

${c.bold("USAGE")}
  npx whymark version
  npx whymark --version
`;
}

function helpAnnotate(c: Palette): string {
  return `${c.bold("npx whymark help annotate")} — how to fill a review

A generated skeleton has the diff right and the reasons blank. Fill them.
Do not edit the diff body — if the code is wrong, change the code and regenerate.

${c.bold("SELECTOR")}  ${c.gray("(file line numbers as shown in the diff, never hunk offsets)")}
  +42        new-side line 42
  +42..57    new-side range, inclusive
  -30        a deleted line
  file       the whole file
  doc        the whole change

${c.bold("SHAPE")}
  @note +15..18 kind=intent risk=low confidence=0.9
  why: …
  source: …
  verify: …

${c.bold("why")}
  Why the code is that way, and ideally something a reader could not have
  worked out from the diff.
  Good:  loadSession runs four times per request, so the same token hit the DB four times.
  Bad:   adds a cache to improve performance.

${c.bold("source")}     type:locator — why it matters
  types: file url doc spec commit pr issue test dep convention prompt inference
  Never invent a citation. If you read nothing:
    source: inference — <what you generalised from>

${c.bold("verify")}     method [\`detail\`] => status [(comment)]
  methods: cmd test type lint manual review none
  status:  pass fail unknown skipped
  Only claim pass for something you ran. ${c.cyan("npx whymark verify")} re-runs every
  cmd, so a false pass is worse than none.

${c.bold("kind")}       intent ${c.gray("(default)")} source verify risk assumption alternative
            todo question security perf test generated note
${c.bold("risk")}       blast radius if you are wrong: low | medium | high
${c.bold("confidence")} 0..1, honest. Low + a ${c.cyan("question:")} beats false certainty.

Also: ${c.cyan("alt:")} (rejected option), ${c.cyan("todo:")}, ${c.cyan("question:")}, ${c.cyan("ref:")}, ${c.cyan("impact:")}.
Free-form markdown after the fields is a longer explanation.

Full grammar: spec/whymark-v1.md
`;
}
