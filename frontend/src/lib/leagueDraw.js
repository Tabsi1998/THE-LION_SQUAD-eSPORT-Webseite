// Los auf mehrere Staffeln einer Liga N (#1623, docs/LIGA.md „B.4 Los auf mehrere Staffeln“): Wörter für Panel und Vorschau.
// Gelost, geprüft und gezählt wird auf dem Server - hier steht nur, wie es heißt.
import { viennaDateTime } from "@/lib/vienna";

const WHEN = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };
const STEP_TEXT = { create: "Ausgelost", redraw: "Neu ausgelost", swap: "Getauscht", apply: "Übernommen" };

export const DRAW_REASON_MIN = 5;

export function drawWhen(value) {
  return value ? viennaDateTime(value, WHEN) : "";
}

/** „3 Co-Teams warten auf eine Staffel“. */
export function waitingLine(division) {
  const count = division?.waiting?.length || 0;
  if (!count) return "Kein Co-Team wartet auf eine Staffel";
  return count === 1 ? "1 Co-Team wartet auf eine Staffel" : `${count} Co-Teams warten auf eine Staffel`;
}

/** Startrechte (#1627, F.2a): wer noch nicht zugesagt hat, steht nicht im Los - der Satz dazu, leer ohne solche Co-Teams. */
export function openRightsLine(division) {
  const rows = division?.waiting_start_right || [];
  if (!rows.length) return "";
  const names = rows.map((row) => row.display_name).join(", ");
  return rows.length === 1
    ? `1 Co-Team hat sein Startrecht noch nicht angenommen und kommt erst nach der Zusage ins Los: ${names}.`
    : `${rows.length} Co-Teams haben ihr Startrecht noch nicht angenommen und kommen erst nach der Zusage ins Los: ${names}.`;
}

/** „Staffel A 2 von 8 · Staffel B 0 von 8“. */
export function staffelnLine(staffeln = []) {
  if (!staffeln.length) return "Noch keine Staffel";
  return staffeln.map((row) => `Staffel ${row.staffel} ${row.seats} von ${row.max_participants}`).join(" · ");
}

/** Braucht diese Liga N das Panel? Mehrere Staffeln mit wartenden Teams, ein Los zum Nachlesen oder eine Platzprüfung, die nicht passt. */
export function divisionNeedsDraw(division) {
  if (!division) return false;
  if (division.draw) return true;
  const waiting = division.waiting?.length || 0;
  if (waiting && (division.staffeln?.length || 0) > 1) return true;
  return Boolean(division.suggestion?.teams) && division.suggestion?.fits === false;
}

export function drawVisible(data) {
  return Boolean(data?.divisions?.some(divisionNeedsDraw));
}

/** Der Stand eines Loses: Vorschau, veraltet oder übernommen. */
export function drawStatusLine(draw) {
  if (!draw) return "";
  const head = `Los Nr. ${draw.number}`;
  if (draw.status === "applied") return `${head} – übernommen am ${drawWhen(draw.applied_at)}`;
  return draw.stale ? `${head} – veraltet: Seitdem hat sich etwas geändert` : `${head} – Vorschau, noch nicht übernommen`;
}

/** Eine Zeile des Protokolls: wann, was, wer, warum. */
export function drawLogLine(step) {
  const what = `${STEP_TEXT[step.action] || step.action}${step.number && step.action !== "swap" && step.action !== "apply" ? ` (Los Nr. ${step.number})` : ""}`;
  const why = step.reason ? `, Grund: ${step.reason}` : step.stale ? ", weil sich die Eingabe geändert hatte" : "";
  const override = step.conflict_reason ? ` (Notausnahme: ${step.conflict_reason})` : "";
  return `${drawWhen(step.at)}: ${what}, ${step.by_name}${why}${override}`;
}

/** Mit wem ein gelostes Co-Team tauschen kann: alle aus den anderen Staffeln, als Optionen ``[squad_id, Text]``. */
export function swapPartners(draw, squadId) {
  const staffeln = draw?.staffeln || [];
  const own = staffeln.find((staffel) => (staffel.teams || []).some((team) => team.squad_id === squadId));
  if (!own) return [];
  return staffeln.filter((staffel) => staffel !== own)
    .flatMap((staffel) => (staffel.teams || []).map((team) => [team.squad_id, `${team.display_name} · Staffel ${staffel.staffel}`]));
}
