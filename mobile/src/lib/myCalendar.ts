import type { CalendarItem, CalendarKind } from "./calendar";
import { subscribeUrls } from "./calendar";
import { asInstant, dayNoon, viennaDate, viennaDay, viennaTime } from "./vienna";

// „Mein Kalender“ (#1788): die eigenen Termine ohne Abo. Welche es sind, rechnet der Server an einer Stelle
// (GET /api/calendar/me = dieselbe Liste wie der persönliche Feed); hier nur, wie sie gruppiert und beschriftet werden -
// dieselbe Rechnung wie im Web (frontend/src/lib/myCalendar.js), ohne React und ohne Netz, damit sie sich testen lässt.

export type OwnState = { state?: string | null; label?: string | null; team_name?: string | null };

export type MyCalendarItem = {
  id: string;
  kind: CalendarKind;
  /** Vereinstermine: „meeting“ (Versammlung) oder „shift“ (Helferschicht). */
  club_kind?: string | null;
  title: string;
  start: string;
  end?: string | null;
  all_day?: boolean;
  /** Ganztägig: der Kalendertag „JJJJ-MM-TT“. */
  day?: string | null;
  status?: string | null;
  phase?: { label?: string | null } | null;
  location?: string | null;
  /** Der Weg auf der Website (/tournaments/…, /members/meetings?meeting=…) - die App öffnet ihn im passenden Screen. */
  path?: string | null;
  marker?: string | null;
  event_id?: string | null;
  event_name?: string | null;
  mine?: boolean;
  own?: OwnState | null;
  /** Nach dem Zusammenfassen: die Tage eines Events. */
  parts?: MyCalendarItem[];
};

export type Subscription = { active: boolean; created_at?: string | null; last_used_at?: string | null };

export type AgendaBucket = { key: "today" | "week" | "later"; label: string; items: MyCalendarItem[] };

export type BadgeTone = "mine" | "wait" | "done" | "club";

const DAY_MS = 24 * 60 * 60 * 1000;

export const MY_KIND_LABELS: Record<CalendarKind, string> = { event: "Events", tournament: "Turniere", fastlap: "Fast Laps", club: "Verein" };
const KIND_LABELS: Record<CalendarKind, string> = { event: "Event", tournament: "Turnier", fastlap: "Fast Lap", club: "Verein" };
const CLUB_LABELS: Record<string, string> = { meeting: "Versammlung", shift: "Helferschicht" };
const KIND_ORDER: CalendarKind[] = ["event", "tournament", "fastlap", "club"];

