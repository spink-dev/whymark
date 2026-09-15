import { describe, expect, it } from "vitest";
import { parseCrev, parseSelector, parseSourceRef, parseVerifyClaim } from "../src/lib/crev/parse";
import { serializeCrev } from "../src/lib/crev/serialize";

const DOC = `---
crev: 1
title: Cache the user lookup
author: claude-opus-5 (cursor)
scope: staged
base: main@47abc20
summary: |
  Session middleware hit the database on every request.
  This memoises the lookup per request.
checks:
  - cmd: npm test
    status: pass
---

@note doc kind=risk risk=medium
why: The cache is per request, so a long-lived request holds a stale user.

@file src/middleware/session.ts modified +5 -1 newsha=9f2a1c4
@@ -12,7 +12,11 @@ export async function loadSession(req: Request) {
   const token = req.headers.get("authorization");
   if (!token) return null;
-  return db.users.findByToken(token);
+  const cached = perRequestCache.get(req);
+  if (cached) return cached;
+  const user = await db.users.findByToken(token);
+  perRequestCache.set(req, user);
+  return user;
 }

@note +14..18 kind=intent risk=low confidence=0.9
why: \`loadSession\` runs four times per request, so the same token was
  resolved four times against the database.
source: file:src/handlers/api.ts:22 — one of the four call sites
source: inference — no ticket for this; found while reading the query log
verify: cmd \`npm test -- session\` => pass (12 assertions)
verify: none

The cache is keyed on the Request object via WeakMap.

@note +16 kind=assumption confidence=0.4
why: A null user is cached and returned as a hit.
todo: confirm mid-request grants are impossible
`;

describe("parseCrev", () => {
  const doc = parseCrev(DOC);

  it("reads frontmatter including block summary and checks", () => {
    expect(doc.meta.crev).toBe(1);
    expect(doc.meta.title).toBe("Cache the user lookup");
    expect(doc.meta.author).toBe("claude-opus-5 (cursor)");
    expect(doc.meta.scope).toBe("staged");
    expect(doc.meta.summary).toContain("memoises the lookup per request");
    expect(doc.meta.checks).toEqual([
      { cmd: "npm test", status: "pass", detail: undefined, ran: undefined },
    ]);
  });

  it("keeps document-level notes out of file sections", () => {
    expect(doc.notes).toHaveLength(1);
    expect(doc.notes[0].kind).toBe("risk");
    expect(doc.notes[0].risk).toBe("medium");
  });

  it("numbers diff lines from the hunk header", () => {
    const file = doc.files[0];
    expect(file.path).toBe("src/middleware/session.ts");
    expect(file.status).toBe("modified");
    expect(file.newSha).toBe("9f2a1c4");
    expect(file.added).toBe(5);
    expect(file.removed).toBe(1);

    const hunk = file.hunks[0];
    expect(hunk.heading).toBe("export async function loadSession(req: Request) {");
    const added = hunk.lines.filter((l) => l.type === "add");
    expect(added.map((l) => l.newLine)).toEqual([14, 15, 16, 17, 18]);
    const removed = hunk.lines.filter((l) => l.type === "del");
    expect(removed.map((l) => l.oldLine)).toEqual([14]);
  });

  it("parses note attributes, fields and continuations", () => {
    const note = doc.files[0].notes[0];
    expect(note.id).toBe("n2");
    expect(note.kind).toBe("intent");
    expect(note.confidence).toBe(0.9);
    expect(note.why).toContain("resolved four times against the database");
    expect(note.sources).toHaveLength(2);
    expect(note.sources[0]).toMatchObject({
      type: "file",
      locator: "src/handlers/api.ts:22",
      note: "one of the four call sites",
    });
    expect(note.sources[1].type).toBe("inference");
    expect(note.verify[0]).toMatchObject({
      method: "cmd",
      detail: "npm test -- session",
      status: "pass",
      comment: "12 assertions",
    });
    expect(note.verify[1]).toMatchObject({ method: "none", status: "unknown" });
    expect(note.body).toBe("The cache is keyed on the Request object via WeakMap.");
  });

  it("collects todos", () => {
    const note = doc.files[0].notes[1];
    expect(note.todos).toEqual(["confirm mid-request grants are impossible"]);
    expect(note.confidence).toBe(0.4);
  });

  it("reports no errors for a well-formed document", () => {
    expect(doc.diagnostics.filter((d) => d.level === "error")).toEqual([]);
  });

  it("round-trips through the serializer", () => {
    const once = serializeCrev(doc);
    const twice = serializeCrev(parseCrev(once));
    expect(twice).toBe(once);
    const reparsed = parseCrev(once);
    expect(reparsed.files[0].hunks[0].lines).toEqual(doc.files[0].hunks[0].lines);
    expect(reparsed.files[0].notes[0].why).toBe(doc.files[0].notes[0].why);
  });
});

describe("selectors", () => {
  it("reads sides and ranges", () => {
    expect(parseSelector("+42")).toMatchObject({ side: "new", start: 42, end: 42 });
    expect(parseSelector("+42..57")).toMatchObject({ side: "new", start: 42, end: 57 });
    expect(parseSelector("+42..+57")).toMatchObject({ side: "new", start: 42, end: 57 });
    expect(parseSelector("-30..35")).toMatchObject({ side: "old", start: 30, end: 35 });
    expect(parseSelector("file")).toMatchObject({ side: "file" });
    expect(parseSelector("doc")).toMatchObject({ side: "doc" });
    expect(parseSelector("12..18")).toMatchObject({ side: "new", start: 12, end: 18 });
    expect(parseSelector("nonsense")).toBeNull();
  });

  it("flags a selector that names lines absent from the diff", () => {
    const doc = parseCrev(`---
crev: 1
title: t
---

@file a.ts modified
@@ -1,2 +1,3 @@
 a
+b
 c

@note +900 kind=intent
why: drifted
`);
    const codes = doc.diagnostics.map((d) => d.code);
    expect(codes).toContain("selector-out-of-range");
  });
});

