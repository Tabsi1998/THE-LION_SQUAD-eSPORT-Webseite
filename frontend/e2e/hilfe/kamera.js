const fs = require("node:fs");
const path = require("node:path");
const { CLIPS, HOLD_MS, LEAD_MS, actions, encode, hideBars, hideDot, requireFfmpeg, showBars, startCapture } = require("./clips");

// Kamera für den Hilfe-Bereich (#2295): Bild je Schritt mit markierter Stelle, als WebP direkt in
// src/hilfe/bilder/<thema>/<schritt>-<handy|pc>.webp, dazu die Größe in src/hilfe/bilder/masse.json (gegen Springen
// beim Laden). Ohne HILFE_BILDER=1 entstehen keine Dateien - die Prüfungen laufen trotzdem, und am Ende muss jeder
// Schritt mit Bild einmal dran gewesen sein. So wird der Test rot, wenn ein Ablauf bricht oder ein Schritt fehlt.
//
// Schleifen (#2448): Schritte mit `"clip": true` nehmen mit HILFE_CLIPS=1 eine kurze Bewegung samt Poster auf
// (cam.clip, Aufnahme in ./clips.js) nach src/hilfe/clips/<thema>/<schritt>-<handy|pc>.webm und .mp4. HILFE_BILDER=1
// erzeugt nur die Bilder der Schritte ohne Schleife - das Poster einer Schleife entsteht mit ihr.

const ROOT = path.resolve(__dirname, "../../src/hilfe");
const SHOTS = process.env.HILFE_BILDER === "1";
const QUALITY = 0.8;
const MARK = "#FFD23F";
// Was nicht ins Bild gehört: Hinweise (Toasts), die Leiste unten am Handy, „Nach oben“.
const HIDE = "[data-sonner-toaster], [data-testid='bottom-nav'], [data-testid='scroll-top-btn'] { display: none !important; }";

function topic(slug) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "themen", `${slug}.json`), "utf8"));
}

function stepsOf(slug) {
  return topic(slug).abschnitte.flatMap((abschnitt) => abschnitt.schritte);
}

const sizes = {};
const clipStats = [];

/** Eine Kamera je Thema und Breite: `form` ist „handy“ (390 px) oder „pc“ (1440 px). */
function camera(page, slug, form) {
  const steps = stepsOf(slug);
  const seen = new Set();
  const clipped = new Set();
  const stepOf = (id) => {
    const step = steps.find((row) => row.id === id);
    if (!step) throw new Error(`Schritt ${slug}#${id} steht nicht in src/hilfe/themen/${slug}.json`);
    if (!step.bild) throw new Error(`Schritt ${slug}#${id} hat kein Bild (bild: false)`);
    return step;
  };
  return {
    slug,
    form,
    seen,
    /** Schritt `id`: `mark` (Locator oder Liste) muss sichtbar sein und wird gerahmt; `area` ist optional der Ausschnitt. */
    async shot(id, mark, { area = null, pad = 14, each = false } = {}) {
      const step = stepOf(id);
      if (step.clip) throw new Error(`Schritt ${slug}#${id} hat eine Schleife (clip: true) - cam.clip statt cam.shot`);
      const marks = [mark].flat();
      for (const item of marks) await item.first().waitFor({ state: "visible" });
      seen.add(id);
      if (!SHOTS) return;
      await photograph(page, `${slug}/${id}-${form}`, marks, area ? [area].flat() : null, pad, form, each);
    },
    /**
     * Schritt mit Schleife (#2448): `run(act)` führt die Handgriffe aus (act.click/check/select/type/pause), danach
     * gilt dasselbe wie bei `shot`. Mit HILFE_CLIPS=1 wird dabei aufgenommen: `start` (Locator, sonst die erste
     * Markierung) steht vorher an der Stelle `block` im Bild, `keepBars` lässt Kopfzeile und Leisten sichtbar.
     */
    async clip(id, mark, run, { area = null, pad = 14, each = false, start = null, block = "center", keepBars = false } = {}) {
      const step = stepOf(id);
      if (!step.clip) throw new Error(`Schritt ${slug}#${id} hat keine Schleife - "clip": true im JSON oder cam.shot`);
      const marks = [mark].flat();
      if (CLIPS) {
        await record(page, `${slug}/${id}-${form}`, { marks, area: area ? [area].flat() : null, pad, each, start: start || marks[0], block, keepBars, form, run });
      } else {
        await run(actions(page, form, false));
        for (const item of marks) await item.first().waitFor({ state: "visible" });
      }
      seen.add(id);
      clipped.add(id);
    },
    /** Am Ende: jeder Schritt mit Bild war dran, und jeder mit Schleife über cam.clip. */
    missing() {
      return steps.filter((step) => (step.bild && !seen.has(step.id)) || (step.clip && !clipped.has(step.id))).map((step) => step.id);
    },
  };
}

