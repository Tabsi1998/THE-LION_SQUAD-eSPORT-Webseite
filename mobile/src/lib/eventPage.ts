import type { ClubEvent, F1Challenge, Tournament } from "../types";
import { eventOfferSummary } from "./eventPrice";
import { formatTournamentFormat, formatWhen } from "./format";
import { viennaDay, viennaTime } from "./vienna";

// Die Event-Seite als Startpunkt (#1183), Kopf mit Bild (#1273) und Fakten-Kasten (#1346) - dieselbe Rechnung und dieselbe
// Reihenfolge wie im Web (frontend/src/lib/eventPage.js).

/** Die Abschnitte in fester Reihenfolge - in Website und App gleich. */
export const EVENT_SECTIONS = ["yours", "whatson", "live", "photos", "news", "infos", "sponsors"] as const;
export type EventSection = (typeof EVENT_SECTIONS)[number];

/** Die feste Liste der Highlight-Symbole (Server: services/event_facts.HIGHLIGHT_ICONS) mit ihrem Wort. */
export const HIGHLIGHT_ICONS: Record<string, string> = {
  gamepad: "Zocken",
  trophy: "Turnier",
  flag: "Rennen",
  monitor: "Stationen",
  vr: "Virtual Reality",
  retro: "Retro",
  music: "Musik",
  food: "Essen",
  drink: "Getränke",
  wifi: "WLAN",
  gift: "Preise",
  users: "Treffen",
  camera: "Fotos",
  star: "Besonderes",
};

const VISIBILITY_CHIPS: Record<string, string> = { public: "Öffentlich", community: "Nur Community", members: "Nur Mitglieder", internal: "Intern" };

export function visibilityChip(visibility?: string | null): string {
  return VISIBILITY_CHIPS[visibility || "public"] || "";
}

