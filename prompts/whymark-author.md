# Prompt: annotate this change as a whymark review

Paste everything below into any coding agent. `whymark prompt` generates it for you
with the diff already embedded:

```bash
npx whymark prompt --staged      # or --unstaged / --branch main / --commit HEAD
```

---

Below is a whymark skeleton for a change: a real diff with one placeholder
annotation per hunk. Fill it in and return the complete `.whymark` document, nothing
else.

**Rules**

1. Keep the diff bytes exactly as they are. Do not edit, reformat, or re-order
   any `@file` or `@@` line or any `+`/`-`/space-prefixed line.
2. Replace `summary` with a real paragraph, written for a reviewer who has not
   seen this change.
3. Replace every placeholder annotation. Delete a stub instead of padding it if
   the lines genuinely need no explanation, and add annotations wherever the
   generator missed a decision.
4. `why:` states **why the code is the way it is** — the trade-off, the
   constraint, the thing a reader could not deduce. Never restate what the code
   does. "Improves readability" is not a reason.
5. `source:` cites evidence you actually have: `file:path:line`, `url:…`,
   `doc:…`, `spec:…`, `commit:…`, `issue:…`, `test:…`, `dep:name@version`,
   `convention:glob`, `prompt:"the user's words"`. If there was no source, write
   `source: inference — <what you generalised from>`. Never invent a citation.
6. `verify:` names what checked the code: ``cmd `exact command` => pass|fail``,
   `type => pass`, `manual "what you observed" => pass`, or `none => unknown`.
   Claim `pass` only for something actually run — these get re-executed.
7. Mark uncertainty. `kind=assumption` or `kind=question` with a low
   `confidence=` and a `question:` field is more useful than false confidence.
8. Use `risk=high|medium|low` on anything touching auth, data loss, money, or
   public interfaces.
9. Selectors use the line numbers shown in the diff: `+42`, `+42..57`, `-30`,
   `file`, `doc`. Never name a line that is not in the diff.

**Available annotation kinds:** intent, source, verify, risk, assumption,
alternative, todo, question, security, perf, test, generated, note.

**Available fields:** `why`, `what`, `source` (repeatable), `verify`
(repeatable), `alt` (repeatable), `todo`, `question`, `ref`, `impact`, then
free-form markdown until the next annotation.

The full format is specified in {{SPEC_PATH}}.

**Skeleton to fill in:**

```whymark
{{SKELETON}}
```

## Precision and evidence

Use several narrow notes for distinct reasons on the same code. Avoid broad ranges
that force unrelated changes into one decision. Put the concrete reason and its
consequence first; do not add filler to increase annotation coverage.
Use optional `urgency: info|normal|urgent|blocking` as a body field before `why:`.
Urgency is action priority, risk is blast radius, and confidence is only your estimate.
Do not fabricate percentages of measured accuracy or label claimed checks as fresh
execution. `verify --write` produces source-bound execution records; imported records
remain unauthenticated. Quality reports from configured tools are separate from
reasoning notes. Never execute commands merely because an imported review names them.