async function boxes(locators) {
  const out = [];
  for (const locator of locators) {
    for (const item of await locator.all()) {
      if (!(await item.isVisible())) continue;
      const box = await item.boundingBox();
      if (box && box.width > 0 && box.height > 0) out.push(box);
    }
  }
  return out;
}

function union(list) {
  return {
    left: Math.min(...list.map((box) => box.x)),
    top: Math.min(...list.map((box) => box.y)),
    right: Math.max(...list.map((box) => box.x + box.width)),
    bottom: Math.max(...list.map((box) => box.y + box.height)),
  };
}

/** Der Rahmen um das Bild: ohne `area` der nächste Kasten um die erste Markierung, der breit genug ist (Karte, Spalte). */
async function contextBox(marks, form) {
  const minWidth = form === "pc" ? 620 : 340;
  return marks[0].first().evaluate((node, min) => {
    let current = node;
    // Nach oben bis zu einem Kasten, der breit genug ist - aber nie über ein Fenster (Sheet, Dialog) hinaus und nie von
    // einer schmalen Spalte (Formular in der Mitte) auf die ganze Seite.
    const stop = (element) => element.matches("[role='dialog'], [data-testid$='-sheet']");
    while (current.parentElement && current.getBoundingClientRect().width < min && !stop(current)) {
      const width = current.getBoundingClientRect().width;
      if (width >= 300 && current.parentElement.getBoundingClientRect().width >= window.innerWidth * 0.9) break;
      current = current.parentElement;
    }
    const rect = current.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }, minWidth);
}

/** Unterkante der Kopfzeilen, die oben kleben - was darunter liegt, wäre im Bild verdeckt. */
async function headerBottom(page) {
  return page.evaluate(() => {
    let bottom = 0;
    for (const node of document.querySelectorAll("header, nav, div")) {
      const style = getComputedStyle(node);
      if (style.position !== "sticky" && style.position !== "fixed") continue;
      if (getComputedStyle(node).visibility === "hidden") continue;
      const rect = node.getBoundingClientRect();
      if (rect.top <= 1 && rect.bottom > 0 && rect.height < 200 && rect.width > window.innerWidth / 2) bottom = Math.max(bottom, rect.bottom);
    }
    return bottom;
  });
}

async function frame(page, marks, area, form) {
  const markBox = union(await boxes(marks));
  if (area) {
    // Ausdrücklich gewählter Ausschnitt: ganz, samt Markierung.
    const areaBox = union(await boxes(area));
    return { markBox, box: { left: Math.min(areaBox.left, markBox.left), right: Math.max(areaBox.right, markBox.right), top: Math.min(areaBox.top, markBox.top), bottom: Math.max(areaBox.bottom, markBox.bottom) } };
  }
  const context = await contextBox(marks, form);
  let outer = { left: context.x, top: context.y, right: context.x + context.width, bottom: context.y + context.height };
  // Seitlich nicht beliebig breit: Auf der Hilfe-Seite ist die Spalte rund 840 px breit, ein breiter flacher Streifen
  // würde dort winzig. Am PC höchstens 120 px neben der Markierung.
  const side = form === "pc" ? 120 : Infinity;
  outer = {
    left: Math.min(Math.max(outer.left, markBox.left - side), markBox.left),
    right: Math.max(Math.min(outer.right, markBox.right + side), markBox.right),
    top: outer.top,
    bottom: outer.bottom,
  };
  // Ein langer Kasten wird oben und unten auf die Markierung mit etwas Umgebung gekürzt; ein flacher bekommt etwas
  // Umgebung dazu (die Beschriftung über einem Feld).
  const around = form === "pc" ? 150 : 110;
  const top = Math.min(Math.max(outer.top, markBox.top - around), markBox.top - 56);
  const bottom = Math.max(Math.min(outer.bottom, markBox.bottom + around), markBox.bottom + 40);
  return { markBox, box: { left: outer.left, right: outer.right, top: Math.min(top, markBox.top), bottom: Math.max(bottom, markBox.bottom) } };
}

