<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# crev

This repository defines the CREV review format (`spec/crev-v1.md`), its tooling
(`src/lib/crev`, `src/cli/crev.ts`), and a viewer for it (`src/app`).

## Reviewing your own changes

When you are asked to explain, document, justify, or hand off a change — or for
a code review or walkthrough of what you did — write a CREV review.
**Instructions: `.agents/skills/crev/SKILL.md`.** Short version:

```bash
npm run crev -- new --staged --author "<your model name>"   # writes reviews/<slug>.crev
# fill in summary and every why / source / verify field
npm run crev -- validate reviews/<slug>.crev
npm run crev -- verify   reviews/<slug>.crev --write
```

`why:` gives the reason, never a restatement of the code. `source:` cites only
what you actually read, and `inference` when there was nothing. `verify:` claims
`pass` only for commands you really ran — `crev verify` re-runs them.

## Working on this repository

- `npm test` (vitest), `npm run typecheck`, `npm run lint` before you finish.
- The core library must stay free of React/Next imports; it runs in the CLI too.
- Changing the format means changing `spec/crev-v1.md`, the parser, the
  serializer, the skill, and the tests together.
