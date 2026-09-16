import { API } from "@/lib/api";

// Web Vitals je Seite (#265): LCP, FCP und TTFB gehören zur Seite, mit der
// der Besuch begann; CLS und INP werden beim Verlassen gemeldet und der
// Seite zugeschrieben, auf der man dann steht. Gesendet wird anonym am Ende
// des Besuchs per sendBeacon - keine Adresse, kein Nutzer, keine Cookies.
// Wer „Do Not Track“ oder Global Privacy Control gesetzt hat, sendet nichts.

const MAX_ENTRIES = 12;
const DYNAMIC_ROOTS = new Set([
  "news", "events", "tournaments", "teams", "u", "players", "members", "galerie", "gallery",
  "fastlap", "f1", "seasons", "servers", "references", "sponsors", "partners", "messages", "leagues",
]);
const STATIC_PATHS = new Set([
  "/members/area", "/members/benefits", "/members/documents", "/members/news", "/members/membership",
  "/tournaments/new", "/events/new", "/news/new",
]);

function looksLikeId(segment) {
  return /\d/.test(segment) || segment.length > 32;
}

/** Aus einer Adresse die Route-Vorlage: /news/halloween-2026 → /news/:slug. */
export function vitalsRoute(pathname) {
  const path = String(pathname || "/").split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  if (path === "/" || STATIC_PATHS.has(path)) return path;
  const segments = path.split("/").filter(Boolean);
  const [root, second, ...rest] = segments;
  const out = [root];
  if (second !== undefined) {
    if (root === "admin") out.push(second);
    else if (DYNAMIC_ROOTS.has(root)) out.push(":slug");
    else out.push(looksLikeId(second) ? ":id" : second);
  }
  for (const segment of rest) out.push(looksLikeId(segment) ? ":id" : segment);
  return `/${out.join("/")}`.slice(0, 120);
}

export function deviceClass() {
  if (typeof window === "undefined") return "desktop";
  const narrow = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;
  const mobileAgent = /Mobi|Android/i.test(window.navigator?.userAgent || "");
  return narrow || mobileAgent ? "mobile" : "desktop";
}

export function trackingDeclined() {
  if (typeof navigator === "undefined") return false;
  return navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true;
}

export function serializeEntries(entries) {
  return JSON.stringify({ entries: entries.slice(0, MAX_ENTRIES) });
}

const queue = [];
let started = false;

export function queueVital(entry) {
  queue.push({ name: entry.name, value: entry.value, route: entry.route, device: entry.device || deviceClass() });
  if (queue.length >= MAX_ENTRIES) flushVitals();
}

export function flushVitals() {
  if (!queue.length) return false;
  const body = serializeEntries(queue);
  queue.length = 0;
  const url = `${API}/ops/vitals`;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      return navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    }
    fetch(url, { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export function pendingVitals() {
  return queue.slice();
}

export function resetVitals() {
  queue.length = 0;
  started = false;
}

/**
 * Startet die Messung. `load` liefert das web-vitals-Modul (im Test ein
 * Ersatz), damit der Einstieg der Seite klein bleibt.
 */
export async function startVitals({ load = () => import("web-vitals"), locationRef = () => window.location } = {}) {
  if (started || typeof window === "undefined" || trackingDeclined()) return false;
  started = true;
  const loadRoute = vitalsRoute(locationRef().pathname);
  let vitals;
  try {
    vitals = await load();
  } catch {
    return false;
  }
  const report = (metric, fixedRoute) => queueVital({ name: metric.name, value: metric.value, route: fixedRoute || vitalsRoute(locationRef().pathname) });
  vitals.onLCP?.((metric) => report(metric, loadRoute));
  vitals.onFCP?.((metric) => report(metric, loadRoute));
  vitals.onTTFB?.((metric) => report(metric, loadRoute));
  vitals.onCLS?.((metric) => report(metric));
  vitals.onINP?.((metric) => report(metric));
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushVitals();
  });
  window.addEventListener("pagehide", () => flushVitals());
  return true;
}