/** Gelbe Rahmen um das Markierte (ein Rahmen um alles, mit `each` einer je Element). */
async function drawRings(page, marks, markBox, each) {
  const rings = each ? (await boxes(marks)).map((item) => ({ left: item.x, top: item.y, right: item.x + item.width, bottom: item.y + item.height })) : [markBox];
  await page.evaluate(({ rects, color }) => {
    const holder = document.createElement("div");
    holder.id = "hilfe-markierung";
    for (const rect of rects) {
      const ring = document.createElement("div");
      Object.assign(ring.style, {
        position: "fixed", left: `${rect.left - 6}px`, top: `${rect.top - 6}px`, width: `${rect.right - rect.left + 12}px`, height: `${rect.bottom - rect.top + 12}px`,
        border: `3px solid ${color}`, borderRadius: "6px", boxShadow: `0 0 0 4px rgba(0,0,0,0.55), 0 0 18px ${color}`, pointerEvents: "none", zIndex: 2147483647,
      });
      holder.appendChild(ring);
    }
    document.body.appendChild(holder);
  }, { rects: rings, color: MARK });
}

/** Der Bildausschnitt in CSS-Pixeln: Rahmen samt Markierung und Rand, nicht unter die Kopfzeile, nicht aus dem Bild. */
function clipRect(box, markBox, pad, header, view) {
  const x = Math.max(0, Math.floor(Math.min(box.left, markBox.left - 10) - pad));
  const y = Math.max(Math.ceil(header), Math.floor(Math.min(box.top, markBox.top - 10) - pad));
  const right = Math.min(view.width, Math.ceil(Math.max(box.right, markBox.right + 10) + pad));
  const bottom = Math.min(view.height, Math.ceil(Math.max(box.bottom, markBox.bottom + 10) + pad));
  return { x, y, width: right - x, height: bottom - y };
}

/** PNG → WebP im Browser (OffscreenCanvas), nach src/hilfe/bilder/<key>.webp, Größe in CSS-Pixeln für masse.json. */
async function saveWebp(page, key, png, size) {
  const webp = await page.evaluate(async ({ data, quality }) => {
    const bitmap = await window.createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new window.OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/webp", quality });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
  }, { data: png.toString("base64"), quality: QUALITY });
  const file = path.join(ROOT, "bilder", `${key}.webp`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(webp, "base64"));
  sizes[key] = [Math.round(size.width), Math.round(size.height)];
}

async function photograph(page, key, marks, area, pad, form, each = false) {
  await marks[0].first().evaluate((node) => node.scrollIntoView({ block: "center", inline: "nearest" }));
  await page.waitForTimeout(250);
  // Erst nur die Größe - die Markierung zählt nach dem Anpassen des Fensters (unten neu vermessen).
  let { box } = await frame(page, marks, area, form);
  let markBox;
  const before = page.viewportSize();
  let header = await headerBottom(page);
  const need = Math.ceil(box.bottom - box.top + 2 * pad + header + 24);
  if (need > before.height) {
    await page.setViewportSize({ width: before.width, height: need });
    await page.waitForTimeout(250);
  }
  const view = page.viewportSize();
  ({ markBox, box } = await frame(page, marks, area, form));
  header = await headerBottom(page);
  if (box.top - pad < header || box.bottom + pad > view.height) {
    await page.evaluate((delta) => window.scrollBy(0, delta), box.top - pad - header - 12);
    await page.waitForTimeout(300);
    header = await headerBottom(page);
    ({ markBox, box } = await frame(page, marks, area, form));
  }
  await drawRings(page, marks, markBox, each);
  const clip = clipRect(box, markBox, pad, header, view);
  const png = await page.screenshot({ clip, animations: "disabled", caret: "hide", style: HIDE });
  await page.evaluate(() => document.getElementById("hilfe-markierung")?.remove());
  await saveWebp(page, key, png, clip);
  if (need > before.height) await page.setViewportSize(before);
}

/**
 * Eine Schleife aufnehmen (#2448): Start in Position bringen, Leisten ausblenden, Übertragung starten, kurz Ruhe,
 * Handgriffe, dann den Ausschnitt des Endstands vermessen, Rahmen einblenden, halten. Das Poster ist genau dieser
 * Endstand im selben Ausschnitt.
 */
