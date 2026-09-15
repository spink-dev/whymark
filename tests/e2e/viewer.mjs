// Interaction checks against a running dev server. The viewer's whole point is
// that a card sits beside the code it explains, and a server-only render still
// looks right while every control is dead, so these assert behaviour in a real
// browser. Usage: npm run dev, then WHYMARK_URL=http://127.0.0.1:43917 node tests/e2e/viewer.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = process.env.WHYMARK_URL ?? "http://127.0.0.1:43917";
const OUT = process.env.WHYMARK_ARTIFACTS ?? ".artifacts";
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") =>
  results.push({ name, ok, detail });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

await page.goto(`${BASE}/r/rate-limit-public-api`, { waitUntil: "networkidle" });

// --- numbers actually on screen -----------------------------------------
const sourced = await page
  .locator('div[title*="citing something outside"] div')
  .last()
  .innerText();
check("evidence panel: sourced count", sourced.trim() === "8", `read "${sourced.trim()}"`);

const headerCoverage = await page.locator("header span[title*='added lines carry']").innerText();
check("header coverage", headerCoverage.includes("90"), `read "${headerCoverage.trim()}"`);

// --- hydration ----------------------------------------------------------
const hydrated = await page.evaluate(() => {
  const el = document.querySelector("[id^='note-']");
  return Boolean(el && Object.keys(el).some((k) => k.startsWith("__react")));
});
check("react hydrated the annotation cards", hydrated);

// --- split toggle -------------------------------------------------------
const splitButton = page.getByRole("button", { name: /split/i });
await splitButton.click();
await page.waitForTimeout(500);
const countSplitRows = () =>
  page.evaluate(() => document.querySelectorAll('[data-whymark-body="split"]').length);
const splitColumns = await countSplitRows();
check("split toggle produces two-column bodies", splitColumns > 0, `${splitColumns} split bodies`);

// The failure this replaced: both sides shared one scroll area, so a long line
// on the left ran underneath the right-hand column.
const splitGeometry = await page.evaluate(() => {
  const spills = [];
  for (const cell of document.querySelectorAll(".whymark-row")) {
    const cellBox = cell.getBoundingClientRect();
    for (const span of cell.querySelectorAll(":scope > span:last-child")) {
      const box = span.getBoundingClientRect();
      if (box.width > 0 && box.right > cellBox.right + 1) {
        spills.push(Math.round(box.right - cellBox.right));
      }
    }
  }
  const sides = [...document.querySelectorAll("[data-whymark-side]")];
  const clipped = sides.every((side) => {
    const style = getComputedStyle(side);
    return style.overflowX === "auto" || style.overflowX === "scroll";
  });
  return { spills: spills.length, worst: Math.max(0, ...spills), sides: sides.length, clipped };
});
check(
  "neither split column bleeds into the other",
  splitGeometry.spills === 0 && splitGeometry.clipped && splitGeometry.sides >= 2,
  JSON.stringify(splitGeometry),
);

const splitDrift = await page.evaluate(() => {
  let worst = 0;
  let counted = 0;
  for (const wrapper of document.querySelectorAll(".absolute.right-2")) {
    const card = wrapper.querySelector("[id^='note-']");
    const id = card?.id.replace("note-", "") ?? "";
    const row = [...document.querySelectorAll(".whymark-row")].find((candidate) =>
      candidate.dataset.notes?.split(" ").includes(id),
    );
    if (!row) continue;
    counted += 1;
    worst = Math.max(
      worst,
      Math.abs(wrapper.getBoundingClientRect().top - row.getBoundingClientRect().top),
    );
  }
  return { counted, worst: Math.round(worst) };
});
check(
  "split view keeps every card level with its line",
  splitDrift.counted > 5 && splitDrift.worst <= 2,
  JSON.stringify(splitDrift),
);

