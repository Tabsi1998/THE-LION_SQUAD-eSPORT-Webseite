const DONE_STATUSES = ["completed", "results_published", "archived", "cancelled", "beendet", "archiv"];
const ACTIVE_TERMS = ["live", "check", "open", "registration", "anmeldung", "aktiv", "running", "progress"];

function timestamp(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function phaseText(phase) {
  if (!phase) return "";
  if (typeof phase === "string") return phase;
  return [phase.state, phase.label, phase.countdown_kind].filter(Boolean).join(" ");
}

function statusText(status, phase) {
  return `${status || ""} ${phaseText(phase)}`.toLowerCase();
}

function isSameDay(time, now = Date.now()) {
  const a = new Date(time);
  const b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function sortBucket(date, status, phase) {
  const text = statusText(status, phase);
  const time = timestamp(date);
  const done = DONE_STATUSES.some((term) => text.includes(term));
  const active = ACTIVE_TERMS.some((term) => text.includes(term));
  if (active && !done) return 0;
  if (time == null) return 4;
  if (!done && isSameDay(time)) return 0;
  if (!done && time >= Date.now()) return 1;
  if (done) return 3;
  return 2;
}

export function compareByNearestDate(
  aDate,
  bDate,
  aStatus,
  bStatus,
  aPhase,
  bPhase,
) {
  const aBucket = sortBucket(aDate, aStatus, aPhase);
  const bBucket = sortBucket(bDate, bStatus, bPhase);
  if (aBucket !== bBucket) return aBucket - bBucket;

  const aTime = timestamp(aDate);
  const bTime = timestamp(bDate);
  if (aTime == null && bTime == null) return 0;
  if (aTime == null) return 1;
  if (bTime == null) return -1;

  if (aBucket === 2 || aBucket === 3) return bTime - aTime;
  return aTime - bTime;
}

export function sortByNearestDate(items, dateField = "start_date") {
  return [...(items || [])].sort((a, b) =>
    compareByNearestDate(
      a?.[dateField],
      b?.[dateField],
      a?.status,
      b?.status,
      a?.public_phase || a?.event_phase,
      b?.public_phase || b?.event_phase,
    )
  );
}
