// Atmosphäre (H14, #702) und Beobachter (H15, #703): reine Logik ohne React. Der Nebel ist unten im Bild und wird
// am Anfang der Seite (Hero) und am Ende (Fußzeile) stärker, dazwischen bleibt er fast unsichtbar. Augen und
// Rand-Schatten brauchen freie dunkle Fläche: ein Raster über das Fenster, je Zelle die Sonde (`elementFromPoint`),
// Ruhezonen tabu, Text, Bilder, Karten und helle Flächen tabu; gewählt wird eine Zelle, deren Nachbarn ebenfalls
// frei sind - am liebsten am Rand.

import { measureQuietZones, pointInQuiet } from "../quiet";

export const CELL = 80;
export const TOP_SKIP = 90;
export const EDGE_WIDTH = 64;
const BLOCKING = "p, h1, h2, h3, h4, h5, h6, li, a, button, time, label, input, select, textarea, span, strong, em, small, td, th, figcaption, img, picture, video, svg, canvas, [role='img'], [data-season-anchor], [data-season-perch], [data-season-quiet]";

function hasOwnText(node) {
  return Array.from(node.childNodes || []).some((child) => child.nodeType === 3 && child.textContent.trim().length > 0);
}

/** Helligkeit einer CSS-Farbe (0 dunkel … 1 hell), null für durchsichtig oder unbekannt. */
export function luminance(color) {
  if (!color || typeof color !== "string") return null;
  const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i);
  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (alpha < 0.2) return null;
  return (0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3])) / 255;
}

function defaultProbe(doc) {
  return typeof doc.elementFromPoint === "function" ? (x, y) => doc.elementFromPoint(x, y) : null;
}

/**
 * Ist der Fensterpunkt freie dunkle Fläche? Ohne Sonde (kein Layout, Tests) gilt alles außerhalb der Ruhezonen
 * als frei. Mit Sonde: der Treffer und seine Vorfahren bis zum `<body>` dürfen weder Text, Bild, Karte noch
 * Bedienelement sein, kein Hintergrundbild tragen und keine helle Fläche sein.
 */
export function spotFree(probe, x, y, win = null) {
  if (!probe) return true;
  const hit = probe(x, y);
  if (!hit) return false;
  let node = hit;
  while (node && node.nodeType === 1 && node.tagName !== "BODY" && node.tagName !== "HTML") {
    if (typeof node.matches === "function" && node.matches(BLOCKING)) return false;
    if (hasOwnText(node)) return false;
    if (win && typeof win.getComputedStyle === "function") {
      const style = win.getComputedStyle(node);
      // Ein Bild als Hintergrund des getroffenen Elements sperrt (Foto, Grafik); Muster und Verläufe auf Vorfahren
      // (Raster im Hero) sind weiter dunkle Leerfläche.
      if (node === hit && typeof style.backgroundImage === "string" && style.backgroundImage.includes("url(")) return false;
      const light = luminance(style.backgroundColor);
      if (light !== null && light > 0.22) return false;
    }
    node = node.parentElement;
  }
  return true;
}

/**
 * Freie Zellen im Fenster (Fensterkoordinaten der Zellmitte) mit Punkten: ein Punkt je freier Nachbarzelle (bis 8),
 * zwei Punkte extra am linken oder rechten Rand. Sortiert nach Punkten, die besten zuerst.
 */
export function freeSpots(doc = document, win = typeof window === "undefined" ? null : window, { zones = measureQuietZones(doc, win), probe = defaultProbe(doc), cell = CELL, skipTop = TOP_SKIP, margin = 24 } = {}) {
  const width = (win && win.innerWidth) || 1280;
  const height = (win && win.innerHeight) || 800;
  const cols = Math.max(0, Math.floor((width - 2 * margin) / cell));
  const rows = Math.max(0, Math.floor((height - skipTop - margin) / cell));
  const free = [];
  for (let r = 0; r < rows; r += 1) {
    free.push([]);
    for (let c = 0; c < cols; c += 1) {
      const x = margin + c * cell + cell / 2;
      const y = skipTop + r * cell + cell / 2;
      free[r].push(!pointInQuiet({ x, y }, zones, { fixed: true }) && spotFree(probe, x, y, win));
    }
  }
  const spots = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!free[r][c]) continue;
      let score = 0;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if ((dr || dc) && free[r + dr] && free[r + dr][c + dc]) score += 1;
        }
      }
      const edge = c < cols * 0.25 || c >= cols * 0.75;
      spots.push({ x: margin + c * cell + cell / 2, y: skipTop + r * cell + cell / 2, score: score + (edge ? 2 : 0), edge });
    }
  }
  return spots.sort((a, b) => b.score - a.score);
}

/** Eine Zelle, deren Nachbarn alle frei sind (Punkte ≥ 8); notfalls eine mit mindestens fünf; sonst nichts. */
export function chooseSpot(spots, rng = Math.random) {
  const best = spots.filter((spot) => spot.score >= 8);
  const pool = best.length ? best : spots.filter((spot) => spot.score >= 5);
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/** Ist die Randspalte (links oder rechts) frei? Vier Punkte über die Höhe, alle außerhalb der Ruhezonen und frei. */
export function edgeFree(doc = document, win = typeof window === "undefined" ? null : window, side = "left", { zones = measureQuietZones(doc, win), probe = defaultProbe(doc), width = EDGE_WIDTH } = {}) {
  const innerWidth = (win && win.innerWidth) || 1280;
  const height = (win && win.innerHeight) || 800;
  const x = side === "left" ? width / 2 : innerWidth - width / 2;
  return [0.25, 0.45, 0.65, 0.85].every((fraction) => {
    const y = height * fraction;
    return !pointInQuiet({ x, y }, zones, { fixed: true }) && spotFree(probe, x, y, win);
  });
}

/** Nebelstärke 0,35–1: voll am Seitenanfang (erste Fensterhöhe) und am Ende (letzte), dazwischen leise. */
export function fogStrength({ scrollY = 0, innerHeight = 800, scrollHeight = 2400 } = {}) {
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const top = clamp(1 - scrollY / Math.max(1, innerHeight * 0.9));
  const remaining = scrollHeight - (scrollY + innerHeight);
  const bottom = clamp(1 - remaining / Math.max(1, innerHeight * 0.8));
  return Math.round((0.35 + 0.65 * Math.max(top, bottom)) * 100) / 100;
}
