---
name: whymark
description: Write a whymark (.whymark) review of code changes — a diff with line-addressed annotations giving why each change was made, what evidence backs it, and how it was verified. Use when asked to explain, document, justify, or hand off your own changes for review, or when asked for a code review, change walkthrough, or "what did you do and why".
---

# Writing a whymark review

The instructions for this skill live in one place so that Cursor, Codex, and any
other agent follow the same rules:

**Read `.agents/skills/whymark/SKILL.md` now and follow it.** The full format is
specified in `spec/whymark-v1.md`.

The shape of the job, so you know what you are committing to before you read it:

```bash
npx whymark new --staged --author "<your model name>"   # writes reviews/<slug>.whymark
# fill in summary, and every why / source / verify field; delete stubs that say nothing
npx whymark validate reviews/<slug>.whymark
npx whymark verify   reviews/<slug>.whymark --write        # re-runs your own claims
```

Three rules that matter more than the rest:

- `why:` states the reason the code is that way, never what it does.
- `source:` cites only things you actually read. If there was none, write
  `inference` and say what you generalised from. Never invent a citation.
- `verify:` claims `pass` only for a command you ran in this session. `whymark
  verify` re-runs them, so a false claim gets caught.
