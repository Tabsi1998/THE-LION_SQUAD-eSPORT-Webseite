// Was das Dashboard aus den eigenen Terminen macht (#256) - dieselben Regeln
// wie die App-Startseite (mobile/src/lib/dashboard.ts) und das Backend
// (_still_relevant in mobile_routes.py): offen ist, was nicht beendet oder
// abgesagt ist und heute oder später endet; "Heute und Live" ist, was heute
// stattfindet oder gerade läuft. Reine Logik ohne React.

const LIVE_PHASES = new Set(["live", "check_in"]);
const LIVE_STATUSES = new Set(["live", "in_progress", "checkin_open", "check_in", "paused"]);
const DONE_STATUSES = new Set(["completed", "results_published", "archived", "cancelled", "finished", "closed"]);

export const VIENNA = "Europe/Vienna";

function startOfLocalDay(now) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function isSameLocalDay(value, now) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

export function isStillRelevant(item, now = new Date()) {
  if (DONE_STATUSES.has(String(item?.status || "").toLowerCase())) return false;
  const end = Date.parse(item?.endDate || item?.date || "");
  if (Number.isNaN(end)) return true;
  return end >= startOfLocalDay(now);
}

export function isLiveOrToday(item, now = new Date()) {
  if (LIVE_PHASES.has(String(item?.phaseState || "").toLowerCase())) return true;
  if (LIVE_STATUSES.has(String(item?.status || "").toLowerCase())) return true;
  return isSameLocalDay(item?.date, now);
}

const REGISTRATION_LABELS = {
  approved: "Angemeldet",
  registered: "Angemeldet",
  checked_in: "Eingecheckt",
  pending: "Wartet auf Freigabe",
  waitlist: "Warteliste",
  waitlisted: "Warteliste",
  declined: "Abgelehnt",
  cancelled: "Abgemeldet",
};

export function registrationLabel(status) {
  const key = String(status || "").toLowerCase();
  return REGISTRATION_LABELS[key] || "";
}

// Turniere und Events der Antwort von /api/mobile/dashboard als eine Liste.
export function timelineItems(data) {
  const me = data?.me || {};
  const tournaments = (me.tournaments || []).map((row) => ({
    id: row.id,
    kind: "tournament",
    title: row.title || "Turnier",
    date: row.start_date || null,
    endDate: row.end_date || null,
    status: row.status || null,
    phaseState: row.public_phase?.state || null,
    phaseLabel: row.public_phase?.label || null,
    detail: row.game?.display_name || row.game?.name || row.game_name || row.format_label || "",
    registrationStatus: row.my_registration?.status || null,
    href: `/tournaments/${row.slug || row.id}`,
  }));
  const events = (me.events || []).map((row) => ({
    id: row.id,
    kind: "event",
    title: row.title || row.name || "Event",
    date: row.start_date || row.date || null,
    endDate: row.end_date || null,
    status: row.status || null,
    phaseState: row.public_phase?.state || null,
    phaseLabel: row.public_phase?.label || null,
    detail: [row.location, row.city].filter(Boolean).join(", "),
    registrationStatus: row.own_registration?.status || null,
    href: `/events/${row.slug || row.id}`,
  }));
  return [...tournaments, ...events]
    .sort((a, b) => (Date.parse(a.date || "") || 0) - (Date.parse(b.date || "") || 0));
}

const homeKey = (item) => `${item.kind}-${item.id}`;

// Offen, dann geteilt: heute und live zuerst, dann was danach kommt. Ein
// Termin steht nur in einer der beiden Listen.
export function splitHomeTimeline(items, now = new Date(), { liveLimit = 3, nextLimit = 5 } = {}) {
  const open = (items || []).filter((item) => isStillRelevant(item, now));
  const live = open.filter((item) => isLiveOrToday(item, now));
  const liveKeys = new Set(live.map(homeKey));
  const next = open.filter((item) => !liveKeys.has(homeKey(item)));
  return {
    live: live.slice(0, liveLimit),
    next: next.slice(0, nextLimit),
    moreCount: Math.max(0, next.length - nextLimit),
    total: open.length,
  };
}

export function formatVienna(value, { withTime = true } = {}) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const options = { weekday: "short", day: "2-digit", month: "2-digit", timeZone: VIENNA };
  if (withTime) Object.assign(options, { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleString("de-AT", options);
}

// Eine Zeile zur Jahreswertung: die eigene Platzierung, sonst die Spitze.
export function seasonLine(season) {
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

// Wohin eine offene Aktion führt; Gewinne kommen aus dem Web-Zähler dazu.
export function actionHref(action) {
  const target = action?.target_id;
  switch (action?.target_type) {
    case "tournament": return target ? `/tournaments/${target}` : "/tournaments";
    case "event": return target ? `/events/${target}` : "/events";
    case "match": return target ? `/matches/${target}` : "/dashboard";
    case "prizes": return "/my/prizes";
    default: return "";
  }
}

export function dashboardActions(data, { openPrizes = 0 } = {}) {
  const actions = [...((data?.me?.actions) || [])].map((action) => ({ ...action, href: actionHref(action) }));
  if (openPrizes > 0) {
    actions.unshift({
      id: "prizes-open",
      type: "prize_pending",
      label: openPrizes === 1 ? "Gewinn abholen" : `${openPrizes} Gewinne abholen`,
      detail: "Zeit und Ort unter Meine Gewinne",
      target_type: "prizes",
      href: "/my/prizes",
      priority: 9,
    });
  }
  return actions;
}
