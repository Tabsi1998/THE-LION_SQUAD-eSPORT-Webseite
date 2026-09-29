// Fledermaus-Plätze (H7, #695): echte Kanten statt Buchstaben. Eine Fledermaus hängt unter einer Kante
// (Menüpunkt, Kopfzeile, Unterkante einer Karte oder eines Bildes, Mähne des Löwen) oder sitzt auf einer Ecke
// (Oberkante einer Karte oder eines Rahmens, Fußzeilen-Strich). Jeder Anker hat feste Plätze mit Belegung, Ruhezonen sind
// tabu, und wo darunter oder darüber Text oder eine andere Karte liegt, gibt es keinen Platz. Die Auswahl
// bleibt aus dem Seed der Seite stabil. Alles ohne React; die Anzeige liegt in HangingBats.jsx.

import { measureQuietZones, pointInQuiet } from "../quiet";

export const NAV_SELECTOR = "header nav a";
export const HEADER_SELECTOR = "header";
export const CARD_SELECTOR = "[data-season-anchor='card'], [data-season-perch='card']";
export const FRAME_SELECTOR = "[data-season-perch='frame']";
export const IMAGE_SELECTOR = "main img, main picture, main video";
export const LION_SELECTOR = "[data-season-anchor='lion']";
export const FOOTER_LINE_SELECTOR = "footer [data-season-line]";
export const MIN_DISTANCE = 140;
export const MAX_CARDS = 16;
export const MAX_IMAGES = 6;
/** Wie oft welche Art drankommt, wenn es sie auf der Seite gibt. */
export const KIND_WEIGHTS = { nav: 0.2, header: 0.12, card: 0.3, frame: 0.12, image: 0.1, lion: 0.06, footer: 0.05 };
/** Sitzt (Oberkante, Ecke) oder hängt (Unterkante)? */
export const POSE = { hang: "hang", sit: "sit" };
/** Höhe der Figur je Haltung, in Vielfachen der Breite (`size`). */
export const SHAPE_HEIGHT = { hang: 1.55, sit: 1.15 };
const TEXT_LIKE = "p, h1, h2, h3, h4, h5, h6, li, a, button, time, label, input, select, textarea, span, strong, em, small, td, th, figcaption, blockquote, pre, code";
const BLOCKING = `${CARD_SELECTOR}, ${FRAME_SELECTOR}, ${TEXT_LIKE}`;

const elementIds = new WeakMap();
let nextElementId = 1;

/** Ein je Element stabiler Schlüssel - Karten teilen sich Klassen, Belegung braucht aber das einzelne Element. */
function elementId(element) {
  if (!elementIds.has(element)) elementIds.set(element, nextElementId++);
  return elementIds.get(element);
}

function scrollOf(win) {
  return { x: (win && win.scrollX) || 0, y: (win && win.scrollY) || 0 };
}

