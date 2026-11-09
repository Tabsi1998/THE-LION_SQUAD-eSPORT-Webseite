const fs = require("node:fs");
const path = require("node:path");

// Kamera für den Hilfe-Bereich (#2295): Bild je Schritt mit markierter Stelle, als WebP direkt in
// src/hilfe/bilder/<thema>/<schritt>-<handy|pc>.webp, dazu die Größe in src/hilfe/bilder/masse.json (gegen Springen
// beim Laden). Ohne HILFE_BILDER=1 entstehen keine Dateien - die Prüfungen laufen trotzdem, und am Ende muss jeder
// Schritt mit Bild einmal dran gewesen sein. So wird der Test rot, wenn ein Ablauf bricht oder ein Schritt fehlt.

const ROOT = path.resolve(__dirname, "../../src/hilfe");
const SHOTS = process.env.HILFE_BILDER === "1";
const VIDEOS = process.env.HILFE_VIDEOS === "1";
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

/** Eine Kamera je Thema und Breite: `form` ist „handy“ (390 px) oder „pc“ (1440 px). */
function camera(page, slug, form) {
  const steps = stepsOf(slug);
  const seen = new Set();
  return {
    slug,
    form,
    seen,
    /** Schritt `id`: `mark` (Locator oder Liste) muss sichtbar sein und wird gerahmt; `area` ist optional der Ausschnitt. */
    async shot(id, mark, { area = null, pad = 14, each = false } = {}) {
      const step = steps.find((row) => row.id === id);
      if (!step) throw new Error(`Schritt ${slug}#${id} steht nicht in src/hilfe/themen/${slug}.json`);
      if (!step.bild) throw new Error(`Schritt ${slug}#${id} hat kein Bild (bild: false)`);
      const marks = [mark].flat();
      for (const item of marks) await item.first().waitFor({ state: "visible" });
      seen.add(id);
      if (!SHOTS) return;
      await photograph(page, `${slug}/${id}-${form}`, marks, area ? [area].flat() : null, pad, form, each);
    },
    /** Am Ende: jeder Schritt mit Bild war dran. */
    missing() {
      return steps.filter((step) => step.bild && !seen.has(step.id)).map((step) => step.id);
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

async function photograph(page, key, marks, area, pad, form, each = false) {
  await marks[0].first().evaluate((node) => node.scrollIntoView({ block: "center", inline: "nearest" }));
  await page.waitForTimeout(250);
  let { markBox, box } = await frame(page, marks, area, form);
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
  // Ein Rahmen um alles Markierte - mit `each` einer je Element (etwa der Weg durch den Turnierbaum).
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
  const x = Math.max(0, Math.floor(Math.min(box.left, markBox.left - 10) - pad));
  const y = Math.max(Math.ceil(header), Math.floor(Math.min(box.top, markBox.top - 10) - pad));
  const right = Math.min(view.width, Math.ceil(Math.max(box.right, markBox.right + 10) + pad));
  const bottom = Math.min(view.height, Math.ceil(Math.max(box.bottom, markBox.bottom + 10) + pad));
  const clip = { x, y, width: right - x, height: bottom - y };
  const png = await page.screenshot({ clip, animations: "disabled", caret: "hide", style: HIDE });
  await page.evaluate(() => document.getElementById("hilfe-markierung")?.remove());
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
  sizes[key] = [Math.round(clip.width), Math.round(clip.height)];
  if (need > before.height) await page.setViewportSize(before);
}

/** Größen in masse.json nachtragen (bestehende Einträge anderer Themen bleiben, sortiert für ruhige Diffs). */
function saveSizes() {
  if (!SHOTS || !Object.keys(sizes).length) return;
  const file = path.join(ROOT, "bilder", "masse.json");
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const merged = { ...current, ...sizes };
  // Eine Zeile je Bild, sortiert - ruhige Diffs beim Neuerzeugen.
  const lines = Object.keys(merged).sort().map((key) => `  ${JSON.stringify(key)}: [${merged[key].join(", ")}]`);
  fs.writeFileSync(file, `{\n${lines.join(",\n")}\n}\n`);
}

// ---------------------------------------------------------------- Videos

/** Untertitel unten im Bild und ein sichtbarer Zeiger mit Klick-Ring - Videos laufen ohne Ton. */
async function subtitle(page, text) {
  await page.evaluate((line) => {
    let bar = document.getElementById("hilfe-untertitel");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "hilfe-untertitel";
      Object.assign(bar.style, {
        position: "fixed", left: "10px", right: "10px", bottom: "12px", padding: "10px 12px", background: "rgba(0,0,0,0.82)", color: "#fff",
        font: "600 15px/1.35 system-ui, sans-serif", borderRadius: "6px", borderLeft: "4px solid #29B6E8", zIndex: 2147483646, pointerEvents: "none",
      });
      document.body.appendChild(bar);
    }
    bar.textContent = line;
  }, text);
}

const POINTER = () => {
  const install = () => {
    if (document.getElementById("hilfe-zeiger")) return;
    const dot = document.createElement("div");
    dot.id = "hilfe-zeiger";
    Object.assign(dot.style, { position: "fixed", width: "22px", height: "22px", marginLeft: "-11px", marginTop: "-11px", borderRadius: "50%",
      background: "rgba(255,210,63,0.55)", border: "2px solid #FFD23F", zIndex: 2147483647, pointerEvents: "none", left: "-40px", top: "-40px", transition: "transform 120ms" });
    document.body.appendChild(dot);
    window.addEventListener("mousemove", (event) => { dot.style.left = `${event.clientX}px`; dot.style.top = `${event.clientY}px`; }, true);
    window.addEventListener("mousedown", () => { dot.style.transform = "scale(1.8)"; }, true);
    window.addEventListener("mouseup", () => { setTimeout(() => { dot.style.transform = "scale(1)"; }, 160); }, true);
  };
  if (document.body) install();
  else document.addEventListener("DOMContentLoaded", install);
};

/** Klick mit sichtbarer Bewegung dorthin. */
async function showClick(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
    await page.waitForTimeout(350);
  }
  await locator.click();
  await page.waitForTimeout(1100);
}

async function saveVideo(page, context, id) {
  const video = page.video();
  await context.close();
  const file = path.join(ROOT, "videos", `${id}.webm`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await video.saveAs(file);
  await video.delete();
}

module.exports = { POINTER, ROOT, SHOTS, VIDEOS, camera, saveSizes, saveVideo, showClick, stepsOf, subtitle, topic };
