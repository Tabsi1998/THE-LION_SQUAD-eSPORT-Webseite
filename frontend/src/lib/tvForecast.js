// „Als Nächstes“ mit Prognose am TV (#1564): wann ein Spiel ungefähr losgeht und wo. Die Zeit kommt aus dem Planer
// (services/match_scheduler, #1569: `scheduled_at`, `schedule_forecast` = die Plätze stehen noch nicht fest). Der
// Verzug kommt aus der Halle: Ein Spiel beginnt frühestens, wenn seine Station frei ist - läuft dort gerade ein Spiel,
// ist das seine Startzeit plus geplanter Dauer, und überzieht es, „jetzt“. Ist die geplante Zeit schon vorbei und das
// Spiel noch nicht gestartet, beginnt es frühestens jetzt. Alles reine Rechnung - die Uhr gibt der Aufrufer.
import { isMatchDone } from "@/lib/slotSource";
import { isLiveMatch, stationName } from "@/lib/tvLive";
import { asInstant, viennaTime } from "@/lib/vienna";

const MINUTE = 60000;
const DEFAULT_MINUTES = 30;
// Ab so viel Verschiebung sagt der TV „Verzug“ - darunter ist es Rauschen.
export const DELAY_SHOWN_FROM = 5;
// Mehr als drei Stunden hinter dem Plan ist kein Verzug mehr, sondern ein alter Plan: dann nur die Station.
export const STALE_AFTER = 180;
const OPEN = new Set(["pending", "preview", "ready", "scheduled"]);

function timeOf(value) {
  if (!value) return null;
  const time = asInstant(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function minutesOf(match) {
  return Number(match?.duration_minutes || match?.settings?.duration_minutes || DEFAULT_MINUTES) || DEFAULT_MINUTES;
}

/** Die Station im Klartext: aus dem Spiel, sonst aus der Liste der Stationen. */
function stationOf(match, stations) {
  const own = stationName(match);
  if (own) return own;
  const station = (stations || []).find((row) => row?.id && row.id === match?.station_id);
  const raw = String(station?.name || station?.label || "").trim();
  if (!raw) return "";
  return /^\d+$/.test(raw) ? `Station ${raw}` : raw;
}

/** Ab wann die Station frei ist: Ende des dort laufenden Spiels (überzogen: jetzt) - ohne laufendes Spiel `null`. */
function stationFreeAt(stationId, matches, now) {
  if (!stationId) return null;
  let free = null;
  for (const match of matches || []) {
    if (match?.station_id !== stationId || !isLiveMatch(match)) continue;
    const start = timeOf(match.started_at) ?? timeOf(match.scheduled_at) ?? now;
    const end = Math.max(now, start + minutesOf(match) * MINUTE);
    free = free === null ? end : Math.max(free, end);
  }
  return free;
}

/**
 * Die Prognose eines offenen Spiels: `at` geplant, `eta` voraussichtlich, `delayMinutes`, `forecast` (Zeit des Planers
 * für noch offene Plätze), `station` und `delayText` („12 Min. Verzug“, unter DELAY_SHOWN_FROM leer).
 */
export function forecastOf(match, { matches = [], stations = [], now = Date.now() } = {}) {
  const at = timeOf(match?.scheduled_at);
  const free = stationFreeAt(match?.station_id, matches, now);
  let eta = at;
  if (eta !== null) {
    // Erst ab einer Minute zählt die Station - Sekunden zwischen Planer und Start sind kein Verzug.
    if (free !== null && free - eta >= MINUTE) eta = free;
    if (eta < now) eta = now;
  }
  const late = at === null || eta === null ? 0 : Math.max(0, Math.round((eta - at) / MINUTE));
  const stale = late > STALE_AFTER;
  const delayMinutes = stale ? 0 : late;
  return {
    match,
    at,
    eta: stale ? null : eta,
    stale,
    delayMinutes,
    forecast: Boolean(match?.schedule_forecast),
    station: stationOf(match, stations),
    delayText: delayMinutes >= DELAY_SHOWN_FROM ? `${delayMinutes} Min. Verzug` : "",
  };
}

/** „ca. 16:40 · Switch 2“ - ohne Uhrzeit nur die Station. Planung ist nie auf die Minute genau, deshalb immer „ca.“. */
export function forecastText(entry) {
  if (!entry) return "";
  const time = entry.eta === null || entry.eta === undefined ? "" : `ca. ${viennaTime(entry.eta, { hour: "2-digit", minute: "2-digit" })}`;
  return [time, entry.station].filter(Boolean).join(" · ");
}

function isOpen(match) {
  const status = String(match?.status || "pending").toLowerCase();
  return Boolean(match?.id) && OPEN.has(status) && !isMatchDone(match) && !isLiveMatch(match);
}

/**
 * Die nächsten offenen Spiele mit Uhrzeit oder Station, nach ihrer Prognose (dann geplanter Zeit, Runde, Reihenfolge).
 * `exclude`: Spiele, die schon anders stehen (z. B. aufgerufen).
 */
export function nextUp(matches = [], { stations = [], now = Date.now(), limit = 3, exclude = null } = {}) {
  return (matches || [])
    .filter((match) => isOpen(match) && (match.scheduled_at || match.station_id) && !(exclude && exclude.has(match.id)))
    .map((match) => forecastOf(match, { matches, stations, now }))
    .sort((a, b) => (a.eta ?? Number.MAX_SAFE_INTEGER) - (b.eta ?? Number.MAX_SAFE_INTEGER)
      || (a.at ?? Number.MAX_SAFE_INTEGER) - (b.at ?? Number.MAX_SAFE_INTEGER)
      || (a.match.round || 0) - (b.match.round || 0)
      || (a.match.order || 0) - (b.match.order || 0))
    .slice(0, limit);
}
