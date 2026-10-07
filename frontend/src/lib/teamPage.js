import { viennaDateTime } from "@/lib/vienna";

// Team-Seite (#1191): reine Helfer für Termine, letzte Spiele und den Einladungs-Link - ohne React, mit Tests.

/** Der Name des Schlüssels in der Adresse: /teams/<id>?einladung=<schlüssel>. */
export const INVITE_PARAM = "einladung";

const OUTCOME_LABELS = { win: "Sieg", loss: "Niederlage", draw: "Unentschieden" };

/** „Sieg“, „Niederlage“, „Unentschieden“ - bei Durchgängen „Platz 2“. */
export function outcomeLabel(row) {
  if (!row) return "";
  if (row.kind === "heat") return row.rank ? `Platz ${row.rank}` : "Gewertet";
  return OUTCOME_LABELS[row.outcome] || "Gewertet";
}

/** Die Zeile eines fertigen Spiels: „3:1 gegen Pixelpiraten“ oder „Platz 2 von 6“. */
export function recentLine(row) {
  if (!row) return "";
  if (row.kind === "heat") return row.rank ? `Platz ${row.rank}${row.field ? ` von ${row.field}` : ""}` : "Durchgang gewertet";
  const against = row.opponent ? `gegen ${row.opponent}` : "";
  if (row.forfeit && !row.score) return `${row.outcome === "win" ? "Gewonnen" : "Verloren"} ${against} (kampflos)`.trim();
  return [row.score, against].filter(Boolean).join(" ");
}

/** Unter dem Titel eines kommenden Turniers: „Herbst-LAN · Sa., 17.10. · 16:00“. */
export function upcomingLine(row) {
  const t = row?.tournament || {};
  const when = t.start_date ? viennaDateTime(t.start_date, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  return [t.event_name, when ? when.replace(", ", " · ") : "", !t.event_name ? t.game_name : ""].filter(Boolean).join(" · ");
}

/** Der Schlüssel aus der Adresse - oder leer. */
export function inviteTokenFrom(search) {
  try {
    return (new URLSearchParams(search || "").get(INVITE_PARAM) || "").trim();
  } catch {
    return "";
  }
}
