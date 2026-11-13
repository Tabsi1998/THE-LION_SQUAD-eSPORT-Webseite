// Neue Season aus der Vorgänger-Season (F.2, #1627): Wörter für Vorschau, Eingang und Team-Seite. Gerechnet wird auf dem Server.
import { viennaDateTime } from "@/lib/vienna";

export const MOVEMENT_TEXT = { up: "Aufstieg", down: "Abstieg", stay: "bleibt" };
const LONG = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };

/** Woher ein Team kommt: „Liga 2 · Staffel A, Platz 1“. */
export function teamFrom(team) {
  if (!team) return "";
  const where = [team.from_label, team.from_staffel ? `Staffel ${team.from_staffel}` : ""].filter(Boolean).join(" · ");
  return team.rank ? `${where}, Platz ${team.rank}` : where;
}

/** Was mit dem Regelwerk geschieht - eigenes als Entwurf, das der Liga gilt weiter. */
export function rulesLine(rules) {
  if (rules?.kind === "draft") return `Regelwerk: ${rules.label} als Entwurf einer neuen Fassung – nach der Freigabe stimmen die Teams neu zu.`;
  if (rules?.kind === "league") return `Regelwerk: Das der Liga (${rules.label}) gilt weiter.`;
  return "Kein Regelwerk – vor der Anmeldung braucht die Season eines.";
}

/** Der Satz für das eigene Co-Team: „Übernommen aus Season 1: Liga 1 (Aufstieg aus Liga 2). Abmelden bis 05.01.2027.“ */
export function carryLine(carry) {
  if (!carry) return "";
  const way = carry.movement === "up" ? ` (Aufstieg aus ${carry.from_label})` : carry.movement === "down" ? ` (Abstieg aus ${carry.from_label})` : "";
  const until = carry.withdraw_until ? ` Abmelden bis zum Start am ${viennaDateTime(carry.withdraw_until, LONG)} Uhr.` : "";
  return `Übernommen aus ${carry.from_season_name || "der Vorgänger-Season"}: ${carry.division_label}${way}.${until}`;
}
