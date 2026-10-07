// Klartext statt Platzhalter (#1113): eine Stelle übersetzt, wer in einen noch leeren Platz kommt - für die
// Turnierseite, den Turnierbaum-TV, den Event-TV und die Spiel-QR-Codes.
//   „W:A:1“ → „Sieger aus A“   im Duell Platz 2 → „Verlierer aus A“   im Durchgang → „Platz 2 aus A“
// Setzplätze bleiben vor dem Start leer (Entscheidung des Betreibers vom 23.09.), „Freilos“ bleibt.
// „L“ zählt wie am Server ab den Weiterkommern: L:A:1 ist der Beste, der nicht weiterkommt (services/match_v2_results).
import { viennaDate, viennaDay, viennaTime } from "@/lib/vienna";

const RAW_RANK = /^([WLR]):([A-Za-z0-9_.-]+):([1-9][0-9]*)$/;
const RAW_BYE = new Set(["bye", "-", "null", "none"]);

/** Die Herkunft eines Platzes - auch aus älteren Daten, die nur den Text („W:A:1“) kennen. */
export function normalizeSource(source) {
  if (!source || typeof source !== "object") return null;
  if (source.type) return source;
  const raw = String(source.raw || "").trim();
  if (!raw) return null;
  if (RAW_BYE.has(raw.toLowerCase())) return { type: "bye", raw };
  if (/^\d+$/.test(raw)) return { type: "seed", seed: Number(raw), raw };
  const match = RAW_RANK.exec(raw);
  if (match) return { type: "rank", flow: match[1], match_key: match[2], rank: Number(match[3]), raw };
  return { type: "unknown", raw };
}

function matchSize(match) {
  const settings = match?.settings || {};
  return Number(settings.match_size || (match?.slots || []).length || 2);
}

/**
 * Der Platz in der Wertung des Herkunftsspiels, den die Herkunft meint (wie `_advancement_result_rank`). Fehlt das
 * Herkunftsspiel oder seine Zahl der Weiterkommer, rechnen wir wie im Duell mit einem Weiterkommer (Spiel um Platz 3).
 */
export function absoluteRank(source, fromMatch) {
  const rank = Number(source?.rank || 0);
  if (source?.flow !== "L") return rank;
  const known = fromMatch?.settings && "qualifiers_per_match" in fromMatch.settings;
  const settings = known ? fromMatch.settings : { qualifiers_per_match: 1, match_size: (fromMatch?.slots || []).length || 2 };
  const size = Number(settings.match_size || (fromMatch?.slots || []).length || 0);
  if (size <= 0) return rank;
  const qualifiers = Math.max(0, Math.min(Number(settings.qualifiers_per_match || 0), size));
  const losers = Math.max(0, size - qualifiers);
  if (rank >= 1 && rank <= losers) return qualifiers + rank;
  return rank;
}

/** „Sieger aus A“, „Verlierer aus A“, „Platz 2 aus A“, „Freilos“ - oder leer (Setzplatz, unbekannt). */
export function sourceLabel(source, findMatch = () => undefined) {
  const normalized = normalizeSource(source);
  if (!normalized) return "";
  if (normalized.type === "bye") return "Freilos";
  if (normalized.type !== "rank" || !normalized.match_key) return "";
  const from = findMatch(normalized.match_key);
  const rank = absoluteRank(normalized, from);
  const key = normalized.match_key;
  if (rank === 1) return `Sieger aus ${key}`;
  if (rank === 2 && (!from || matchSize(from) <= 2)) return `Verlierer aus ${key}`;
  return `Platz ${rank} aus ${key}`;
}

/**
 * Sucht das Herkunftsspiel: Spiel-Kürzel gelten je Phase, deshalb zuerst in der Phase des Spiels mit dem Platz.
 * Gibt eine Funktion zurück, die für ein Spiel die Suche liefert: `finderFor(matches)(match)(key)`.
 */
export function finderFor(matches = []) {
  const byStage = new Map();
  const anyStage = new Map();
  for (const match of matches || []) {
    if (!match?.match_key) continue;
    byStage.set(`${match.stage_id || ""}::${match.match_key}`, match);
    if (!anyStage.has(match.match_key)) anyStage.set(match.match_key, match);
  }
  return (match) => (key) => byStage.get(`${match?.stage_id || ""}::${key}`) || anyStage.get(key);
}

/**
 * Was ein Platz zeigt: `kind` „player“ (Name der Anmeldung), „bye“ (Freilos), „pending“ (Klartext, wer kommt) oder
 * „empty“ (Setzplatz vor dem Start, nichts bekannt). `nameOf(registrationId)` liefert den Namen einer Anmeldung.
 */
export function describeSlot(slot, nameOf, findMatch) {
  const registrationId = slot?.registration_id;
  if (registrationId) return { kind: "player", label: nameOf(registrationId) || "" };
  const status = String(slot?.status || "").toLowerCase();
  const source = normalizeSource(slot?.source);
  if (status === "bye" || status === "walkover" || source?.type === "bye") return { kind: "bye", label: "Freilos" };
  const label = sourceLabel(source, findMatch);
  return label ? { kind: "pending", label } : { kind: "empty", label: "" };
}

const DONE_STATUSES = new Set(["completed", "archived", "forfeit", "bye", "cancelled"]);

/** Ist das Spiel vorbei (gespielt, gewertet, abgesagt)? */
export function isMatchDone(match) {
  if (DONE_STATUSES.has(match?.status)) return true;
  if (match?.winner_id) return true;
  return (match?.results || []).length > 0 && ["completed", "archived"].includes(match?.status);
}

/** „Station 1“ - auch wenn die Station nur „1“ heißt. */
export function stationLabel(match) {
  const station = match?.station_label || match?.station_name || match?.station?.name || match?.station_id || "";
  if (!station) return "";
  return /^station\b/i.test(station) ? station : `Station ${station}`;
}

/**
 * „geplant ca. 14:20 · 30 Minuten“ (#1113) statt „Keine Station · 30 Min.“ - an einem anderen Tag mit Datum, für
 * fertige Spiele nichts.
 */
export function plannedText(match, now = new Date()) {
  if (!match || isMatchDone(match)) return "";
  const duration = Number(match.duration_minutes || match.settings?.duration_minutes || 0);
  const parts = [];
  if (match.scheduled_at) {
    const time = viennaTime(match.scheduled_at, { hour: "2-digit", minute: "2-digit" });
    const sameDay = viennaDay(match.scheduled_at) === viennaDay(now);
    const day = sameDay ? "" : `${viennaDate(match.scheduled_at, { day: "2-digit", month: "2-digit" })} `;
    if (time && time !== "Invalid Date") parts.push(`geplant ca. ${day}${time}`);
  }
  if (duration > 0) parts.push(`${duration} Minuten`);
  return parts.join(" · ");
}

/**
 * Kürzel für Spieler ohne Bild (#833, #1113): die Anfangsbuchstaben von bis zu zwei Wörtern - auch bei
 * zusammengeschriebenen Namen: NeonFalke → NF, KartKönigin → KK, Max → M, „Neon Falke“ → NF.
 */
export function initials(label) {
  const text = String(label || "").trim();
  if (!text) return "";
  let words = text.split(/[\s_.-]+/).filter(Boolean);
  if (words.length === 1) {
    const parts = words[0].replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").split(" ").filter(Boolean);
    if (parts.length > 1) words = parts;
  }
  return words.slice(0, 2).map((word) => [...word][0] || "").join("").toUpperCase();
}