function rectOf(element) {
  if (!element || typeof element.getBoundingClientRect !== "function") return null;
  const rect = element.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0 ? rect : null;
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Ist an einem Fensterpunkt Platz für die Figur? `probe(x, y)` liefert das Element dort (im Browser
 * `elementFromPoint`, in Tests gestellt). Außerhalb des Fensters weiß niemand etwas - dann gilt der Punkt als frei,
 * die Geometrie der anderen Karten prüft `clearOf`. Text, Bedienelemente und andere Karten blockieren; das eigene
 * Element, dessen Rahmen und nackter Hintergrund nicht.
 */
function roomAt(probe, x, y, owner, win) {
  if (!probe) return true;
  if (win && (x < 0 || y < 0 || x > win.innerWidth || y > win.innerHeight)) return true;
  const hit = probe(x, y);
  if (!hit || hit === owner) return true;
  if (typeof hit.closest !== "function") return true;
  const blocker = hit.closest(BLOCKING);
  if (!blocker) return true;
  return blocker === owner || (owner.contains(blocker) && !blocker.matches(TEXT_LIKE) && !blocker.closest(TEXT_LIKE));
}

/** Schneidet die Figur an (x, y) eine der anderen gemessenen Kanten-Elemente (Seitenkoordinaten)? */
function clearOf(rects, owner, x, top, width, height) {
  const left = x - width / 2;
  const right = x + width / 2;
  const bottom = top + height;
  return rects.every(({ element, page }) => element === owner || right <= page.left || left >= page.right || bottom <= page.top || top >= page.bottom);
}

/**
 * Ein Platz an einem Element: `at(rect)` rechnet den Punkt aus dem frischen Rechteck (Fensterkoordinaten). `fixed`
 * heißt: das Element klebt am Fenster (Kopfzeile); dann bleiben x/y Fensterkoordinaten, sonst werden sie um den
 * Scrollstand zu Seitenkoordinaten. `px`/`py` sind immer Seitenkoordinaten (für Abstände und Ruhezonen).
 */
function slot({ kind, element, fixed, pose, size, at, index = 0, win }) {
  const rect = rectOf(element);
  if (!rect) return null;
  const first = at(rect);
  if (!first) return null;
  const scroll = scrollOf(win);
  const measure = () => {
    if (!element.isConnected) return null;
    const again = rectOf(element);
    if (!again) return null;
    const point = at(again);
    if (!point) return null;
    const now = scrollOf(win);
    return fixed ? { x: point.x, y: point.y } : { x: point.x + now.x, y: point.y + now.y };
  };
  const x = fixed ? first.x : first.x + scroll.x;
  const y = fixed ? first.y : first.y + scroll.y;
  return { kind, pose, fixed, element, index, x, y, px: first.x + scroll.x, py: first.y + scroll.y, size, measure, key: `${kind}:${elementId(element)}:${index}` };
}

function navPerches(doc, win) {
  const out = [];
  doc.querySelectorAll(NAV_SELECTOR).forEach((element) => {
    const rect = rectOf(element);
    if (!rect || rect.width < 24 || rect.height < 10 || rect.top > 160) return;
    const perch = slot({ kind: "nav", element, fixed: true, pose: POSE.hang, size: 24, win, at: (r) => (r.width < 24 ? null : { x: r.left + r.width / 2, y: r.bottom + 2 }) });
    if (perch) out.push(perch);
  });
  return out;
}

/** Die Unterkante der Kopfzeile: drei Plätze über die Breite, hängend; klebt sie oben, hängen sie am Fenster. */
function headerPerches(doc, win) {
  const header = doc.querySelector(HEADER_SELECTOR);
  const rect = rectOf(header);
  if (!rect || rect.height < 30 || rect.top > 40) return [];
  const position = win && typeof win.getComputedStyle === "function" ? win.getComputedStyle(header).position : "";
  const fixed = position === "fixed" || position === "sticky";
  return [0.18, 0.5, 0.82].map((fraction, index) => slot({ kind: "header", element: header, fixed, pose: POSE.hang, size: 22, index, win, at: (r) => ({ x: r.left + r.width * fraction, y: r.bottom + 1 }) })).filter(Boolean);
}

/** Karten und Rahmen: zwei Sitzplätze auf den oberen Ecken, ein Hängeplatz unter der Unterkante - wo Platz ist. */
function boxPerches(doc, win, { kind, selector, rects, probe }) {
  const out = [];
  Array.from(doc.querySelectorAll(selector)).slice(0, MAX_CARDS).forEach((element, boxIndex) => {
    const rect = rectOf(element);
    if (!rect || rect.width < 120 || rect.height < 60) return;
    const scroll = scrollOf(win);
    const inset = 16 + ((hash(`${boxIndex}:${(element.textContent || "").slice(0, 40)}`) % 100) / 100) * 18;
    const sitHeight = 22 * SHAPE_HEIGHT.sit;
    [rect.left + inset, rect.right - inset].forEach((cornerX, index) => {
      if (!roomAt(probe, cornerX, rect.top - sitHeight * 0.6, element, win)) return;
      if (!clearOf(rects, element, cornerX + scroll.x, rect.top + scroll.y - sitHeight, 22, sitHeight)) return;
      const perch = slot({ kind, element, fixed: false, pose: POSE.sit, size: 22, index, win, at: (r) => (r.width < 120 ? null : { x: index === 0 ? r.left + inset : r.right - inset, y: r.top }) });
      if (perch) out.push(perch);
    });
    const hangHeight = 24 * SHAPE_HEIGHT.hang;
    const underX = rect.left + rect.width * 0.5;
    if (!roomAt(probe, underX, rect.bottom + hangHeight * 0.7, element, win)) return;
    if (!clearOf(rects, element, underX + scroll.x, rect.bottom + scroll.y, 24, hangHeight)) return;
    const bottom = slot({ kind, element, fixed: false, pose: POSE.hang, size: 24, index: 2, win, at: (r) => (r.width < 120 ? null : { x: r.left + r.width * 0.5, y: r.bottom - 1 }) });
    if (bottom) out.push(bottom);
  });
  return out;
}

/** Freistehende Bilder (nicht in Karten): unter der Unterkante, an einer je Bild festen Stelle - wenn darunter Platz ist. */
function imagePerches(doc, win, { rects, probe }) {
  const out = [];
  Array.from(doc.querySelectorAll(IMAGE_SELECTOR)).filter((element) => !element.closest(`${CARD_SELECTOR}, ${FRAME_SELECTOR}, header, footer`)).slice(0, MAX_IMAGES).forEach((element, index) => {
    const rect = rectOf(element);
    if (!rect || rect.width < 160 || rect.height < 100) return;
    const scroll = scrollOf(win);
    const fraction = 0.25 + ((hash(`${index}:${element.getAttribute("src") || element.getAttribute("alt") || ""}`) % 1000) / 1000) * 0.5;
    const x = rect.left + rect.width * fraction;
    const hangHeight = 24 * SHAPE_HEIGHT.hang;
    if (!roomAt(probe, x, rect.bottom + hangHeight * 0.7, element, win)) return;
    if (!clearOf(rects, element, x + scroll.x, rect.bottom + scroll.y, 24, hangHeight)) return;
    const perch = slot({ kind: "image", element, fixed: false, pose: POSE.hang, size: 24, win, at: (r) => (r.width < 160 ? null : { x: r.left + r.width * fraction, y: r.bottom - 1 }) });
    if (perch) out.push(perch);
  });
  return out;
}

function lionPerches(doc, win) {
  const out = [];
  doc.querySelectorAll(LION_SELECTOR).forEach((element) => {
    const rect = rectOf(element);
    if (!rect || rect.width < 80 || rect.height < 80) return;
    // Hängend wie bisher (#661): die Figur hängt in die Mähne hinein; sitzend schwebte sie über dem Kopf (Probe 29.09.).
    const perch = slot({ kind: "lion", element, fixed: false, pose: POSE.hang, size: 26, win, at: (r) => (r.width < 80 ? null : { x: r.left + r.width * 0.68, y: r.top + r.height * 0.16 }) });
    if (perch) out.push(perch);
  });
  return out;
}

/** Der Strich über dem Impressum (H16): zwei Sitzplätze links, damit Links und Kürbisse frei bleiben. */
function footerPerches(doc, win) {
  const line = doc.querySelector(FOOTER_LINE_SELECTOR);
  const rect = rectOf(line);
  if (!rect || rect.width < 300) return [];
  return [0.06, 0.16].map((fraction, index) => slot({ kind: "footer", element: line, fixed: false, pose: POSE.sit, size: 22, index, win, at: (r) => ({ x: r.left + r.width * fraction, y: r.top }) })).filter(Boolean);
}

/** Alle Karten-, Rahmen- und Bildrechtecke in Seitenkoordinaten - damit kein Platz eine Nachbarkarte schneidet. */
function edgeRects(doc, win) {
  const scroll = scrollOf(win);
  return Array.from(doc.querySelectorAll(`${CARD_SELECTOR}, ${FRAME_SELECTOR}, ${IMAGE_SELECTOR}`)).map((element) => {
    const rect = rectOf(element);
    return rect ? { element, page: { left: rect.left + scroll.x, right: rect.right + scroll.x, top: rect.top + scroll.y, bottom: rect.bottom + scroll.y } } : null;
  }).filter(Boolean);
}

/**
 * Alle Plätze der Seite - ohne Ruhezonen. `taken` sind belegte Schlüssel, die nicht angeboten werden; `probe`
 * ersetzt `elementFromPoint` (Tests). Fenster-Anker werden gegen die Fensterkoordinaten der Ruhezonen geprüft,
 * alle anderen gegen die Seite.
 */
export function measurePerches(doc = document, win = typeof window === "undefined" ? null : window, { zones = measureQuietZones(doc, win), taken = new Set(), probe = typeof doc.elementFromPoint === "function" ? (x, y) => doc.elementFromPoint(x, y) : null } = {}) {
  const rects = edgeRects(doc, win);
  const all = [
    ...navPerches(doc, win),
    ...headerPerches(doc, win),
    ...boxPerches(doc, win, { kind: "card", selector: CARD_SELECTOR, rects, probe }),
    ...boxPerches(doc, win, { kind: "frame", selector: FRAME_SELECTOR, rects, probe }),
    ...imagePerches(doc, win, { rects, probe }),
    ...lionPerches(doc, win),
    ...footerPerches(doc, win),
  ];
  return all.filter((perch) => !taken.has(perch.key) && !pointInQuiet(perch.fixed ? { x: perch.x, y: perch.y } : { x: perch.px, y: perch.py }, zones, { fixed: perch.fixed }));
}

/** Auswahl: erst die Art nach Gewicht, dann ein Platz dieser Art - nie zwei näher als der Mindestabstand (auch zu `taken`). */
export function choosePerches(candidates, count, rng, taken = []) {
  const chosen = [];
  const pools = new Map();
  candidates.forEach((candidate) => {
    const key = candidate.kind || "any";
    if (!pools.has(key)) pools.set(key, []);
    pools.get(key).push(candidate);
  });
  const farEnough = (candidate) => [...taken, ...chosen].every((other) => Math.hypot((other.px ?? other.x) - (candidate.px ?? candidate.x), (other.py ?? other.y) - (candidate.py ?? candidate.y)) >= MIN_DISTANCE);
  for (let n = 0; n < count; n += 1) {
    const kinds = [...pools.keys()].filter((kind) => pools.get(kind).some(farEnough));
    if (!kinds.length) break;
    const weightOf = (kind) => KIND_WEIGHTS[kind] || 0.1;
    let roll = rng() * kinds.reduce((sum, kind) => sum + weightOf(kind), 0);
    let kind = kinds[kinds.length - 1];
    for (let i = 0; i < kinds.length; i += 1) {
      roll -= weightOf(kinds[i]);
      if (roll <= 0) {
        kind = kinds[i];
        break;
      }
    }
    const options = pools.get(kind).filter(farEnough);
    chosen.push(options[Math.min(options.length - 1, Math.floor(rng() * options.length))]);
  }
  return chosen;
}

/** Der nächste freie Platz für eine landende Fledermaus: einer der drei nächsten, nicht derselbe, nicht zu nah an Belegten. */
export function nearestFreePerch(candidates, from, taken = [], rng = Math.random, { avoidKey = null, maxDistance = 900 } = {}) {
  const usable = candidates.filter((perch) => perch.key !== avoidKey && taken.every((other) => Math.hypot((other.px ?? other.x) - perch.px, (other.py ?? other.y) - perch.py) >= MIN_DISTANCE));
  if (!usable.length) return null;
  const scored = usable.map((perch) => ({ perch, d: Math.hypot(perch.px - from.x, perch.py - from.y) }))
    .filter((entry) => entry.d <= maxDistance || usable.length <= 2)
    .sort((a, b) => a.d - b.d);
  const pool = (scored.length ? scored : usable.map((perch) => ({ perch, d: 0 }))).slice(0, 3);
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))].perch;
}
