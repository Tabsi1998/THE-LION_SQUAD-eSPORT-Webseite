import { formatDateTime } from "@/lib/datetime";

// Die wirksamen Check-in-Zeiten (#1938): was für Spieler wirklich galt. Der Server zieht „Check-in öffnet“ und „Check-in
// endet“ beim Check-in von Hand nach; ältere Turniere (oder ein Ende, das von Hand vor die Öffnung gesetzt wurde) zeigen
// hier trotzdem nie „ab 10:56 bis 10:48“ und keine Öffnung in der Zukunft, während der Check-in schon läuft.

// Ab diesen Status hat der Check-in begonnen (oder ist übersprungen) - eine Öffnung in der Zukunft gilt nicht mehr.
const OPENED = new Set(["check_in", "checkin_open", "live", "paused", "completed", "results_published", "archived"]);

function msOf(value) {
  if (!value) return NaN;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

/** `{ from, until }` als ISO-Zeiten oder `null`: das wirkliche Ende (früher beendet), ohne unglaubwürdige Öffnung. */
export function effectiveCheckIn(tournament, now = Date.now()) {
  const t = tournament || {};
  const plannedUntil = msOf(t.check_in_until);
  const closed = msOf(t.check_in_closed_at);
  const closedEarly = Number.isFinite(closed) && (!Number.isFinite(plannedUntil) || closed < plannedUntil);
  const until = closedEarly ? t.check_in_closed_at : (Number.isFinite(plannedUntil) ? t.check_in_until : null);
  const untilMs = msOf(until);
  const fromMs = msOf(t.check_in_from);
  const opened = OPENED.has(String(t.status || "")) || Number.isFinite(closed);
  const credible = Number.isFinite(fromMs) && !(Number.isFinite(untilMs) && fromMs > untilMs) && !(opened && fromMs > now);
  return { from: credible ? t.check_in_from : null, until: until || null };
}

/** Die Zeile „ab … bis …“ für „Dein Stand“ - ohne glaubwürdige Öffnung nur „bis …“. */
export function checkInLine(tournament, now = Date.now()) {
  const { from, until } = effectiveCheckIn(tournament, now);
  return [from ? `ab ${formatDateTime(from)}` : "", until ? `bis ${formatDateTime(until)}` : ""].filter(Boolean).join(" ");
}