function parse(value?: string | null): Date | null {
  if (!value) return null;
  const date = asInstant(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const startTime = (item: MyCalendarItem) => parse(item.start)?.getTime() ?? Infinity;

/** Die Tage eines Events (`marker: "event_day"`) werden eine Zeile - mit dem Namen des Events, vom ersten Beginn bis zum letzten Ende. */
export function mergeEventDays(items: MyCalendarItem[]): MyCalendarItem[] {
  const groups = new Map<string, MyCalendarItem>();
  const out: MyCalendarItem[] = [];
  for (const item of items || []) {
    if (item.marker !== "event_day" || !item.event_id) {
      out.push(item);
      continue;
    }
    const group = groups.get(item.event_id);
    if (!group) {
      const merged: MyCalendarItem = { ...item, id: item.event_id, title: item.event_name || item.title, marker: null, parts: [item] };
      groups.set(item.event_id, merged);
      out.push(merged);
      continue;
    }
    group.parts = [...(group.parts || []), item];
    if (startTime(item) < startTime(group)) group.start = item.start;
    const itemEnd = parse(item.end || item.start);
    const groupEnd = parse(group.end || group.start);
    if (itemEnd && (!groupEnd || itemEnd.getTime() > groupEnd.getTime())) group.end = item.end || item.start;
    group.mine = Boolean(group.mine || item.mine);
  }
  return out.sort((a, b) => startTime(a) - startTime(b));
}

/** Der Sonntag der laufenden Woche (Wien, Woche ab Montag) als „JJJJ-MM-TT“. */
function weekEnd(now: Date): string {
  const noon = dayNoon(viennaDay(now));
  const weekday = (noon.getUTCDay() + 6) % 7; // Mo = 0
  return new Date(noon.getTime() + (6 - weekday) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * „Als Nächstes“ in drei Abschnitten: Heute (auch was gerade läuft), Diese Woche (bis Sonntag), Später. Vergangenes
 * fällt weg, die Tage eines Events sind eine Zeile. Leere Abschnitte gibt es nicht.
 */
export function agendaBuckets(items: MyCalendarItem[], now: Date = new Date()): AgendaBucket[] {
  const today = viennaDay(now);
  const sunday = weekEnd(now);
  const buckets: AgendaBucket[] = [
    { key: "today", label: "Heute", items: [] },
    { key: "week", label: "Diese Woche", items: [] },
    { key: "later", label: "Später", items: [] },
  ];
  for (const item of mergeEventDays(items || [])) {
    const start = parse(item.start);
    if (!start) continue;
    const end = parse(item.end);
    const day = item.all_day && item.day ? item.day : viennaDay(start);
    if (item.all_day) {
      // Ganztägig (Versammlung ohne Uhrzeit): gilt bis zum Ende seines letzten Tags in Wien - nicht bis 00:00 des
      // Beginns. Ein Ende ist ausschließlich (00:00 des Folgetags), darum eine Millisekunde davor.
      const lastDay = end ? viennaDay(new Date(end.getTime() - 1)) : day;
      if ((lastDay > day ? lastDay : day) < today) continue;
    } else if ((end || start).getTime() < now.getTime()) {
      continue;
    }
    if (day <= today) buckets[0].items.push(item);
    else if (day <= sunday) buckets[1].items.push(item);
    else buckets[2].items.push(item);
  }
  return buckets.filter((bucket) => bucket.items.length);
}

// Farbe der Plakette je Stand: Cyan heißt „du“ (#1305), Warteliste wartet in Orange, Erledigtes in Grün, Vereinstermine in Gold.
const BADGE_TONES: Record<string, BadgeTone> = {
  waitlist: "wait",
  pending: "wait",
  requested: "wait",
  checked_in: "done",
  driven: "done",
  done: "done",
};

/** Die Plakette zu einem Termin: der eigene Stand vom Server, beim Turnier mit Team „mit Lions Rocket“. */
export function ownBadge(item: Pick<MyCalendarItem, "kind" | "own"> | null | undefined): { label: string; tone: BadgeTone } | null {
  const own = item?.own;
  if (!item || !own?.label) return null;
  const tone: BadgeTone = item.kind === "club" ? "club" : BADGE_TONES[String(own.state || "")] || "mine";
  const label = own.team_name ? `${own.label} · mit ${own.team_name}` : own.label;
  return { label, tone };
}

type Format = (value: string, options: Intl.DateTimeFormatOptions) => string;

/** Status des Abos in einem Satz - „Aktiv seit 3. Okt., zuletzt abgerufen …“; ohne Abo nichts. */
export function subscriptionLine(status: Subscription | null | undefined, format: Format): string {
  if (!status?.active) return "";
  const since = status.created_at ? ` seit ${format(status.created_at, { dateStyle: "medium" })}` : "";
  const used = status.last_used_at
    ? `, zuletzt abgerufen ${format(status.last_used_at, { dateStyle: "medium", timeStyle: "short" })}`
    : ", noch von keinem Kalender abgerufen";
  return `Aktiv${since}${used}.`;
}

/** Kurzanleitung je Kalender - dieselben Worte wie im Web. */
export const SUBSCRIBE_GUIDE = [
  { key: "google", label: "Google Kalender", text: "„Weitere Kalender“ → „Per URL“ → Adresse einfügen. Am Handy einmal am PC einrichten, dann erscheint er überall." },
  { key: "apple", label: "Apple (iPhone, Mac)", text: "„Im Kalender öffnen“ antippen – oder „Ablage“ → „Neues Kalenderabonnement“ → Adresse einfügen." },
  { key: "outlook", label: "Outlook, Thunderbird", text: "„Kalender hinzufügen“ → „Aus dem Internet abonnieren“ → Adresse einfügen." },
] as const;

/** Google Kalender öffnet mit dieser Adresse gleich „Kalender hinzufügen“ für das Abo. */
export function googleSubscribeUrl(webcal: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(String(webcal || ""))}`;
}

/** Die drei Wege zum persönlichen Abo: Adresse (https), Kalender-App (webcal) und Google. */
export function personalFeedUrls(webBase: string, path: string): { https: string; webcal: string; google: string } {
  const { https, webcal } = subscribeUrls(webBase, path);
  return { https, webcal, google: googleSubscribeUrl(webcal) };
}

/** Welche Arten in den eigenen Terminen vorkommen - nur die zeigt der Filter. */
export function presentKinds(items: MyCalendarItem[]): CalendarKind[] {
  const seen = new Set((items || []).map((item) => item.kind));
  return KIND_ORDER.filter((kind) => seen.has(kind));
}

export function filterKind(items: MyCalendarItem[], kind: CalendarKind | "all"): MyCalendarItem[] {
  return kind === "all" ? items || [] : (items || []).filter((item) => item.kind === kind);
}

/** Die Art in Worten - bei Vereinsterminen Versammlung oder Helferschicht. */
export function kindLabel(item: Pick<MyCalendarItem, "kind" | "club_kind" | "marker">): string {
  if (item.marker === "registration_close") return "Anmeldeschluss";
  if (item.kind === "club") return CLUB_LABELS[String(item.club_kind || "")] || KIND_LABELS.club;
  return KIND_LABELS[item.kind] || "";
}

const DATE_SHORT: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };

/** Wann: „Sa., 24. Okt. · 18:00“, ganztägig „So., 25. Okt. · ganztägig“, mehrtägig „Sa., 24. Okt. – Mo., 26. Okt.“. */
export function whenLabel(item: MyCalendarItem): string {
  const start = parse(item.start);
  if (!start) return "";
  if (item.all_day) return `${viennaDate(item.day ? dayNoon(item.day) : start, DATE_SHORT)} · ganztägig`;
  const end = parse(item.end);
  if (end && viennaDay(end) !== viennaDay(start) && end.getTime() - start.getTime() >= DAY_MS) {
    return `${viennaDate(start, DATE_SHORT)} – ${viennaDate(end, DATE_SHORT)}`;
  }
  return `${viennaDate(start, DATE_SHORT)} · ${viennaTime(start, { hour: "2-digit", minute: "2-digit" })}`;
}

/** Für die Monatsansicht: die Tage eines Events teilen sich eine Kennung, damit sie ein Balken werden. */
export function toCalendarItems(items: MyCalendarItem[]): CalendarItem[] {
  return (items || []).map((item) => ({
    id: item.marker === "event_day" && item.event_id ? item.event_id : item.id,
    kind: item.kind,
    title: item.marker === "event_day" && item.event_name ? item.event_name : item.title,
    start: item.start,
    end: item.end,
    mine: true,
    allDay: Boolean(item.all_day),
    day: item.day,
    location: item.location,
    path: item.path,
    detail: kindLabel(item),
  }));
}
