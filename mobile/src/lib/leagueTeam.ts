import { viennaDate, viennaDateTime } from "./vienna";

// Liga an Team, Profil und Tabelle in der App (#2173): Anmeldestatus (B.4, F.2), Zonen und Endstand der Tabelle (E.1, F.1, F.2) und
// die Season-Historie (F.2). Dieselben Wörter wie im Web (lib/leagueApplications.js, lib/leagueSuccessor.js, lib/leagueTable.js,
// lib/leagueFinal.js, components/tls/league/LeagueSeasonHistory.jsx) - gerechnet wird auf dem Server.

// ---------------------------------------------------------------- Anmeldung (B.4, F.2)

export type ApplicationTone = "quiet" | "info" | "ok" | "warn";
export const APPLICATION_STATES: Record<string, { label: string; tone: ApplicationTone }> = {
  none: { label: "Nicht angemeldet", tone: "quiet" },
  open: { label: "Anmeldung offen", tone: "info" },
  submitted: { label: "Eingereicht", tone: "info" },
  in_review: { label: "In Prüfung", tone: "info" },
  accepted: { label: "Angenommen", tone: "ok" },
  rejected: { label: "Abgelehnt", tone: "warn" },
  waitlist: { label: "Warteliste", tone: "warn" },
  withdrawn: { label: "Zurückgezogen", tone: "quiet" },
};

export type CarryOver = {
  from_season_name?: string | null;
  from_label?: string | null;
  division_label?: string | null;
  movement?: "up" | "down" | "stay" | string | null;
  withdraw_until?: string | null;
};

export type TeamApplication = {
  id: string;
  squad_id?: string;
  season_id?: string;
  title?: string;
  url?: string | null;
  status?: string;
  staffel?: string | null;
  staffel_left?: boolean;
  decision_reason?: string | null;
  carry_over?: CarryOver | null;
  can_withdraw?: boolean;
};

/** Was das eigene Team sieht: angenommen heißt „Angemeldet“, ohne Staffel mit „Zuteilung folgt“. */
export function teamStateLabel(state?: string | null, application?: Pick<TeamApplication, "staffel" | "staffel_left"> | null): string {
  if (state === "accepted" && !application?.staffel_left) return application?.staffel ? "Angemeldet" : "Angemeldet – Zuteilung folgt";
  return (APPLICATION_STATES[String(state)] || APPLICATION_STATES.none).label;
}

export function applicationTone(state?: string | null): ApplicationTone {
  return (APPLICATION_STATES[String(state)] || APPLICATION_STATES.none).tone;
}

const LONG: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };

/** „Übernommen aus Season 1: Liga 1 (Aufstieg aus Liga 2). Abmelden bis zum Start am 05.01.2027, 18:00 Uhr.“ */
export function carryLine(carry?: CarryOver | null): string {
  if (!carry) return "";
  const way = carry.movement === "up" ? ` (Aufstieg aus ${carry.from_label})` : carry.movement === "down" ? ` (Abstieg aus ${carry.from_label})` : "";
  const until = carry.withdraw_until ? ` Abmelden bis zum Start am ${viennaDateTime(carry.withdraw_until, LONG)} Uhr.` : "";
  return `Übernommen aus ${carry.from_season_name || "der Vorgänger-Season"}: ${carry.division_label}${way}.${until}`;
}

/** Die Anträge der Co-Teams dieses Teams - die Liste des Servers gilt für alle eigenen Co-Teams. */
export function applicationsForSquads(items: TeamApplication[] | null | undefined, squadIds: Array<string | null | undefined>): TeamApplication[] {
  const ids = new Set(squadIds.filter(Boolean));
  return (items || []).filter((row) => row && ids.has(row.squad_id));
}

// ---------------------------------------------------------------- Tabelle (E.1, F.1, F.2)

export const ZONE_LABELS: Record<string, string> = {
  promotion: "Aufstieg",
  playoff_promotion: "Relegation um den Aufstieg",
  playoff_relegation: "Relegation gegen den Abstieg",
  relegation: "Abstieg",
};
const ZONE_ORDER = ["promotion", "playoff_promotion", "playoff_relegation", "relegation"];

