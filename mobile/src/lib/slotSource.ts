// Klartext statt Platzhalter (#1140): wer in einen noch leeren Platz kommt - dieselbe Übersetzung wie auf der Website
// und am TV (frontend/src/lib/slotSource.js, #1113). Dieselben Fälle prüfen beide (frontend/src/lib/slotSource.cases.json).
//   „W:A:1“ → „Sieger aus A“   im Duell Platz 2 → „Verlierer aus A“   im Durchgang → „Platz 2 aus A“
// Setzplätze bleiben vor dem Start leer (Entscheidung des Betreibers vom 23.09.), „Freilos“ bleibt.
// „L“ zählt wie am Server ab den Weiterkommern: L:A:1 ist der Beste, der nicht weiterkommt (services/match_v2_results).
import { viennaDate, viennaDay, viennaTime } from "./vienna";

export type SlotSource = { type?: string; flow?: string; match_key?: string; rank?: number; seed?: number; raw?: string } | null | undefined;
type MatchLike = {
  match_key?: string | null;
  stage_id?: string | null;
  status?: string | null;
  winner_id?: string | null;
  results?: unknown[] | null;
  slots?: unknown[] | null;
  settings?: Record<string, any> | null;
  scheduled_at?: string | null;
  duration_minutes?: number | null;
};
export type SlotView = { kind: "player" | "bye" | "pending" | "empty"; label: string };

const RAW_RANK = /^([WLR]):([A-Za-z0-9_.-]+):([1-9][0-9]*)$/;
const RAW_BYE = new Set(["bye", "-", "null", "none"]);

/** Die Herkunft eines Platzes - auch aus älteren Daten, die nur den Text („W:A:1“) kennen. */
export function normalizeSource(source: SlotSource): SlotSource {
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

function matchSize(match: MatchLike) {
  const settings = match?.settings || {};
  return Number(settings.match_size || (match?.slots || []).length || 2);
}

/** Der Platz in der Wertung des Herkunftsspiels (wie `_advancement_result_rank`). */
export function absoluteRank(source: SlotSource, fromMatch?: MatchLike) {
  const rank = Number(source?.rank || 0);
  if (source?.flow !== "L") return rank;
  const known = Boolean(fromMatch?.settings && "qualifiers_per_match" in fromMatch.settings);
  const settings = known ? fromMatch?.settings || {} : { qualifiers_per_match: 1, match_size: (fromMatch?.slots || []).length || 2 };
  const size = Number(settings.match_size || (fromMatch?.slots || []).length || 0);
  if (size <= 0) return rank;
  const qualifiers = Math.max(0, Math.min(Number(settings.qualifiers_per_match || 0), size));
  const losers = Math.max(0, size - qualifiers);
  if (rank >= 1 && rank <= losers) return qualifiers + rank;
  return rank;
}

/** „Sieger aus A“, „Verlierer aus A“, „Platz 2 aus A“, „Freilos“ - oder leer (Setzplatz, unbekannt). */
export function sourceLabel(source: SlotSource, findMatch: (key: string) => MatchLike | undefined = () => undefined) {
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

/** Sucht das Herkunftsspiel - Spiel-Kürzel gelten je Phase: `finderFor(matches)(match)(key)`. */
export function finderFor(matches: MatchLike[] = []) {
  const byStage = new Map<string, MatchLike>();
  const anyStage = new Map<string, MatchLike>();
  for (const match of matches || []) {
    if (!match?.match_key) continue;
    byStage.set(`${match.stage_id || ""}::${match.match_key}`, match);
    if (!anyStage.has(match.match_key)) anyStage.set(match.match_key, match);
  }
  return (match: { stage_id?: string | null } | null | undefined) => (key: string) =>
    byStage.get(`${match?.stage_id || ""}::${key}`) || anyStage.get(key);
}

/** Was ein Platz zeigt: Name der Anmeldung, „Freilos“, Klartext, wer kommt - oder nichts (Setzplatz vor dem Start). */
export function describeSlot(
  slot: { registration_id?: string | null; status?: string | null; source?: SlotSource } | null | undefined,
  nameOf: (registrationId: string) => string,
  findMatch?: (key: string) => MatchLike | undefined,
): SlotView {
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
export function isMatchDone(match: MatchLike | null | undefined) {
  if (DONE_STATUSES.has(String(match?.status || ""))) return true;
  if (match?.winner_id) return true;
  return (match?.results || []).length > 0 && ["completed", "archived"].includes(String(match?.status || ""));
}

/** „geplant ca. 14:20 · 30 Minuten“ statt „Zeit noch offen“ - an einem anderen Tag mit Datum, für fertige Spiele nichts. */
export function plannedText(match: MatchLike | null | undefined, now: Date = new Date()) {
  if (!match || isMatchDone(match)) return "";
  const duration = Number(match.duration_minutes || match.settings?.duration_minutes || 0);
  const parts: string[] = [];
  if (match.scheduled_at) {
    const time = viennaTime(match.scheduled_at, { hour: "2-digit", minute: "2-digit" });
    const sameDay = viennaDay(match.scheduled_at) === viennaDay(now);
    const day = sameDay ? "" : `${viennaDate(match.scheduled_at, { day: "2-digit", month: "2-digit" })} `;
    if (time && time !== "Invalid Date") parts.push(`geplant ca. ${day}${time}`);
  }
  if (duration > 0) parts.push(`${duration} Minuten`);
  return parts.join(" · ");
}
