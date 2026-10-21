import { formatDateTime } from "./format";

// Die wirksamen Check-in-Zeiten (#1938, App-Teil) - dieselbe Regel wie im Web (frontend/src/lib/checkInTimes.js): was
// für Spieler wirklich galt. Der Server zieht „Check-in öffnet“ und „Check-in endet“ beim Check-in von Hand nach; ältere
// Turniere (oder ein Ende, das von Hand vor die Öffnung gesetzt wurde) zeigen hier trotzdem nie „ab 10:56 bis 10:48“ und
// keine Öffnung in der Zukunft, während der Check-in schon läuft. Ist er früher beendet, gilt das wirkliche Ende.

type CheckInFields = {
  status?: string | null;
  check_in_from?: string | null;
  check_in_until?: string | null;
  check_in_closed_at?: string | null;
};

// Ab diesen Status hat der Check-in begonnen (oder ist übersprungen) - eine Öffnung in der Zukunft gilt nicht mehr.
const OPENED = new Set(["check_in", "checkin_open", "live", "paused", "completed", "results_published", "archived"]);

function msOf(value?: string | null): number {
  if (!value) return NaN;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

/** `{ from, until }` als Zeiten vom Server oder `null`: das wirkliche Ende (früher beendet), ohne unglaubwürdige Öffnung. */
export function effectiveCheckIn(tournament: CheckInFields | null | undefined, now: number = Date.now()): { from: string | null; until: string | null } {
  const t = tournament || {};
  const plannedUntil = msOf(t.check_in_until);
  const closed = msOf(t.check_in_closed_at);
  const closedEarly = Number.isFinite(closed) && (!Number.isFinite(plannedUntil) || closed < plannedUntil);
  const until = closedEarly ? t.check_in_closed_at || null : (Number.isFinite(plannedUntil) ? t.check_in_until || null : null);
  const untilMs = msOf(until);
  const fromMs = msOf(t.check_in_from);
  const opened = OPENED.has(String(t.status || "")) || Number.isFinite(closed);
  const credible = Number.isFinite(fromMs) && !(Number.isFinite(untilMs) && fromMs > untilMs) && !(opened && fromMs > now);
  return { from: credible ? t.check_in_from || null : null, until: until || null };
}

/** Die Zeile „ab … bis …“ - ohne glaubwürdige Öffnung nur „bis …“. */
export function checkInLine(tournament: CheckInFields | null | undefined, now: number = Date.now()): string {
  const { from, until } = effectiveCheckIn(tournament, now);
  return [from ? `ab ${formatDateTime(from)}` : "", until ? `bis ${formatDateTime(until)}` : ""].filter(Boolean).join(" ");
}