/** Grün hinauf, Orange hinunter, Relegation heller - Rot bleibt „läuft“, Gold dem Podest (wie im Web). */
export const ZONE_COLORS: Record<string, string> = {
  promotion: "#1FD08E",
  playoff_promotion: "rgba(31,208,142,0.55)",
  playoff_relegation: "rgba(255,159,67,0.55)",
  relegation: "#FF9F43",
};

/** Die Zonen, die in dieser Tabelle vorkommen - in fester Reihenfolge, für die Legende unter der Tabelle. */
export function zoneLegend(rows: Array<{ zone?: string | null } | null | undefined> | null | undefined): Array<{ zone: string; label: string }> {
  const used = new Set((rows || []).map((row) => row?.zone).filter(Boolean));
  return ZONE_ORDER.filter((zone) => used.has(zone)).map((zone) => ({ zone, label: ZONE_LABELS[zone] }));
}

/**
 * Nachmeldung nach dem Season-Start (#2422, Nr. 183): „Nachgemeldet ab Woche 3“, ohne offene Woche nur „Nachgemeldet“ - leer sonst.
 * Derselbe Satz aus denselben Feldern wie Web, TV und Druck (`late_entry`, `late_from_week`; frontend/src/lib/leagueTable.js).
 */
export function lateEntryText(row?: { late_entry?: unknown; late_from_week?: unknown } | null): string {
  if (!row?.late_entry) return "";
  const week = Number(row.late_from_week);
  return Number.isInteger(week) && week > 0 ? `Nachgemeldet ab Woche ${week}` : "Nachgemeldet";
}

/** Die Zone einer Zeile, nur wenn sie eine der vier bekannten ist. */
export function knownZone(zone?: string | null): string | null {
  return zone && ZONE_LABELS[zone] ? zone : null;
}

