// Zeremonie einmal je Konto (#2450): „gesehen“ steht am Server, Website und App teilen denselben Stand. Bisher merkte
// sich jeder Browser selbst, was er schon gefeiert hatte - dieselbe Zeremonie kam dadurch am PC, im Handy-Browser und in
// der App je einmal.
//
// - `ceremonyState(userId)`: der Stand am Server (ungesehene Stufen, gesehener Level, gesehene Neuberechnungen). Beim
//   ersten Mal meldet der Browser einmalig, was er lokal schon als gesehen kannte (Altbestand) - danach zählt nur der
//   Server. Kennt der Server das noch nicht (ältere Fassung), kommt null: dann bleibt alles wie bisher im Browser.
// - `markSeen(userId, …)`: nach jeder Art des Schließens, per fetch mit keepalive - kommt auch an, wenn die Seite gleich
//   danach zugeht.
// - `serverCheck(userId)`: die Prüfung direkt vor dem Anzeigen. Hat ein anderes Gerät die Zeremonie inzwischen
//   geschlossen, fällt sie weg.

import { api, keepaliveRequest } from "@/lib/api";

export const achSeenKey = (id) => `tls_ach_seen:${id}`;
export const levelSeenKey = (uid) => `tls-level-seen:${uid}`;
// Die Sammel-Zeremonie der Neuberechnung (#2340) läuft je Person und Kennung der Neuberechnung einmal.
export const recountSeenKey = (id, marker) => `tls_ach_recount_seen:${id}:${marker}`;
export const importedKey = (id) => `tls_ceremony_imported:${id}`;

/**
 * Ein Aufstieg: mehr Prestige-Sterne, oder gleich viele Sterne und ein höheres Level. Wer ein Prestige zurücknimmt,
 * hat einen Stern weniger und wieder Level 60 - das ist nichts zum Feiern.
 */
export function isLevelGain(prev, next) {
  const prevStars = Number(prev?.prestige || 0);
  const nextStars = Number(next?.prestige || 0);
  if (nextStars !== prevStars) return nextStars > prevStars;
  return Number(next?.level || 0) > Number(prev?.level || 0);
}

/** Der zuletzt gesehene Level-Stand im Browser; ältere Fassungen merkten sich nur die Zahl. */
export function readLevelSeen(key) {
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(key) || "null"); } catch { prev = null; }
  if (typeof prev === "number" || (typeof prev === "string" && /^\d+$/.test(prev))) prev = { level: Number(prev), title: "", prestige: 0 };
  return prev && typeof prev === "object" ? prev : null;
}

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* egal */ }
}

/** Was dieser Browser bisher selbst als gesehen kannte - für die einmalige Meldung an den Server. */
export function legacyReport(userId) {
  const report = {};
  const until = read(achSeenKey(userId));
  if (until) report.seen_until = until;
  const level = readLevelSeen(levelSeenKey(userId));
  if (level && Number(level.level) >= 1) report.level = { level: Number(level.level), title: String(level.title || ""), prestige: Number(level.prestige || 0) };
  const prefix = recountSeenKey(userId, "");
  const markers = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(prefix) && key.length > prefix.length) markers.push(key.slice(prefix.length));
    }
  } catch { /* ohne Speicher keine Neuberechnungen */ }
  if (markers.length) report.recount_markers = markers.slice(0, 20);
  return report;
}

const inflight = new Map();
const unsupported = new Set();
// Was dieser Browser in dieser Sitzung schon geschlossen hat - zählt, bis der Server es bestätigt (die Meldung ist noch
// unterwegs, während schon die nächste Prüfung läuft).
const localSeen = new Map();

function local(userId) {
  if (!localSeen.has(userId)) localSeen.set(userId, { codes: new Set(), level: null, recount: new Set() });
  return localSeen.get(userId);
}

