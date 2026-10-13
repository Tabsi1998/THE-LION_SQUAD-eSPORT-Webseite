import { formatCents } from "@/lib/pricing";
import { clock, weekdayClock } from "@/lib/eventPage";

// „Spielst du auch mit?“ (#1184): der zweite Schritt nach der Event-Anmeldung - die Rechnung ohne React. Die Einträge
// kommen fertig vom Server (GET /events/{id}/play-along): Haken nur bei Einzel-Turnieren, Team-Turniere und Fast Laps als
// Hinweis. Dieselben Wörter stehen für die App in mobile/src/lib/playAlong.ts.

/** Der Abfrage-Parameter, mit dem die Turnierseite (Event-Pflicht #875) zum Event schickt - danach geht es zurück. */
export const RETURN_PARAM = "turnier";

/** Lohnt sich die Frage überhaupt? Nur mit Konto und nur, wenn das Event Turniere oder Fast Laps hat. */
export function offersPlayAlong(event, user) {
  return Boolean(user && ((event?.tournaments || []).length || (event?.f1_challenges || []).length));
}

function placesLabel(count) {
  return `${count} ${count === 1 ? "Platz" : "Plätze"} frei`;
}

/** Die Zeilen mit Tag, Uhrzeit und einer Zeile „Einzel · Rocket League · 10,00 € Startgeld · 3 Plätze frei“. */
export function playAlongRows(entries, { multiDay = false } = {}) {
  return (entries || []).map((entry) => {
    const fee = entry.fee ? `${formatCents(entry.fee.total_cents, entry.fee.currency)} Startgeld` : entry.kind === "tournament" && !entry.team ? "kostenlos" : "";
    // Freie Plätze nur, wo man sich gerade anmelden kann - bei geschlossenen Turnieren stünde sonst „3 Plätze frei“.
    const places = entry.kind !== "tournament" || entry.team || entry.my_status || !entry.selectable ? ""
      : entry.full ? "voll – Warteliste" : entry.spots_left != null ? placesLabel(entry.spots_left) : "";
    return {
      ...entry,
      dayLabel: multiDay && entry.event_day ? `Tag ${entry.event_day.index}` : "",
      timeLabel: multiDay ? weekdayClock(entry.start_date) : clock(entry.start_date),
      line: [entry.mode, entry.game, fee, places].filter(Boolean).join(" · "),
      path: `/${entry.kind === "fastlap" ? "fastlap" : "tournaments"}/${entry.slug || entry.id}`,
    };
  });
}

/** Vorausgewählt ist nur das Turnier, von dem man gekommen ist - und nur, wenn es einen Haken hat. */
export function initialSelection(entries, from) {
  if (!from) return [];
  const match = (entries || []).find((entry) => entry.selectable && (entry.slug === from || entry.id === from));
  return match ? [match.id] : [];
}

/** Die Summe der Startgelder der gewählten Turniere; volle Turniere (Warteliste) zahlen erst beim Nachrücken. */
export function selectionTotal(entries, selected) {
  const chosen = new Set(selected || []);
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
export function resultSentence(results) {
  const rows = results || [];
  const count = (states) => rows.filter((row) => states.includes(row.state)).length;
  const parts = [];
  const done = count(["registered", "pending", "already"]);
  const waiting = count(["waitlist"]);
  const failed = count(["error"]);
  if (done) parts.push(`${done} angemeldet`);
  if (waiting) parts.push(`${waiting} auf der Warteliste`);
  if (failed) parts.push(`${failed} nicht angemeldet`);
  return parts.join(", ");
}

/** Der Weg zurück zum Turnier - nur mit einem einfachen Kurznamen, nie eine fremde Adresse. */
export function returnTournamentPath(value) {
  const slug = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(slug) ? `/tournaments/${slug}` : "";
}
