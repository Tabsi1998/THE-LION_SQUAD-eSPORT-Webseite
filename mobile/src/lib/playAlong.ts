import { clock, weekdayClock } from "./eventPage";
import { formatCents } from "./startFee";

// „Spielst du auch mit?“ (#1184): der zweite Schritt nach der Event-Anmeldung - die Rechnung ohne React, wie im Web
// (frontend/src/lib/playAlong.js). Die Einträge kommen fertig vom Server (GET /events/{id}/play-along): Haken nur bei
// Einzel-Turnieren, Team-Turniere und Fast Laps als Hinweis.

type Price = { total_cents: number; currency?: string | null };

export type PlayAlongEntry = {
  kind: "tournament" | "fastlap";
  id: string;
  slug?: string | null;
  title: string;
  start_date?: string | null;
  event_day?: { index: number } | null;
  mode: string;
  game?: string | null;
  team?: boolean;
  fee?: Price | null;
  spots_left?: number | null;
  full?: boolean;
  my_status?: { state?: string | null; label?: string | null } | null;
  captain?: boolean;
  selectable: boolean;
  reason?: string | null;
};

export type PlayAlongRow = PlayAlongEntry & { dayLabel: string; timeLabel: string; line: string; key: string };

export type PlayAlongResult = {
  id: string;
  title?: string | null;
  state: "registered" | "waitlist" | "pending" | "already" | "error";
  label: string;
  detail?: string | null;
  price?: Price | null;
};

export type PlayAlongResponse = { results: PlayAlongResult[]; total_cents: number; currency?: string | null };

type EventLike = { tournaments?: unknown[] | null; f1_challenges?: unknown[] | null } | null | undefined;

/** Lohnt sich die Frage überhaupt? Nur mit Konto und nur, wenn das Event Turniere oder Fast Laps hat. */
export function offersPlayAlong(event: EventLike, signedIn: boolean): boolean {
  return Boolean(signedIn && ((event?.tournaments || []).length || (event?.f1_challenges || []).length));
}

function placesLabel(count: number): string {
  return `${count} ${count === 1 ? "Platz" : "Plätze"} frei`;
}

/** Die Zeilen mit Tag, Uhrzeit und einer Zeile „Einzel · Rocket League · 10,00 € Startgeld · 3 Plätze frei“. */
export function playAlongRows(entries: PlayAlongEntry[] | null | undefined, { multiDay = false } = {}): PlayAlongRow[] {
  return (entries || []).map((entry) => {
    const fee = entry.fee ? `${formatCents(entry.fee.total_cents, entry.fee.currency || "EUR")} Startgeld` : entry.kind === "tournament" && !entry.team ? "kostenlos" : "";
    // Freie Plätze nur, wo man sich gerade anmelden kann - bei geschlossenen Turnieren stünde sonst „3 Plätze frei“.
    const places = entry.kind !== "tournament" || entry.team || entry.my_status || !entry.selectable ? ""
      : entry.full ? "voll – Warteliste" : entry.spots_left != null ? placesLabel(entry.spots_left) : "";
    return {
      ...entry,
      key: entry.slug || entry.id,
      dayLabel: multiDay && entry.event_day ? `Tag ${entry.event_day.index}` : "",
      timeLabel: multiDay ? weekdayClock(entry.start_date) : clock(entry.start_date),
      line: [entry.mode, entry.game, fee, places].filter(Boolean).join(" · "),
    };
  });
}

/** Vorausgewählt ist nur das Turnier, von dem man gekommen ist - und nur, wenn es einen Haken hat. */
export function initialSelection(entries: PlayAlongEntry[] | null | undefined, from?: string | null): string[] {
  if (!from) return [];
  const match = (entries || []).find((entry) => entry.selectable && (entry.slug === from || entry.id === from));
  return match ? [match.id] : [];
}

/** Die Summe der Startgelder der gewählten Turniere; volle Turniere (Warteliste) zahlen erst beim Nachrücken. */
export function selectionTotal(entries: PlayAlongEntry[] | null | undefined, selected: string[]) {
  const chosen = new Set(selected);
  let total = 0;
  let currency = "EUR";
  let waitlistFees = 0;
  for (const entry of entries || []) {
    if (!chosen.has(entry.id) || !entry.fee) continue;
    currency = entry.fee.currency || currency;
    if (entry.full) waitlistFees += 1;
    else total += Number(entry.fee.total_cents || 0);
  }
  return { total_cents: total, currency, waitlistFees };
}

/** Kurz zusammengefasst: „2 angemeldet, 1 auf der Warteliste, 1 nicht angemeldet“. */
export function resultSentence(results: PlayAlongResult[] | null | undefined): string {
  const rows = results || [];
  const count = (states: string[]) => rows.filter((row) => states.includes(row.state)).length;
  const parts: string[] = [];
  const done = count(["registered", "pending", "already"]);
  const waiting = count(["waitlist"]);
  const failed = count(["error"]);
  if (done) parts.push(`${done} angemeldet`);
  if (waiting) parts.push(`${waiting} auf der Warteliste`);
  if (failed) parts.push(`${failed} nicht angemeldet`);
  return parts.join(", ");
}
