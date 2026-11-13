// Saisonabschluss (F.1, #1645, docs/LIGA.md „F.1 Saisonabschluss“): Texte und kleine Rechnungen für das Cockpit der Season und den
// Endstand auf der Ligaseite. Was abgeschlossen werden darf, entscheidet der Server - hier steht nur, wie es heißt.
import { viennaDate, viennaDateTime } from "@/lib/vienna";

const DAY = { day: "2-digit", month: "2-digit", year: "numeric" };
const MOMENT = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };

export const REASON_MIN = 5;

function safe(format, value, options) {
  try {
    return value ? format(value, options) : "";
  } catch {
    return "";
  }
}

export const finalDay = (value) => safe(viennaDate, value, DAY);
export const finalMoment = (value) => safe(viennaDateTime, value, MOMENT);

/** „Liga 1 · Staffel A“ - der Name einer Staffel im Cockpit. */
export function staffelLabel(row) {
  return [row?.division_label, row?.staffel ? `Staffel ${row.staffel}` : ""].filter(Boolean).join(" · ") || row?.title || "Staffel";
}

/** Stand einer Staffel: abgeschlossen, bereit (nichts hält auf) oder offen (mit der Zahl der Sperrgründe, kurz: „4 offen“). */
export function closeState(row) {
  if (row?.closed) return { key: "closed", label: "Abgeschlossen" };
  const open = (row?.blockers || []).length;
  if (!open) return { key: "ready", label: "Bereit zum Abschluss" };
  return { key: "blocked", label: `${open} offen` };
}

/** „2 von 3 Staffeln abgeschlossen“ - und ob die Season damit abgeschlossen ist. */
export function seasonSummary(data) {
  const rows = data?.staffeln || [];
  if (!rows.length) return "Noch keine gestartete Staffel.";
  const done = rows.filter((row) => row.closed).length;
  if (done === rows.length) return rows.length === 1 ? "Die Staffel ist abgeschlossen – die Season ist beendet." : `Alle ${rows.length} Staffeln sind abgeschlossen – die Season ist beendet.`;
  return `${done} von ${rows.length} ${rows.length === 1 ? "Staffel" : "Staffeln"} abgeschlossen. Die Season ist beendet, wenn alle abgeschlossen sind.`;
}

/** „bis 14.11.2026, 18:00“ - nur wenn der Punkt eine Frist trägt. */
export function untilText(item) {
  const text = finalMoment(item?.until);
  return text ? `bis ${text}` : "";
}

/** Auswahl „Wie wurde entschieden?“ aus der Antwort des Servers (`methods`). */
export function methodOptions(methods) {
  return Object.entries(methods || {});
}

/** Die Zeile über der Tabelle der Ligaseite: „Endstand · abgeschlossen am 12.11.2026“. */
export function finalNote(final) {
  if (!final) return "";
  const day = finalDay(final.closed_at);
  return day ? `Endstand · abgeschlossen am ${day}` : "Endstand";
}

/** Ein Entscheid im Endstand: „Probe 2 vor Probe 3 – Entscheidungsspiel: 2:1 gewonnen“. */
export function decisionLine(decision) {
  const order = (decision?.names || []).join(" vor ");
  const how = [decision?.method_label, decision?.reason].filter(Boolean).join(": ");
  return [order, how].filter(Boolean).join(" – ");
}

/** Ein Eintrag im Verlauf: „Fassung 1 · 12.11.2026, 18:00 · Erste Leitung“. */
export function historyLine(entry) {
  return [`Fassung ${entry?.version ?? "?"}`, finalMoment(entry?.closed_at), entry?.closed_by_name].filter(Boolean).join(" · ");
}

/** Fehlt beim Wiederöffnen noch etwas? Der Satz dazu - leer, wenn es losgehen kann. */
export function reopenProblem({ reason, needsEmergency, emergencyReason, needsConflict, conflictReason }) {
  if (String(reason || "").trim().length < REASON_MIN) return `Bitte einen Grund mit mindestens ${REASON_MIN} Zeichen angeben.`;
  if (needsEmergency && String(emergencyReason || "").trim().length < REASON_MIN) {
    return `Du hast selbst abgeschlossen: Bitte den Grund für die Notausnahme mit mindestens ${REASON_MIN} Zeichen angeben.`;
  }
  if (needsConflict && String(conflictReason || "").trim().length < REASON_MIN) {
    return `Dein eigenes Team spielt in dieser Staffel: Bitte den Grund für die Notausnahme mit mindestens ${REASON_MIN} Zeichen angeben.`;
  }
  return "";
}