/** Die Zeile über der Tabelle: „Endstand · abgeschlossen am 12.11.2026“. */
export function finalNote(final?: { closed_at?: string | null } | null): string {
  if (!final) return "";
  let day = "";
  try {
    day = final.closed_at ? viennaDate(final.closed_at, { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
  } catch {
    day = "";
  }
  return day ? `Endstand · abgeschlossen am ${day}` : "Endstand";
}

/**
 * Der Abruf der Staffel auf der Ligaseite (`GET /api/leagues/<liga>/<season>/staffeln/<staffel>`) aus dem öffentlichen Pfad der
 * Season (`league_links.public_path` = „/liga/<liga>/<season>“) - dort steht der Meister im Endstand. Sonst null.
 */
export function staffelApiPath(publicPath?: string | null, tournamentId?: string | null): string | null {
  const parts = String(publicPath || "").split("/");
  // „.“ und „..“ wären nach dem Auflösen ein anderer Pfad auf dem Server - nur echte Namen zählen.
  const plain = (segment: string) => Boolean(segment) && segment !== "." && segment !== "..";
  if (parts.length !== 4 || parts[0] !== "" || parts[1] !== "liga" || !plain(parts[2]) || !plain(parts[3]) || !tournamentId || !plain(String(tournamentId))) return null;
  return `/leagues/${encodeURIComponent(parts[2])}/${encodeURIComponent(parts[3])}/staffeln/${encodeURIComponent(tournamentId)}`;
}

/** Liga und Season aus dem öffentlichen Pfad der Season („/liga/<liga>/<season>“) - nur echte Namen, sonst null. */
export function seasonParts(publicPath?: string | null): { league: string; season: string } | null {
  const parts = String(publicPath || "").split("/");
  const plain = (segment: string) => Boolean(segment) && segment !== "." && segment !== "..";
  if (parts.length !== 4 || parts[0] !== "" || parts[1] !== "liga" || !plain(parts[2]) || !plain(parts[3])) return null;
  return { league: parts[2], season: parts[3] };
}

/** Der Abruf der Season auf der Ligaseite (`GET /api/leagues/<liga>/<season>`): Anmeldefenster und Gesamtwertung. */
export function seasonApiPath(publicPath?: string | null): string | null {
  const parts = seasonParts(publicPath);
  return parts ? `/leagues/${encodeURIComponent(parts.league)}/${encodeURIComponent(parts.season)}` : null;
}

/** Das Anmeldefenster der Season (`application`): `closes_at` ist das wirksame Ende mit Nachmeldefrist (#2422, Nr. 184). */
export type ApplicationWindow = { state?: string | null; opens_at?: string | null; closes_at?: string | null; season_starts_at?: string | null };

const when = (value?: string | null) => `${viennaDateTime(String(value), LONG)} Uhr`;

/** Der Stand des Fensters als kurzer Satz - wie im Web (lib/leagueApplications.js `windowLine`). */
export function windowLine(block?: ApplicationWindow | null): string {
  if (block?.state === "open" && block.closes_at) return `Anmeldung offen bis ${when(block.closes_at)}`;
  if (block?.state === "upcoming" && block.opens_at) return `Anmeldung öffnet am ${when(block.opens_at)}`;
  if (block?.state === "closed" && block.closes_at) return `Anmeldung vorbei seit ${when(block.closes_at)}`;
  return "";
}

/** Nachmeldung (Nr. 180): Endet die Anmeldung nach dem Beginn der Season, sagt es ein Satz - sonst leer (wie `afterStartLine` im Web). */
export function afterStartLine(block?: ApplicationWindow | null): string {
  if (!block?.state || block.state === "closed" || !block.closes_at || !block.season_starts_at) return "";
  const closes = new Date(block.closes_at).getTime();
  const start = new Date(block.season_starts_at).getTime();
  if (!Number.isFinite(closes) || !Number.isFinite(start) || closes <= start) return "";
  return `Anmeldung läuft nach Season-Start weiter (bis ${when(block.closes_at)}).`;
}

/** Die Überschrift über Platz 1 einer abgeschlossenen Staffel: „Meister“ nur, wenn der Endstand einen nennt, sonst „Platz 1“. */
export function winnerLabel(isLeague: boolean, champion?: { display_name?: string | null } | null): string {
  if (!isLeague) return "Champion";
  return champion ? "Meister" : "Platz 1";
}

// ---------------------------------------------------------------- Season-Historie (F.2)

export type LeagueHistoryRow = {
  league_name?: string;
  season_name?: string;
  season_id?: string;
  division_label?: string | null;
  staffel?: string | null;
  display_name?: string | null;
  rank?: number | null;
  of?: number | null;
  points?: number | null;
  champion?: boolean;
  zone?: string | null;
  exit?: string | null;
  url?: string | null;
  tournament_id?: string | null;
};

const EXIT_TEXT: Record<string, string> = { withdrawn: "ausgetreten", disqualified: "disqualifiziert" };

/** „Platz 2 von 8“, „ausgetreten“. */
export function historyPlace(row: LeagueHistoryRow): string {
  if (row.exit) return EXIT_TEXT[row.exit] || "ausgeschieden";
  return row.of ? `Platz ${row.rank} von ${row.of}` : `Platz ${row.rank}`;
}

/** Die zweite Zeile: „Liga 1 · Staffel A · Löwen Rudel“. */
export function historyWhere(row: LeagueHistoryRow, showTeam = false): string {
  return [row.division_label, row.staffel ? `Staffel ${row.staffel}` : "", showTeam ? row.display_name : ""].filter(Boolean).join(" · ");
}

/** Auf- oder Abstieg als Wort mit Richtung - Relegation ohne Pfeil, sonst nichts. */
export function historyMovement(zone?: string | null): { label: string; direction: "up" | "down" | null } | null {
  if (zone === "promotion") return { label: ZONE_LABELS.promotion, direction: "up" };
  if (zone === "relegation") return { label: ZONE_LABELS.relegation, direction: "down" };
  return zone && ZONE_LABELS[zone] ? { label: ZONE_LABELS[zone], direction: null } : null;
}