// An added or deleted file has no other side, so split must fall back to unified
// instead of spending half the width on an empty column.
const oneSided = await page.evaluate(() => ({
  note: document.body.innerText.includes("nothing to compare, shown unified"),
  bodies: [...document.querySelectorAll("[data-whymark-body]")].map(
    (body) => body.dataset.whymarkBody,
  ),
}));
check(
  "an added file stays unified in split mode",
  oneSided.note && oneSided.bodies.includes("unified") && oneSided.bodies.includes("split"),
  JSON.stringify(oneSided),
);
await page.screenshot({ path: `${OUT}/pw-02-split.png`, fullPage: false });

// --- sticky file header -------------------------------------------------
// It used to stick 56px inside its own panel, on top of the code, because the
// panel clipped its overflow and became the scrollport.
await page.evaluate(() => window.scrollTo(0, 1200));
await page.waitForTimeout(400);
const sticky = await page.evaluate(() => {
  const toolbar = document.querySelector("header.sticky.top-0");
  const toolbarBottom = toolbar?.getBoundingClientRect().bottom ?? 0;
  const headers = [...document.querySelectorAll("section[id^='file-'] > header")];
  const pinned = headers
    .map((header) => header.getBoundingClientRect().top)
    .filter((top) => top >= 0 && top < toolbarBottom + 40);
  const covered = document.elementFromPoint(500, toolbarBottom + 4);
  return {
    toolbarBottom: Math.round(toolbarBottom),
    pinned: pinned.map(Math.round),
    underToolbar: covered?.closest("section[id^='file-'] > header") ? "header" : "row",
  };
});
check(
  "a pinned file header sits flush under the toolbar, not inside its diff",
  sticky.pinned.every((top) => Math.abs(top - sticky.toolbarBottom) <= 1) &&
    sticky.underToolbar === "header",
  JSON.stringify(sticky),
);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);

// keyboard 'u' back to unified
await page.keyboard.press("u");
await page.waitForTimeout(300);
const unifiedMarkers = await countSplitRows();
check("keyboard u returns to unified", unifiedMarkers === 0, `${unifiedMarkers} split bodies left`);

// --- j / k stepping -----------------------------------------------------
await page.mouse.click(600, 300); // move focus into the document
await page.keyboard.press("j");
await page.waitForTimeout(500);
const firstActive = await page.evaluate(
  () => document.querySelector("[id^='note-'].whymark-flash")?.id ?? null,
);
await page.keyboard.press("j");
await page.waitForTimeout(500);
const secondActive = await page.evaluate(() => {
  const ringed = [...document.querySelectorAll("[id^='note-']")].filter((el) =>
    el.className.includes("ring-1"),
  );
  return ringed.at(-1)?.id ?? null;
});
check("j steps through annotations", Boolean(firstActive || secondActive), `flash=${firstActive} active=${secondActive}`);
await page.screenshot({ path: `${OUT}/pw-03-jk.png` });

// --- help overlay -------------------------------------------------------
await page.keyboard.press("?");
await page.waitForTimeout(300);
const helpVisible = await page.getByText("Reviewing with the keyboard").isVisible().catch(() => false);
check("? opens the help overlay", helpVisible);
await page.screenshot({ path: `${OUT}/pw-04-help.png` });
await page.keyboard.press("Escape");

// --- filters ------------------------------------------------------------
const before = await page.locator("[id^='note-']").count();
await page.getByRole("button", { name: /^intent/ }).click();
await page.waitForTimeout(400);
const after = await page.locator("[id^='note-']").count();
check("kind filter narrows the cards", after < before && after > 0, `${before} → ${after}`);
await page.getByRole("button", { name: /^intent/ }).click();

