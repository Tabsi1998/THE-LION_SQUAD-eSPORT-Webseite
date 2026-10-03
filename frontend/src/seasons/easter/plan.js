// Ostern - die Rechnung ohne React (#645, #753, #756): welcher Ostertag heute ist (Wiener Datum), wann es still
// bleibt (Karfreitag), wann gegrüßt wird (Ostersonntag und -montag), welche Eier in der Reihe unter der Kopfzeile
// liegen, wo auf der Wiese über der Fußzeile Blumen stehen, wie ein Zitronenfalter fliegt und wo ein Feldhase kurz
// seine Ohren hinter einer Karte hervorstreckt.
import { MEDIA_OR_CONTROL, TEXT_PAD, blocksPoint } from "../glyphs";
import { mulberry32, seasonRng, seasonYear } from "../rng";
import { PATTERN_NAMES } from "../easterHunt/EggShape";
import { FLOWER_KINDS } from "./art";

export const TIME_ZONE = "Europe/Vienna";
/** Eigene Ebenen der Osterzeit - die Sonde schaut durch sie hindurch. */
export const OWN_LAYERS = ".tls-easter-layer, .tls-mascot-hat, .tls-mascot-hat-page";

/** Das Wiener Datum (JJJJ-MM-TT) zu einem Zeitpunkt. */
export function viennaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dayNumber(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86400000);
}

const DAYS = { "-7": "palm", "-2": "friday", "-1": "saturday", 0: "sunday", 1: "monday" };

/**
 * Welcher Ostertag heute ist: palm (Palmsonntag), week (Montag bis Gründonnerstag), friday, saturday, sunday, monday -
 * gezählt vom Ostersonntag, den der Server mitschickt (`data.sunday`).
 */
export function easterDay(season, now = new Date()) {
  const sunday = String(season?.data?.sunday || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sunday)) return season?.data?.quiet ? "friday" : "week";
  return DAYS[dayNumber(viennaDate(now)) - dayNumber(sunday)] || "week";
}

/** Karfreitag: die Deko bleibt, aber still - keine Bewegung, kein Gruß, keine Falter, kein Hase. */
export function isQuiet(season, now = new Date()) {
  return Boolean(season?.data?.quiet) || easterDay(season, now) === "friday";
}

/** Gegrüßt wird am Ostersonntag und am Ostermontag. */
export function greetingDay(season, now = new Date()) {
  const day = easterDay(season, now);
  return day === "sunday" || day === "monday";
}

export function yearOf(season) {
  return seasonYear({ key: "easter", starts_at: season?.starts_at || "" });
}

/** Wie viele Eier die Reihe unter der Kopfzeile hat: am PC sechs, am Handy drei. */
export function rowCount(width) {
  return width < 640 ? 3 : 6;
}

export const ROW_STEP = 21;
export const ROW_EGG = 16;
export const ROW_HEIGHT = 26;

export function rowWidth(count) {
  return count * ROW_STEP + 18;
}

/** Die Muster der Reihe: `count` verschiedene aus zwölf, je Aufruf neu gemischt (`seed`). */
export function rowPatterns(seed, count = 6) {
  const rng = mulberry32(seed >>> 0);
  const list = [...PATTERN_NAMES];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, count);
}

/**
 * Ist an einem Fensterpunkt nichts Lesbares (Schrift, Bild, Bedienelement)? Eigene Ebenen zählen nicht; ohne
 * `elementsFromPoint` (Tests ohne Layout) ist alles frei.
 */
export function freeAt(doc, x, y, own = OWN_LAYERS) {
  if (!doc || typeof doc.elementsFromPoint !== "function") return true;
  const hit = doc.elementsFromPoint(x, y).find((node) => typeof node.closest !== "function" || !node.closest(own));
  for (let node = hit; node && node.nodeType === 1 && node !== doc.body && node !== doc.documentElement; node = node.parentElement) {
    if (blocksPoint(node, x, y)) return false;
  }
  return true;
}

/** Ist ein Rechteck (Fensterkoordinaten) frei? Punkte alle `step` px, `free(x, y)` sagt es je Punkt. */
export function areaFree(box, free, step = 10) {
  for (let y = box.top + 2; y <= box.bottom - 2; y += step) {
    for (let x = box.left + 2; x <= box.right - 2; x += step) if (!free(x, y)) return false;
    if (!free(box.right - 2, y)) return false;
  }
  return free(box.left + 2, box.bottom - 2) && free(box.right - 2, box.bottom - 2);
}

/**
 * Wo die Reihe unter der Kopfzeile liegt (Fensterkoordinaten): rechts bündig mit dem Inhalt, sonst in der Mitte -
 * die erste Stelle, unter der nichts steht; null, wenn keine frei ist. `header` ist ein Rechteck, `column` die
 * Inhaltskante der Kopfzeile (ohne ihren Innenabstand).
 */
export function rowSpot(header, column, clientWidth, free) {
  const count = rowCount(clientWidth);
  const width = rowWidth(count);
  const top = Math.round(header.bottom + 6);
  const candidates = [Math.round(column.right - width), Math.round((clientWidth - width) / 2)];
  for (const left of candidates) {
    if (left < 8 || left + width > clientWidth - 8) continue;
    if (areaFree({ left, top, right: left + width, bottom: top + ROW_HEIGHT }, free)) return { left, top, width, count };
  }
  return null;
}

export const MEADOW_HEIGHT = 26;