export function routeUrl(query?: string | null): string {
  const clean = String(query || "").trim();
  return clean ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(clean)}` : "";
}

export type FactRow = { key: "when" | "where" | "entry" | "bring"; label: string; title: string; lines: string[]; route?: string; free?: boolean; hybrid?: boolean };

type FactsEvent = ClubEvent & { address?: string | null; postal_code?: string | null; map_query?: string | null; is_online?: boolean; is_hybrid?: boolean; bring_along?: string[] };

function addressLine(event: FactsEvent): string {
  const cityLine = [event.postal_code, event.city].filter(Boolean).join(" ");
  return [event.address, cityLine].filter(Boolean).join(", ");
}

function endClock(start?: string | null, end?: string | null): string {
  if (!start || !end) return "";
  return viennaDay(start) === viennaDay(end) ? viennaTime(end, { hour: "2-digit", minute: "2-digit" }) : formatWhen(end);
}

/** Was im Fakten-Kasten steht (#1346): Wann, Wo (mit Route), Eintritt (sonst „frei“), Mitbringen. */
export function eventFacts(event: FactsEvent | null | undefined, { now = new Date() }: { now?: Date } = {}): FactRow[] {
  if (!event) return [];
  const rows: FactRow[] = [];
  const schedule = event.schedule;
  const start = event.start_date || event.date;
  if (schedule?.multi_day && schedule.days?.length) {
    rows.push({ key: "when", label: "Wann", title: schedule.range_label || schedule.label, lines: schedule.days.map((day) => `${day.label} · ${day.time_label}`) });
  } else if (start) {
    const end = endClock(start, event.end_date);
    rows.push({ key: "when", label: "Wann", title: `${formatWhen(start, { now })}${end ? ` – ${end}` : ""}`, lines: [] });
  }
  const places = event.locations || [];
  if (places.length > 1) {
    rows.push({ key: "where", label: "Wo", title: `${places.length} Standorte`, lines: places.map((place) => place.name || place.address_line || "").filter(Boolean) });
  } else if (event.is_online && !event.is_hybrid) {
    rows.push({ key: "where", label: "Wo", title: "Online", lines: [] });
  } else {
    const place = places[0];
    const name = place?.name || event.location || event.city || "";
    const address = place?.address_line || addressLine(event);
    const query = place?.map_query || event.map_query || address || name;
    if (name || address) {
      rows.push({ key: "where", label: "Wo", title: name || address, lines: name && address && address !== name ? [address] : [], route: routeUrl(query), hybrid: Boolean(event.is_hybrid) });
    }
  }
  const paid = Boolean(event.offer?.enabled);
  rows.push({ key: "entry", label: "Eintritt", title: paid ? eventOfferSummary(event.offer, 1) : "frei", free: !paid, lines: [] });
  const bring = (event.bring_along || []).filter(Boolean);
  if (bring.length) rows.push({ key: "bring", label: "Mitbringen", title: bring[0], lines: bring.slice(1) });
  return rows;
}

export type WhatsOnRow = {
  kind: "tournament" | "fastlap";
  id: string;
  key: string;
  title: string;
  start: string | null;
  dayLabel: string;
  timeLabel: string;
  mode: string;
  detail: string;
  mine: { label: string; team: string | null } | null;
  action: "register" | null;
  phase: Tournament["public_phase"] | null;
  status?: string;
};

export function clock(value?: string | null): string {
  return value ? viennaTime(value, { hour: "2-digit", minute: "2-digit" }) : "";
}

export function weekdayClock(value?: string | null): string {
  if (!value) return "";
  const weekday = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][new Date(`${viennaDay(value)}T12:00:00Z`).getUTCDay()];
  return `${weekday} ${clock(value)}`;
}

type EventWithItems = { schedule?: ClubEvent["schedule"]; tournaments?: Tournament[]; f1_challenges?: F1Challenge[] };

/** Die Zeilen „Was läuft beim Event“ (#1183) - wie im Web: Tag-Etikett, Uhrzeit, Spielart, eigener Stand, „Anmelden“. */
export function whatsOnRows(event: EventWithItems | null | undefined): WhatsOnRow[] {
  const multi = Boolean(event?.schedule?.multi_day);
  const rows: WhatsOnRow[] = [
    ...(event?.tournaments || []).map((item) => ({ kind: "tournament" as const, item: item as Tournament & F1Challenge })),
    ...(event?.f1_challenges || []).map((item) => ({ kind: "fastlap" as const, item: item as Tournament & F1Challenge })),
  ].map(({ kind, item }) => {
    const team = kind === "tournament" && (item.team_mode || "solo") !== "solo";
    const state = item.public_phase?.state || item.status;
    const mine = item.my_status || null;
    return {
      kind,
      id: item.id,
      key: item.slug || item.id,
      title: item.title || (kind === "fastlap" ? "Fast Lap" : "Turnier"),
      start: item.start_date || null,
      dayLabel: multi && item.event_day ? `Tag ${item.event_day.index}` : "",
      timeLabel: multi ? weekdayClock(item.start_date) : clock(item.start_date),
      mode: kind === "fastlap" ? "Bestzeit fahren" : team ? "Team" : "Einzel",
      detail: kind === "tournament" ? [item.game?.display_name || item.game?.name || item.game_name, item.format ? (item.format_label || formatTournamentFormat(item.format)) : ""].filter(Boolean).join(" · ") : "",
      mine: mine ? { label: mine.label, team: mine.team_name || null } : null,
      action: !mine && kind === "tournament" && state === "registration_open" ? "register" : null,
      phase: item.public_phase || null,
      status: item.status,
    };
  });
  return rows.sort((a, b) => String(a.start || "9999").localeCompare(String(b.start || "9999")) || a.title.localeCompare(b.title));
}

// Emoji am Anfang eines Zwischentitels: „## 🚀 Noch mehr Highlights“ → „## Noch mehr Highlights“ (wie im Web).
const HEADING_EMOJI = /^(#{1,6}\s+)(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f|\u20e3|\p{Regional_Indicator}|[ \t])+/gmu;

export function stripHeadingEmoji(markdown?: string | null): string {
  return String(markdown || "").replace(HEADING_EMOJI, (_match, hashes: string) => hashes);
}
