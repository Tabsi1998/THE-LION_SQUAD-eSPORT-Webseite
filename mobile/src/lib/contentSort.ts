const DONE_STATUSES = ["completed", "results_published", "archived", "cancelled", "beendet", "archiv"];
const ACTIVE_TERMS = ["live", "check", "open", "registration", "anmeldung", "aktiv", "running", "progress"];

function timestamp(value?: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function statusText(status?: string | null, phase?: string | null) {
  return `${status || ""} ${phase || ""}`.toLowerCase();
}

function sortBucket(date?: string | null, status?: string | null, phase?: string | null) {
  const text = statusText(status, phase);
  const time = timestamp(date);
  const done = DONE_STATUSES.some((term) => text.includes(term));
  const active = ACTIVE_TERMS.some((term) => text.includes(term));
  if (active && !done) return 0;
  if (time == null) return 4;
  if (!done && time >= Date.now()) return 1;
  if (!done && new Date(time).toDateString() === new Date().toDateString()) return 0;
  if (done) return 3;
  return 2;
}

export function compareByNearestDate(
  aDate?: string | null,
  bDate?: string | null,
  aStatus?: string | null,
  bStatus?: string | null,
  aPhase?: string | null,
  bPhase?: string | null,
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