/**
 * Was in einem Kasten (Fensterkoordinaten) Lesbares liegt - auch außerhalb des Fensters: Kästen von Grafiken und
 * Bedienelementen, Zeichenkästen der Schrift (plus `pad`). Ohne Layout (Tests) leer.
 */
export function contentRects(root, box, pad = TEXT_PAD) {
  const out = [];
  if (!root || typeof root.querySelectorAll !== "function") return out;
  const near = (r) => r && r.width > 0 && r.height > 0 && r.left < box.right + pad && r.right > box.left - pad && r.top < box.bottom + pad && r.bottom > box.top - pad;
  root.querySelectorAll(MEDIA_OR_CONTROL).forEach((node) => {
    const rect = node.getBoundingClientRect();
    if (near(rect)) out.push(rect);
  });
  const doc = root.ownerDocument;
  if (!doc || typeof doc.createTreeWalker !== "function" || typeof doc.createRange !== "function") return out;
  const walker = doc.createTreeWalker(root, 4);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!text.textContent.trim() || !text.parentElement || !near(text.parentElement.getBoundingClientRect())) continue;
    const range = doc.createRange();
    range.selectNodeContents(text);
    const rects = typeof range.getClientRects === "function" ? Array.from(range.getClientRects()) : [];
    rects.forEach((rect) => {
      if (near(rect)) out.push({ left: rect.left - pad, right: rect.right + pad, top: rect.top - pad, bottom: rect.bottom + pad });
    });
  }
  return out;
}

/** Die Blumen und Büschel, die frei stehen: keins über einem der `blocked`-Kästen (Koordinaten wie die Wiese). */
export function freeMeadow(items, blocked) {
  if (!blocked.length) return items;
  return items.filter((item) => {
    const width = item.kind === "grass" ? item.width : Math.round(14 * (item.height / 24));
    const box = { left: item.x, right: item.x + width, top: MEADOW_HEIGHT - item.height, bottom: MEADOW_HEIGHT };
    return !blocked.some((rect) => box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top);
  });
}

/** Die Wiese über der Fußzeile: Blumen und Büschel entlang der Breite - fest je Jahr und Seite. `small`: weniger. */
export function meadowPlan(width, { year, route = "/", small = false } = {}) {
  const rng = seasonRng({ season: "easter", year, route }, "meadow");
  const items = [];
  const [gapMin, gapMax] = small ? [70, 160] : [34, 92];
  let x = 6 + rng() * 30;
  while (x < width - 16) {
    if (rng() < (small ? 0.45 : 0.55)) {
      items.push({ x: Math.round(x), kind: FLOWER_KINDS[Math.floor(rng() * FLOWER_KINDS.length)], height: Math.round(13 + rng() * 9), sway: Math.round((3.5 + rng() * 2.5) * 10) / 10, delay: Math.round(rng() * 3000) });
    } else {
      items.push({ x: Math.round(x), kind: "grass", width: Math.round(12 + rng() * 8), height: Math.round(7 + rng() * 5), blades: 3 + Math.floor(rng() * 3) });
    }
    x += gapMin + rng() * (gapMax - gapMin);
  }
  return items;
}

/** Ein Flug des Zitronenfalters: Richtung, Höhe (Anteil des Fensters), Dauer, Bogen, Größe. */
export function butterflyFlight(rng) {
  return { fromLeft: rng() < 0.5, y: Math.round((0.18 + rng() * 0.5) * 100) / 100, seconds: Math.round((8 + rng() * 4) * 10) / 10, bob: Math.round(14 + rng() * 22), size: Math.round(22 + rng() * 8) };
}

/** Wann der nächste Falter fliegt und wann der Hase guckt (Sekunden): der erste bald, dann mit langer Pause. */
export const BUTTERFLY_FIRST = [20, 40];
export const BUTTERFLY_EVERY = [120, 180];
export const PEEK_FIRST = [60, 120];
export const PEEK_EVERY = [240, 480];
/** Am Handy guckt der Hase halb so oft. */
export const PEEK_NARROW_FACTOR = 2;

/** Die nächste Pause in Millisekunden. */
export function nextDelay(rng, [min, max], factor = 1) {
  return Math.round((min + rng() * (max - min)) * factor * 1000);
}

export const PEEK_BOX = { width: 30, height: 32 };

/**
 * Wo der Hase guckt (Fensterkoordinaten der Ohren-Box, ihre Unterkante auf der Oberkante einer Karte): eine Karte im
 * Fenster, deren Oberkante frei sichtbar ist (unter der Kopfzeile, über dem unteren Rand), und darüber kein Text.
 * `cards` sind Rechtecke; null, wenn keine passt.
 */
export function peekSpot(cards, { headerBottom = 0, innerHeight = 800 } = {}, free) {
  for (const rect of cards) {
    if (rect.width < 160 || rect.top < headerBottom + 48 || rect.top > innerHeight - 110) continue;
    for (const fraction of [0.78, 0.22, 0.5]) {
      const left = Math.round(rect.left + rect.width * fraction - PEEK_BOX.width / 2);
      const box = { left, top: rect.top - PEEK_BOX.height, right: left + PEEK_BOX.width, bottom: rect.top - 1 };
      if (areaFree(box, free, 7)) return { left, top: box.top };
    }
  }
  return null;
}

/** Ein Zufall für die Momente (Falter, Hase): je Aufruf anders, aber in Tests fest. */
export function momentRng(seed = Date.now()) {
  return mulberry32(Number(seed) >>> 0);
}
