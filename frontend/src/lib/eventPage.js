import { formatWhen } from "@/lib/datetime";
import { gameLabel } from "@/lib/gameLabels";
import { offerSummary } from "@/lib/pricing";
import { formatTournamentDisplay } from "@/lib/tournamentLabels";
import { viennaDay, viennaTime } from "@/lib/vienna";

// Die Event-Seite als Startpunkt (#1183), Kopf mit Bild (#1273) und Fakten-Kasten (#1346) - die Rechnung ohne React.
// Dieselbe Reihenfolge und dieselben Wörter stehen für die App in mobile/src/lib/eventPage.ts.

/** Die Abschnitte in fester Reihenfolge - in Website und App gleich. */
export const EVENT_SECTIONS = ["yours", "whatson", "live", "photos", "news", "infos", "sponsors"];

/** Die feste Liste der Highlight-Symbole (Server: services/event_facts.HIGHLIGHT_ICONS) mit ihrem Wort. */
export const HIGHLIGHT_ICONS = {
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

const VISIBILITY_CHIPS = {
  public: "Öffentlich",
  community: "Nur Community",
  members: "Nur Mitglieder",
  internal: "Intern",
};

/** Das Schild zur Sichtbarkeit - auf Deutsch (#1273). */
export function visibilityChip(visibility) {
  return VISIBILITY_CHIPS[visibility || "public"] || "";
}

/** Route planen: am Handy öffnet das die Karten-App, am PC Google Maps (#1346, die Anfahrt baut #1262). */
export function routeUrl(query) {
  const clean = String(query || "").trim();
  return clean ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(clean)}` : "";
}

function addressLine(event) {
  const cityLine = [event?.postal_code, event?.city].filter(Boolean).join(" ");
  return [event?.address, cityLine].filter(Boolean).join(", ");
}

function endClock(start, end) {
  if (!start || !end) return "";
  return viennaDay(start) === viennaDay(end) ? viennaTime(end, { hour: "2-digit", minute: "2-digit" }) : formatWhen(end);
}

/**
 * Was im Fakten-Kasten steht (#1346): Wann (Zeitraum, je Tag die Uhrzeit), Wo (Ort, Adresse, Route), Eintritt (aus den
 * Preisen, sonst „frei“) und Mitbringen. Ohne Angabe fällt eine Zeile weg - nie „unbekannt“.
 */
export function eventFacts(event, { now = new Date() } = {}) {
  if (!event) return [];
  const rows = [];
  const schedule = event.schedule;
  if (schedule?.multi_day && schedule.days?.length) {
    rows.push({
      key: "when", label: "Wann", title: schedule.range_label || schedule.label,
      lines: schedule.days.map((day) => `${day.label} · ${day.time_label}`),
    });
  } else if (event.start_date) {
    const end = endClock(event.start_date, event.end_date);
    rows.push({ key: "when", label: "Wann", title: `${formatWhen(event.start_date, { now })}${end ? ` – ${end}` : ""}`, lines: [] });
  }
  const places = event.locations || [];
  if (places.length > 1) {
    rows.push({ key: "where", label: "Wo", title: `${places.length} Standorte`, lines: places.map((place) => place.name || place.address_line).filter(Boolean) });
  } else if (event.is_online && !event.is_hybrid) {
    rows.push({ key: "where", label: "Wo", title: "Online", lines: [] });
  } else {
    const place = places[0];
    const name = place?.name || event.location || event.city || "";
    const address = place?.address_line || addressLine(event);
    const query = place?.map_query || event.map_query || address || name;
    if (name || address) {
      rows.push({
        key: "where", label: "Wo", title: name || address, lines: name && address && address !== name ? [address] : [],
        route: routeUrl(query), hybrid: Boolean(event.is_hybrid),
      });
    }
  }
  const paid = Boolean(event.offer?.enabled);
  rows.push({ key: "entry", label: "Eintritt", title: paid ? offerSummary(event.offer, 1) : "frei", free: !paid, lines: [] });
  const bring = (event.bring_along || []).filter(Boolean);
  if (bring.length) rows.push({ key: "bring", label: "Mitbringen", title: bring[0], lines: bring.slice(1) });
  return rows;
}

function clock(value) {
  return value ? viennaTime(value, { hour: "2-digit", minute: "2-digit" }) : "";
}

function weekdayClock(value) {
  if (!value) return "";
  const weekday = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][new Date(`${viennaDay(value)}T12:00:00Z`).getUTCDay()];
  return `${weekday} ${clock(value)}`;
}

const OPEN_STATES = new Set(["registration_open"]);

/**
 * Die Zeilen „Was läuft beim Event“ (#1183): jedes Turnier und jede Fast Lap nach Beginn - mit Tag-Etikett („Tag 2“)
 * und Uhrzeit, Spielart und dem eigenen Stand. Eintägige Events zeigen nur die Uhrzeit. „Anmelden“ steht nur, wenn die
 * Anmeldung offen ist und die Person noch nicht dabei ist.
 */
export function whatsOnRows(event) {
  const multi = Boolean(event?.schedule?.multi_day);
  const rows = [
    ...(event?.tournaments || []).map((item) => ({ kind: "tournament", item })),
    ...(event?.f1_challenges || []).map((item) => ({ kind: "fastlap", item })),
  ].map(({ kind, item }) => {
    const team = kind === "tournament" && (item.team_mode || "solo") !== "solo";
    const state = item.public_phase?.state || item.status;
    const mine = item.my_status || null;
    return {
      kind,
      id: item.id,
      title: item.title || (kind === "fastlap" ? "Fast Lap" : "Turnier"),
      path: `/${kind === "fastlap" ? "fastlap" : "tournaments"}/${item.slug || item.id}`,
      start: item.start_date || null,
      dayLabel: multi && item.event_day ? `Tag ${item.event_day.index}` : "",
      timeLabel: multi ? weekdayClock(item.start_date) : clock(item.start_date),
      mode: kind === "fastlap" ? "Bestzeit fahren" : team ? "Team" : "Einzel",
      detail: kind === "tournament" ? [item.game ? gameLabel(item.game) : item.game_name, item.format ? formatTournamentDisplay(item) : ""].filter(Boolean).join(" · ") : "",
      mine: mine ? { label: mine.label, team: mine.team_name || null } : null,
      action: !mine && kind === "tournament" && OPEN_STATES.has(state) ? "register" : null,
      phase: item.public_phase || null,
      status: item.status,
      accessLink: Boolean(item.access_link),
    };
  });
  return rows.sort((a, b) => String(a.start || "9999").localeCompare(String(b.start || "9999")) || a.title.localeCompare(b.title));
}

/** Reiter der Seite (#1183): „Übersicht“, dazu „Live“, solange etwas läuft oder kommt und es Turniere/Fast Laps gibt. */
export function eventTabs(event, { over = false } = {}) {
  const tabs = [{ key: "overview", label: "Übersicht" }];
  if (!over && ((event?.tournaments || []).length || (event?.f1_challenges || []).length)) tabs.push({ key: "live", label: "Live" });
  return tabs;
}

// Emoji am Anfang eines Zwischentitels (#1346, Lesetext #1308): „## 🚀 Noch mehr Highlights“ → „## Noch mehr Highlights“.
// Ziffern und „#“ zählen in Unicode auch als Emoji-Bausteine - deshalb nur Bildzeichen, Hautton, Verbinder und Flaggen.
const HEADING_EMOJI = /^(#{1,6}\s+)(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f|\u20e3|\p{Regional_Indicator}|[ \t])+/gmu;

export function stripHeadingEmoji(markdown) {
  return String(markdown || "").replace(HEADING_EMOJI, (_match, hashes) => hashes);
}

function plain(text) {
  return String(text || "")
    .replace(/\p{Extended_Pictographic}|\u200d|\ufe0f/gu, "")
    .replace(/[#*_`>[\]()!]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Warnung in der Verwaltung (#1273): die Beschreibung beginnt mit dem Titel (oft als Überschrift mit Emoji). */
export function descriptionEchoesTitle(name, description) {
  const title = plain(name);
  if (title.length < 3) return false;
  return plain(description).startsWith(title);
}
