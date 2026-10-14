// Fast Lap vor Ort (#1585): Versuche, Schlüssel einer Zeile (auch für Gäste ohne Konto) und der Ziffernblock der
// Schnelleingabe. Die Zahl der Versuche kommt immer vom Server (`max_attempts`, null = unbegrenzt) - nichts ist fest
// auf 3. Die Grenze setzt der Server durch; hier steht nur, was angezeigt wird.
import { formatLapTime, parseLapTime } from "./laptime";

/** Gründe für „ungültig“ mit einem Tipp - der Server verlangt mindestens 5 Zeichen. */
export const INVALID_REASONS = Object.freeze(["Strecke verlassen", "Abkürzung", "Kollision", "Runde nicht beendet"]);

function limitOf(max) {
  const value = Number(max);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** „Versuch 2 von 3“ - der Versuch, der gerade gefahren wird. Ohne Grenze „Versuch 7“. */
export function attemptLabel(used, max) {
  const done = Math.max(0, Number(used) || 0);
  const limit = limitOf(max);
  if (limit === null) return `Versuch ${done + 1}`;
  if (done >= limit) return limit === 1 ? "Versuch gefahren" : `Alle ${limit} Versuche gefahren`;
  return `Versuch ${done + 1} von ${limit}`;
}

/** Die Spalte „Versuche“: „2 / 3“ oder ohne Grenze nur „2“. */
export function attemptsCell(count, max) {
  const done = Math.max(0, Number(count) || 0);
  const limit = limitOf(max);
  return limit === null ? String(done) : `${done} / ${limit}`;
}

export function canDriveAgain(used, max) {
  const limit = limitOf(max);
  return limit === null || (Number(used) || 0) < limit;
}

/** Versuche einer Person aus der Zeitenliste der Strecke - `who` ist {kind: "user"|"guest", id}. */
export function attemptsUsedBy(times, who, scope = "official") {
  if (!who?.id) return 0;
  return (times || []).filter((time) => {
    if (who.kind === "guest") return !time.user_id && time.guest_id === who.id;
    return time.user_id === who.id && (time.score_scope || "official") === scope;
  }).length;
}

/** Der Schlüssel einer Zeile in Tabelle, TV und Liste: bei Gästen `guest-…`, sonst die Kennung des Kontos. */
export function participantKey(entry) {
  return entry?.participant_id || entry?.user_id || "";
}

const MAX_INPUT = 9; // „12:34,567“

/** Eine Taste des Ziffernblocks auf den Text anwenden: Ziffern, „:“, „,“ (oder „.“), „back“, „clear“. */
export function keypadInput(text, key) {
  const current = String(text ?? "");
  if (key === "clear") return "";
  if (key === "back") return current.slice(0, -1);
  const symbol = key === "." ? "," : key;
  if (/^\d$/.test(symbol)) {
    const comma = current.indexOf(",");
    if (comma >= 0 && current.length - comma > 3) return current;
    return current.length >= MAX_INPUT ? current : current + symbol;
  }
  if (!current || !/\d$/.test(current)) return current;
  if (symbol === ":" && !current.includes(":") && !current.includes(",")) return `${current}:`;
  if (symbol === "," && !current.includes(",")) return `${current},`;
  return current;
}

/** Was unter dem Eingabefeld steht: die gelesene Zeit, „nicht lesbar“ oder nichts. */
export function timePreview(text) {
  const ms = parseLapTime(text);
  if (ms === null) return { ms: null, text: "", ok: false };
  if (Number.isNaN(ms) || ms <= 0) return { ms: null, text: "nicht lesbar", ok: false };
  return { ms, text: formatLapTime(ms), ok: true };
}

/** Das Feld „Versuche je Person“: die eingestellte Zahl, leer = unbegrenzt. Neue Challenges starten mit 3. */
export function attemptsField(challenge) {
  if (!challenge) return "3";
  return challenge.unlimited_attempts === false && Number(challenge.max_attempts) > 0 ? String(challenge.max_attempts) : "";
}

/** Aus dem Feld, was der Server versteht: leer = unbegrenzt, sonst 1 bis 100 - oder `{ error }`. */
export function attemptsPayload(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { unlimited_attempts: true, max_attempts: null };
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < 1 || value > 100) return { error: "Versuche bitte als ganze Zahl zwischen 1 und 100 - oder leer für unbegrenzt." };
  return { unlimited_attempts: false, max_attempts: value };
}