describe("source refs", () => {
  it("splits type, locator and rationale", () => {
    expect(parseSourceRef("file:src/config.ts:14 — WINDOW_MS already existed")).toMatchObject({
      type: "file",
      locator: "src/config.ts:14",
      note: "WINDOW_MS already existed",
    });
    expect(parseSourceRef("url:https://redis.io/commands/incr — INCR is atomic")).toMatchObject({
      type: "url",
      locator: "https://redis.io/commands/incr",
    });
    expect(parseSourceRef("https://example.com/x").type).toBe("url");
    expect(parseSourceRef("inference — pattern-matched from the module next door")).toMatchObject({
      type: "inference",
      note: "pattern-matched from the module next door",
    });
    expect(parseSourceRef('prompt:"cap it at 100 a minute" — your words').type).toBe("prompt");
  });
});

describe("verify claims", () => {
  it("reads method, command, status and comment", () => {
    expect(parseVerifyClaim("cmd `npm test -- limiter` => pass (8 assertions)")).toMatchObject({
      method: "cmd",
      detail: "npm test -- limiter",
      status: "pass",
      comment: "8 assertions",
    });
    expect(parseVerifyClaim("type => pass")).toMatchObject({
      method: "type",
      status: "pass",
    });
    expect(parseVerifyClaim("manual \"429 after the 101st request\" => pass")).toMatchObject({
      method: "manual",
      detail: "429 after the 101st request",
      status: "pass",
    });
    expect(parseVerifyClaim("none => unknown (needs a load test)")).toMatchObject({
      method: "none",
      status: "unknown",
      comment: "needs a load test",
    });
    expect(parseVerifyClaim("cmd `npm run build` -> fail (type error)")).toMatchObject({
      status: "fail",
      comment: "type error",
    });
    expect(parseVerifyClaim("`npm run lint` => pass").method).toBe("cmd");
  });
});

describe("lenient parsing", () => {
  it("treats a blank line inside a hunk as context and trims the trailing one", () => {
    const doc = parseCrev(`---
crev: 1
title: t
---

@file a.ts modified
@@ -1,4 +1,5 @@
 first

 third
+fourth

@note +4 kind=intent
why: because
`);
    const lines = doc.files[0].hunks[0].lines;
    expect(lines.map((l) => l.type)).toEqual(["context", "context", "context", "add"]);
    expect(lines[1].text).toBe("");
    expect(doc.files[0].notes[0].why).toBe("because");
  });

  it("does not misread a diff of a crev file as directives", () => {
    const doc = parseCrev(`---
crev: 1
title: t
---

@file reviews/x.crev modified
@@ -1,3 +1,4 @@
 @file src/a.ts modified
-@note +1 kind=note
+@note +1 kind=intent
+why: real reason

@note +2..3 kind=intent
why: annotating an annotation
`);
    expect(doc.files).toHaveLength(1);
    expect(doc.files[0].hunks[0].lines).toHaveLength(4);
    expect(doc.files[0].notes).toHaveLength(1);
  });

  it("accepts a field written without a space after the colon", () => {
    const doc = parseCrev(`---
crev: 1
title: t
---

@file a.ts added +1
@@ -0,0 +1 @@
+const x = 1;

@note +1 kind=intent
why:no space after the colon
verify:cmd \`npm test\` => pass
`);
    const note = doc.files[0].notes[0];
    expect(note.why).toBe("no space after the colon");
    expect(note.verify[0]).toMatchObject({ method: "cmd", status: "pass" });
  });

  it("does not read a bare URL in a body as a field", () => {
    const doc = parseCrev(`---
crev: 1
title: t
---

@file a.ts added +1
@@ -0,0 +1 @@
+const x = 1;

@note +1 kind=intent
why: because

https://example.com/docs explains the rest.
`);
    const note = doc.files[0].notes[0];
    expect(note.body).toBe("https://example.com/docs explains the rest.");
    expect(note.extra).toEqual({});
  });

  it("keeps code spans intact when wrapping long values", () => {
    const long =
      "This explanation is quite long so that the serializer has to wrap it across several lines, and it mentions `npm run test:e2e -- --grep limiter` which must stay on one line.";
    const doc = parseCrev(`---
crev: 1
title: t
---

@file a.ts added +1
@@ -0,0 +1 @@
+const x = 1;

@note +1 kind=intent
why: ${long}
`);
    const text = serializeCrev(doc);
    expect(text).toContain("`npm run test:e2e -- --grep limiter`");
    for (const line of text.split("\n")) {
      if (line.startsWith("why:") || line.startsWith("  ")) {
        expect(line.length).toBeLessThanOrEqual(90);
      }
    }
    expect(parseCrev(text).files[0].notes[0].why).toBe(long);
    expect(serializeCrev(parseCrev(text))).toBe(text);
  });

  it("recovers from a missing frontmatter with an error, not a throw", () => {
    const doc = parseCrev("@file a.ts modified\n@@ -1 +1 @@\n+x\n");
    expect(doc.diagnostics.some((d) => d.code === "frontmatter-missing")).toBe(true);
    expect(doc.files).toHaveLength(1);
  });
});