// --- hover tint ---------------------------------------------------------
const card = page.locator("[id^='note-']").nth(2);
await card.hover({ force: true });
await page.waitForTimeout(300);
const tinted = await page.evaluate(() => {
  return [...document.querySelectorAll(".whymark-row")].filter((row) => {
    const bg = getComputedStyle(row).backgroundColor;
    return bg && bg !== "rgba(0, 0, 0, 0)" && !bg.includes("0.1");
  }).length;
});
check("hovering a card tints its lines", tinted > 0, `${tinted} tinted rows`);
await page.screenshot({ path: `${OUT}/pw-05-hover.png` });

// --- alignment ----------------------------------------------------------
const alignment = await page.evaluate(() => {
  const out = [];
  for (const card of document.querySelectorAll("[id^='note-']")) {
    const id = card.id.replace("note-", "");
    const rows = [...document.querySelectorAll(".whymark-row")].filter((row) =>
      row.dataset.notes?.split(" ").includes(id),
    );
    if (!rows.length) continue;
    const cardBox = card.getBoundingClientRect();
    const rowBox = rows[0].getBoundingClientRect();
    out.push({ id, delta: Math.round(cardBox.top - rowBox.top) });
  }
  return out;
});
const worst = alignment.reduce((max, a) => Math.max(max, Math.abs(a.delta)), 0);
check(
  "every card starts level with its first annotated line",
  alignment.length > 5 && worst <= 2,
  `${alignment.length} cards, worst drift ${worst}px`,
);

const overlap = await page.evaluate(() => {
  const wrappers = [...document.querySelectorAll(".absolute.right-2")];
  let worstOverlap = 0;
  for (let i = 1; i < wrappers.length; i++) {
    const previous = wrappers[i - 1].getBoundingClientRect();
    const current = wrappers[i].getBoundingClientRect();
    if (current.top > previous.top) {
      worstOverlap = Math.max(worstOverlap, Math.round(previous.bottom - current.top));
    }
  }
  return worstOverlap;
});
check("no two cards overlap", overlap <= 0, `worst overlap ${overlap}px`);

// --- inspect page -------------------------------------------------------
await page.goto(`${BASE}/inspect`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /try an example/i }).click();
await page.waitForTimeout(2500);
const renderedPasted = await page.getByText("Reject expired invite tokens").first().isVisible().catch(() => false);
check("inspect: try an example renders", renderedPasted);
await page.screenshot({ path: `${OUT}/pw-06-inspect.png`, fullPage: false });

// --- a second, denser review -------------------------------------------
await page.goto(`${BASE}/r/parser-recovery`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const secondReview = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".absolute.right-2")];
  let drift = 0;
  let overlap = 0;
  for (const wrapper of cards) {
    const card = wrapper.querySelector("[id^='note-']");
    const id = card?.id.replace("note-", "");
    const row = [...document.querySelectorAll(".whymark-row")].find((candidate) =>
      candidate.dataset.notes?.split(" ").includes(id ?? ""),
    );
    if (!row) continue;
    drift = Math.max(
      drift,
      Math.abs(wrapper.getBoundingClientRect().top - row.getBoundingClientRect().top),
    );
  }
  for (let i = 1; i < cards.length; i++) {
    const previous = cards[i - 1].getBoundingClientRect();
    const current = cards[i].getBoundingClientRect();
    if (current.top > previous.top) {
      overlap = Math.max(overlap, previous.bottom - current.top);
    }
  }
  return { count: cards.length, drift: Math.round(drift), overlap: Math.round(overlap) };
});
check(
  "second review: cards aligned and clear of each other",
  secondReview.count > 3 && secondReview.drift <= 2 && secondReview.overlap <= 0,
  JSON.stringify(secondReview),
);

// --- deciding what to keep, on a review of a file that really exists ----
// This writes to examples/retry.ts and restores it afterwards.
const EXAMPLE = "examples/retry.ts";
const gitDirty = () =>
  execFileSync("git", ["status", "--porcelain", "--", EXAMPLE], { encoding: "utf8" }).trim();

