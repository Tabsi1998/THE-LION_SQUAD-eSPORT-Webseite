const fs = require("node:fs");
const path = require("node:path");

// Bilder für die Anleitungen (docs/handbuch/helfer.md, #1686): zugeschnitten auf das Wesentliche - eine Karte, ein
// Kasten, ein Fenster - statt der ganzen Seite. Dasselbe Bild am PC (1440 px) und am Handy (390 px) im selben Zustand:
// erst PC, dann die Breite umstellen, dann Handy. Ohne ABNAHME_SHOTS entstehen keine Bilder, die Prüfungen laufen
// trotzdem. Hinweise (Toasts) gehören nicht ins Bild.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const PC = { width: 1440, height: 900 };
const HANDY = { width: 390, height: 900 };
const HIDE = "[data-sonner-toaster] { display: none !important; }";

async function boxesOf(targets) {
  const boxes = [];
  for (const target of [targets].flat()) {
    for (const item of await target.all()) {
      const box = await item.boundingBox();
      if (box && box.width > 0 && box.height > 0) boxes.push(box);
    }
  }
  return boxes;
}

function union(boxes) {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { left, top, right, bottom };
}

/** Kopfzeilen, die oben kleben (Website und Verwaltung am Handy) - was darunter liegt, wäre im Bild verdeckt. */
async function headerBottom(page) {
  return page.evaluate(() => {
    let bottom = 0;
    for (const node of document.querySelectorAll("header, nav, div")) {
      const position = getComputedStyle(node).position;
      if (position !== "sticky" && position !== "fixed") continue;
      const rect = node.getBoundingClientRect();
      if (rect.top <= 1 && rect.bottom > 0 && rect.height < 200 && rect.width > window.innerWidth / 2) bottom = Math.max(bottom, rect.bottom);
    }
    return bottom;
  });
}

/** Ein Bild vom Bereich, den `targets` (Locator oder Liste) zusammen einnehmen, mit etwas Rand. */
async function bild(page, name, targets, { pad = 6 } = {}) {
  if (!SHOTS) return;
  const first = [targets].flat()[0].first();
  const center = () => first.evaluate((node) => node.scrollIntoView({ block: "center", inline: "nearest" }));
  await center();
  let box = union(await boxesOf(targets));
  let header = await headerBottom(page);
  const before = page.viewportSize();
  // Passt der Bereich nicht unter die Kopfzeile, wird das Fenster für dieses Bild höher - nichts wird abgeschnitten.
  const need = Math.ceil(box.bottom - box.top + 2 * pad + header + 24);
  if (need > before.height) {
    await page.setViewportSize({ width: before.width, height: need });
    await page.waitForTimeout(200);
    await center();
  }
  const view = page.viewportSize();
  box = union(await boxesOf(targets));
  header = await headerBottom(page);
  if (box.top - pad < header || box.bottom + pad > view.height) {
    await page.evaluate((delta) => window.scrollBy(0, delta), box.top - pad - header - 12);
    await page.waitForTimeout(300);
    header = await headerBottom(page);
    box = union(await boxesOf(targets));
  }
  const x = Math.max(0, Math.floor(box.left - pad));
  const y = Math.max(Math.ceil(header), Math.floor(box.top - pad));
  const clip = {
    x,
    y,
    width: Math.min(view.width, Math.ceil(box.right + pad)) - x,
    height: Math.min(view.height, Math.ceil(box.bottom + pad)) - y,
  };
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), clip, animations: "disabled", caret: "hide", style: HIDE });
  if (need > before.height) await page.setViewportSize(before);
}

/**
 * Dasselbe Bild am PC und am Handy: `<name>-pc.png` und `<name>-handy.png`. `targets` ist ein Locator, eine Liste oder
 * eine Funktion (`"pc"`/`"handy"` → Locator), wenn PC und Handy verschiedene Bausteine zeigen. Danach wieder PC.
 */
async function bilder(page, name, targets, options) {
  const pick = (mode) => (typeof targets === "function" ? targets(mode) : targets);
  await page.setViewportSize(PC);
  await page.waitForTimeout(150);
  await bild(page, `${name}-pc`, pick("pc"), options);
  await page.setViewportSize(HANDY);
  await page.waitForTimeout(250);
  await bild(page, `${name}-handy`, pick("handy"), options);
  await page.setViewportSize(PC);
  await page.waitForTimeout(150);
}

module.exports = { HANDY, PC, SHOTS, bild, bilder };
