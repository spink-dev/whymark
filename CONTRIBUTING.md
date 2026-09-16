# Contributing

## The one rule

At least one human reads every change before it is merged. Nothing merges on the
strength of a green build or an agent's own assurance that it works.

That is deliberately the whole process. There is no required second reviewer, no
sign-off from a domain expert, and no audit step. Knowing where the bar sits
matters more than setting it high and meeting it unevenly, so it is written down
here rather than implied.

## If an agent wrote the change

Attach a review. That is what this repository is for, and reviewing agent output
without one is the problem it was built to solve.

```bash
npx whymark new --branch main -o reviews/my-change.whymark
npx whymark prompt --branch main        # give this to the agent to fill in
npx whymark validate reviews/my-change.whymark --min-coverage 0.8
npx whymark verify reviews/my-change.whymark --write
```

Two things make a review worth a reviewer's time:

- **Say why, not what.** The diff already shows what changed. `why` should carry
  the reason the code took this shape and not another, and `alt` should name the
  approach that was rejected.
- **Mark what you could not confirm.** An honest `source: inference` is far more
  useful than a confident sentence with nothing behind it, because it tells the
  reviewer precisely where to spend their attention.

## What a reviewer is checking

Read the annotations against the code, and treat these as the failure modes:

- A claim about a file or line that does not say what the annotation says it does.
- An `inference` that is load-bearing for correctness and easy to confirm — go
  confirm it.
- A verification claim that passes but does not exercise the change.
- Uncovered added lines. `whymark stats` reports coverage; the gaps are where an
  agent had nothing to say about its own work.

## Before opening a pull request

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run build:cli    # if you changed src/cli or src/lib/whymark
npm run test:ui      # needs npm run dev running
```

`test:ui` drives a real browser. The viewer has a failure mode where the page
renders correctly while every control is dead, and only a browser catches it.