if (gitDirty()) {
  check("decide flow: example file starts clean", false, `${EXAMPLE} has uncommitted changes`);
} else {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${BASE}/r/retry-backoff`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const editable = await page.evaluate(() => !document.body.innerText.includes("read-only"));
  check("decide flow: a file matching the working tree is editable", editable);

  const logRow = page.locator(".whymark-row", { hasText: "[retry] attempt" }).first();
  await logRow.scrollIntoViewIfNeeded();
  await logRow.hover();
  const control = logRow.getByRole("button", { name: /discard this added line/i });
  const hasControl = (await control.count()) === 1;
  check("decide flow: hovering a changed line offers a discard control", hasControl);

  if (hasControl) {
    await control.click();
    await page.waitForTimeout(400);
    const marked = await page.evaluate(() =>
      document.body.innerText.includes("writes to your working tree"),
    );
    check("decide flow: a decision raises the apply bar", marked);
    await page.screenshot({ path: `${OUT}/pw-08-decide.png` });

    await page.getByRole("button", { name: /^apply$/i }).click();
    await page.waitForTimeout(2500);

    const diff = execFileSync("git", ["diff", "--numstat", "--", EXAMPLE], { encoding: "utf8" });
    check(
      "decide flow: apply removes exactly the discarded line from the file",
      diff.trim().startsWith("0\t1\t"),
      `git numstat "${diff.trim()}"`,
    );

    const confirmed = await page.evaluate(() =>
      document.body.innerText.includes("Working tree updated"),
    );
    check("decide flow: the reviewer is told what changed on disk", confirmed);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const nowReadOnly = await page.evaluate(() =>
      document.body.innerText.includes("read-only"),
    );
    check(
      "decide flow: the file is read-only once it no longer matches the review",
      nowReadOnly,
    );

    execFileSync("git", ["checkout", "--", EXAMPLE]);
    check("decide flow: example restored", gitDirty() === "");
  }

  // --- the inline editor ------------------------------------------------
  await page.goto(`${BASE}/r/retry-backoff`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const hunk = page.locator(".whymark-row.group\\/hunk").nth(1);
  await hunk.scrollIntoViewIfNeeded();
  await hunk.hover();
  await hunk.getByRole("button", { name: /^edit$/ }).click();
  await page.waitForTimeout(700);
  const editor = await page.evaluate(() => {
    const textarea = document.querySelector("textarea");
    if (!textarea) return null;
    return {
      width: Math.round(textarea.getBoundingClientRect().width),
      wraps: textarea.wrap !== "off",
      prefilled: textarea.value.includes("await sleep(wait);"),
    };
  });
  check(
    "editor: opens wide, unwrapped, holding the new side of the hunk",
    Boolean(editor && editor.prefilled && !editor.wraps && editor.width > 600),
    JSON.stringify(editor),
  );
  await page.screenshot({ path: `${OUT}/pw-09-editor.png` });
  await page.getByRole("button", { name: /^cancel$/ }).click();
  await page.waitForTimeout(300);
  check("editor: cancel leaves the file alone", gitDirty() === "");
}

// --- narrow viewport ----------------------------------------------------
await page.goto(`${BASE}/r/parser-recovery`, { waitUntil: "networkidle" });
await page.setViewportSize({ width: 720, height: 1000 });
await page.waitForTimeout(600);
const compact = await page.evaluate(() => ({
  rail: document.querySelectorAll(".absolute.right-2").length,
  inline: document.querySelectorAll("[id^='note-']").length,
}));
check(
  "narrow screens drop the rail and inline the cards",
  compact.rail === 0 && compact.inline > 3,
  JSON.stringify(compact),
);
await page.screenshot({ path: `${OUT}/pw-07-compact.png` });

// --- report -------------------------------------------------------------
console.log("");
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
}
console.log("");
console.log(`console errors (${consoleErrors.length}):`);
for (const error of consoleErrors.slice(0, 10)) console.log(`  ${error}`);

await browser.close();
process.exit(results.some((r) => !r.ok) ? 1 : 0);
