// Was die Startseite aus den eigenen Terminen macht.
//
// "Heute und Live" ist nur, was heute stattfindet oder gerade läuft. Vorher
// zählte jede offene Anmeldung als "live", und Halloween stand im September
// unter "Heute" - und gleich darunter noch einmal unter "nächste Termine" (#212).

export type HomeItem = {
  id: string;
  kind: "tournament" | "event";
  title: string;
  date?: string | null;
  status?: string | null;
  phaseState?: string | null;
  phaseLabel?: string | null;
  detail?: string | null;
  bannerUrl?: string | null;
  targetId?: string;
  registrationStatus?: string | null;
};

const LIVE_PHASES = new Set(["live", "check_in"]);
const LIVE_STATUSES = new Set(["live", "in_progress", "checkin_open", "check_in", "paused"]);

export function isSameLocalDay(value: string | null | undefined, now: Date) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

export function isLiveOrToday(item: HomeItem, now: Date = new Date()) {
  if (LIVE_PHASES.has(String(item.phaseState || "").toLowerCase())) return true;
  if (LIVE_STATUSES.has(String(item.status || "").toLowerCase())) return true;
  return isSameLocalDay(item.date, now);
}

const homeKey = (item: HomeItem) => `${item.kind}-${item.id}`;

/**
 * Teilt die Terminliste auf: was heute und live ist, und was danach kommt.
 * Ein Termin steht nur in einer der beiden Listen.
 */
export function splitHomeTimeline(items: HomeItem[], now: Date = new Date(), { liveLimit = 3, nextLimit = 4 } = {}) {
  const live = items.filter((item) => isLiveOrToday(item, now));
  const liveKeys = new Set(live.map(homeKey));
  const next = items.filter((item) => !liveKeys.has(homeKey(item)));
  return {
    live: live.slice(0, liveLimit),
    next: next.slice(0, nextLimit),
    moreCount: Math.max(0, next.length - nextLimit),
  };
}

// Dieselbe Regel wie im Backend (_still_relevant in mobile_routes.py): ein
// Termin ist offen, solange er nicht beendet oder abgesagt ist und heute oder
// später endet. Der Events-Tab zeigt sonst Beendetes und Abgesagtes zwischen
// dem, was ansteht (#241).
const DONE_STATUSES = new Set(["completed", "results_published", "archived", "cancelled", "finished", "closed"]);

export type DatedItem = { status?: string | null; date?: string | null; endDate?: string | null };

function startOfLocalDay(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function isStillRelevant(item: DatedItem, now: Date = new Date()) {
  if (DONE_STATUSES.has(String(item.status || "").toLowerCase())) return false;
  const end = Date.parse(item.endDate || item.date || "");
  if (Number.isNaN(end)) return true;
  return end >= startOfLocalDay(now);
}

/** Offenes zuerst; Vergangenes getrennt und neueste zuerst. */
export function splitOpenAndPast<T extends DatedItem>(items: T[], now: Date = new Date()) {
  const open = items.filter((item) => isStillRelevant(item, now));
  const past = items
    .filter((item) => !isStillRelevant(item, now))
    .sort((a, b) => (Date.parse(b.date || "") || 0) - (Date.parse(a.date || "") || 0));
  return { open, past };
}

export type SeasonSummary = {
  name?: string | null;
  my_rank?: number | null;
  my_points?: number | null;
  participant_count?: number | null;
  leader?: { display_name?: string | null; points?: number | null } | null;
};

/** Eine Zeile zur Jahreswertung: die eigene Platzierung, sonst die Spitze. */
export function seasonLine(season: SeasonSummary | null | undefined) {
  if (!season) return "";
  if (season.my_rank) {
    const points = season.my_points ?? 0;
    return `Du: Platz ${season.my_rank} von ${season.participant_count || season.my_rank} · ${points} ${points === 1 ? "Punkt" : "Punkte"}`;
  }
  if (season.leader?.display_name) {
    return `Vorn: ${season.leader.display_name} · ${season.leader.points ?? 0} Punkte`;
  }
  return "Noch keine Punkte vergeben.";
}