function normalise(userId, data) {
  if (!data || !Array.isArray(data.unseen)) return null;
  const mine = local(userId);
  const serverLevel = data.level && typeof data.level === "object" ? data.level : null;
  const level = mine.level && (!serverLevel || isLevelGain(serverLevel, mine.level)) ? mine.level : serverLevel;
  return {
    unseen: data.unseen.filter((code) => !mine.codes.has(code)),
    level,
    recountSeen: [...new Set([...(data.recount_seen || []), ...mine.recount])],
  };
}

function notSupported(error) {
  return [404, 405].includes(Number(error?.response?.status));
}

/** Länger wartet die Bühne nicht auf den Server - danach gilt das bisherige Verhalten (die Zeremonie kommt). */
export const STATE_TIMEOUT_MS = 4500;

/**
 * Der Stand am Server - oder null (älterer Server, nicht erreichbar, keine Antwort binnen STATE_TIMEOUT_MS): dann gilt
 * das bisherige Verhalten im Browser. Gleichzeitige Aufrufe teilen sich eine Anfrage; jeder spätere fragt neu.
 */
export function ceremonyState(userId) {
  if (!userId || unsupported.has(userId)) return Promise.resolve(null);
  if (inflight.has(userId)) return inflight.get(userId);
  const work = (async () => {
    try {
      // Erst lesen: Ein älterer Server kennt den Weg nicht - dann wird auch nichts gemeldet.
      const { data } = await api.get("/achievements/me/ceremony");
      const state = normalise(userId, data);
      if (!state || read(importedKey(userId))) return state;
      // Einmal je Browser und Konto: den Altbestand melden - erst damit legt der Server den Stand an.
      const { data: imported } = await api.post("/achievements/me/ceremony/import", legacyReport(userId));
      write(importedKey(userId), new Date().toISOString());
      return normalise(userId, imported);
    } catch (error) {
      if (notSupported(error)) unsupported.add(userId);
      return null;
    }
  })();
  let timer = null;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), STATE_TIMEOUT_MS); });
  const request = Promise.race([work, timeout]).finally(() => {
    clearTimeout(timer);
    if (inflight.get(userId) === request) inflight.delete(userId);
  });
  inflight.set(userId, request);
  return request;
}

/** Gesehen - sofort an den Server, auch wenn die Seite danach gleich geschlossen wird. */
export function markSeen(userId, { codes = [], level = null, recountMarker = null } = {}) {
  if (!userId) return;
  const mine = local(userId);
  codes.forEach((code) => mine.codes.add(code));
  if (level && (!mine.level || isLevelGain(mine.level, level))) mine.level = level;
  if (recountMarker) mine.recount.add(recountMarker);
  if (unsupported.has(userId)) return;
  const body = {};
  if (codes.length) body.codes = codes.slice(0, 200);
  if (level) body.level = { level: Number(level.level), title: String(level.title || ""), prestige: Number(level.prestige || 0) };
  if (recountMarker) body.recount_marker = recountMarker;
  if (!Object.keys(body).length) return;
  keepaliveRequest("POST", "/achievements/me/ceremony/seen", body).catch(() => { /* der nächste Abruf zeigt es höchstens noch einmal */ });
}

/**
 * Die Prüfung direkt vor dem Anzeigen (#2450): was ein anderes Gerät inzwischen geschlossen hat, fällt weg. Ohne Stand
 * vom Server (älterer Server, keine Verbindung) bleibt das Paket, wie es ist.
 */
export function serverCheck(userId) {
  return async (entry) => {
    const state = await ceremonyState(userId);
    if (!state) return null;
    const unseen = new Set(state.unseen);
    const marker = entry?.context?.recountMarker;
    const tiers = entry?.context?.recount
      ? (marker && state.recountSeen.includes(marker) ? [] : entry.tiers || [])
      : (entry?.tiers || []).filter((tier) => unseen.has(tier.code));
    const levelUp = entry?.levelUp && (!state.level || isLevelGain(state.level, entry.levelUp)) ? entry.levelUp : null;
    return { tiers, levelUp };
  };
}

/** Nur für Tests: alles Gemerkte vergessen. */
export function resetCeremonySeen() {
  inflight.clear();
  unsupported.clear();
  localSeen.clear();
}