async function record(page, key, { marks, area, pad, each, start, block, keepBars, form, run }) {
  requireFfmpeg();
  await start.first().waitFor({ state: "visible" });
  await start.first().evaluate((node, where) => node.scrollIntoView({ block: where, inline: "nearest" }), block);
  await page.waitForTimeout(300);
  await hideBars(page, keepBars);
  const scrollBefore = await page.evaluate(() => [window.scrollX, window.scrollY]);
  const startTop = (await start.first().boundingBox())?.y ?? null;
  await page.waitForTimeout(150);
  const cast = await startCapture(page);
  try {
    await page.waitForTimeout(LEAD_MS);
    await run(actions(page, form, true));
    // Der Punkt geht vor dem Halten weg (am PC blieb er sonst im Poster stehen).
    await hideDot(page);
    for (const item of marks) await item.first().waitFor({ state: "visible" });
    await page.waitForTimeout(500);
    const view = page.viewportSize();
    const { markBox, box } = await frame(page, marks, area, form);
    const header = keepBars ? 0 : await headerBottom(page);
    const clip = clipRect(box, markBox, pad, header, view);
    if (clip.height < 60 || clip.width < 60) throw new Error(`${key}: Ausschnitt liegt nicht im Bild (start/block anpassen).`);
    // Scrollt die Seite während der Aufnahme, passt der Ausschnitt nur zum Ende - der Anfang wäre verrutscht.
    const now = await page.evaluate(() => [window.scrollX, window.scrollY]);
    const moved = [{ scrollX: scrollBefore[0], scrollY: scrollBefore[1] }, ...cast.frames].find((row) => Math.abs(row.scrollX - now[0]) > 2 || Math.abs(row.scrollY - now[1]) > 2);
    // Ausnahme Scroll-Verankerung: Wächst oben etwas, gleicht der Browser aus - der Start steht dann im Fenster noch
    // genau da, wo er war, und der Ausschnitt passt.
    const startNow = (await start.first().isVisible().catch(() => false)) ? (await start.first().boundingBox())?.y ?? null : null;
    const anchored = startTop !== null && startNow !== null && Math.abs(startNow - startTop) <= 2;
    if (moved && !anchored) throw new Error(`${key}: Die Seite scrollt während der Aufnahme (${moved.scrollY} → ${now[1]} px). start/block so wählen, dass alles im Bild ist.`);
    await drawRings(page, marks, markBox, each);
    await page.evaluate(() => {
      const holder = document.getElementById("hilfe-markierung");
      holder.getBoundingClientRect();
      holder.dataset.an = "1";
    });
    await page.waitForTimeout(HOLD_MS);
    await cast.stop();
    const end = Date.now() / 1000;
    const png = await page.screenshot({ clip, animations: "disabled", caret: "hide" });
    await saveWebp(page, key, png, clip);
    const outBase = path.join(ROOT, "clips", key);
    fs.mkdirSync(path.dirname(outBase), { recursive: true });
    const result = encode({ frames: cast.frames, endTime: end, clip, viewWidth: view.width, outBase });
    clipStats.push({ key, ...result, width: clip.width, height: clip.height });
  } finally {
    await cast.stop();
    await showBars(page);
  }
}

/** Größen in masse.json nachtragen (bestehende Einträge anderer Themen bleiben, sortiert für ruhige Diffs). */
function saveSizes() {
  if (clipStats.length) {
    for (const row of clipStats) console.log(`Schleife ${row.key}: ${row.length.toFixed(1)} s, ${row.width}x${row.height}, webm ${row.sizes.webm} B, mp4 ${row.sizes.mp4} B`);
  }
  if ((!SHOTS && !CLIPS) || !Object.keys(sizes).length) return;
  const file = path.join(ROOT, "bilder", "masse.json");
  // Direkt lesen statt erst nachzusehen (kein Wettlauf zwischen Prüfen und Lesen); fehlt die Datei, fangen wir leer an.
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const merged = { ...current, ...sizes };
  // Eine Zeile je Bild, sortiert - ruhige Diffs beim Neuerzeugen.
  const lines = Object.keys(merged).sort().map((key) => `  ${JSON.stringify(key)}: [${merged[key].join(", ")}]`);
  fs.writeFileSync(file, `{\n${lines.join(",\n")}\n}\n`);
}

module.exports = { CLIPS, ROOT, SHOTS, camera, saveSizes, stepsOf, topic };
