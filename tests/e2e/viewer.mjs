// Interaction checks against a running dev server. The viewer's whole point is
// that a card sits beside the code it explains, and a server-only render still
// looks right while every control is dead, so these assert behaviour in a real
// browser. Usage: npm run dev, then WHYMARK_URL=http://127.0.0.1:43917 node tests/e2e/viewer.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

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
await page.waitForTimeout(400);
// Only split rows carry the vertical divider between the old and new columns.
const countSplitRows = () =>
  page.evaluate(
    () =>
      [...document.querySelectorAll(".whymark-row")].filter((row) =>
        row.querySelector(":scope > span.w-px"),
      ).length,
  );
const splitColumns = await countSplitRows();
check("split toggle produces two-column rows", splitColumns > 10, `${splitColumns} paired rows`);
await page.screenshot({ path: `${OUT}/pw-02-split.png`, fullPage: false });

// keyboard 'u' back to unified
await page.keyboard.press("u");
await page.waitForTimeout(300);
const unifiedMarkers = await countSplitRows();
check("keyboard u returns to unified", unifiedMarkers === 0, `${unifiedMarkers} rows still paired`);

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

// --- narrow viewport ----------------------------------------------------
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
