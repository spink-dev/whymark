<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# whymark

This repository defines the whymark review format (`spec/whymark-v1.md`), its tooling
(`src/lib/whymark`, `src/cli/whymark.ts`), and a viewer for it (`src/app`).

## Reviewing your own changes

When you are asked to explain, document, justify, or hand off a change — or for
a code review or walkthrough of what you did — write a whymark review.
**Instructions: `.agents/skills/whymark/SKILL.md`.** Short version:

```bash
npm run whymark -- new --staged --author "<your model name>"   # writes reviews/<slug>.whymark
# fill in summary and every why / source / verify field
npm run whymark -- validate reviews/<slug>.whymark
npm run whymark -- verify   reviews/<slug>.whymark --write
```

`why:` gives the reason, never a restatement of the code. `source:` cites only
what you actually read, and `inference` when there was nothing. `verify:` claims
`pass` only for commands you really ran — `whymark verify` re-runs them.

## Working on this repository

- `npm test` (vitest), `npm run typecheck`, `npm run lint` before you finish.
- `npm run test:ui` drives a real browser against a running `npm run dev`. It is
  the only check that catches layout regressions — a server-rendered page looks
  correct while every control is dead — and it exercises the apply path against
  `examples/retry.ts`, restoring the file afterwards.
- The core library must stay free of React/Next imports; it runs in the CLI too.
- `src/lib/whymark/edit.ts` rewrites real files. It assumes the file on disk is
  byte-identical to the diff's new side; callers must confirm that by comparing
  `newSha` first, which is what makes new-side line numbers safe to index by.
- Changing the format means changing `spec/whymark-v1.md`, the parser, the
  serializer, the skill, and the tests together.
