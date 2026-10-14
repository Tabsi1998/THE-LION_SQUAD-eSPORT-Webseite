// Namen im Turnierbaum (#1591) - Web-Baum und TV-Baum. Die Turnierleitung schreibt Rundennamen oft nach der Uhr
// („# Runde 2“ im Loser Bracket, weil es zur Zeit der zweiten Runde beginnt); angezeigt wird je Abschnitt fortlaufend ab
// 1. Ein Wort als Spiel-Kürzel („FINAL“) heißt wie seine Runde („Grand Final“). Ein geloster Platz zeigt, wer kommt:
// „Weiter aus Runde 1“ (Lauf), „Sieger aus Viertelfinale“ (Duell) bzw. „Verlierer aus Runde 2“ - kurz, in einer Zeile.
import { describeSlot, normalizeSource } from "@/lib/slotSource";

const GENERIC_ROUND = /^((?:Loser|Winner) )?Runde (\d+)$/i;

/** Rundennamen je Phase und Abschnitt fortlaufend ab 1 - nur die allgemeinen („Runde 2“, „Loser Runde 3“). Neue Liste. */
export function displayRoundLabels(matches = []) {
  const rounds = new Map();
  for (const match of matches || []) {
    const key = `${match?.stage_id || ""}|${match?.section || ""}`;
    if (!rounds.has(key)) rounds.set(key, new Set());
    rounds.get(key).add(Number(match?.round || 0));
  }
  const order = new Map([...rounds].map(([key, set]) => [key, [...set].sort((a, b) => a - b)]));
  return (matches || []).map((match) => {
    const label = String(match?.round_label || match?.round_name || "");
    const generic = GENERIC_ROUND.exec(label);
    if (!generic) return match;
    const index = order.get(`${match.stage_id || ""}|${match.section || ""}`).indexOf(Number(match.round || 0)) + 1;
    const shown = `${generic[1] || ""}Runde ${index}`;
    return shown === label && match.round_label ? match : { ...match, round_label: shown };
  });
}

/** Wie ein Spiel in Texten heißt: das Kürzel („A“, „LC“) - ist das Kürzel ein Wort („FINAL“), der Rundenname. */
export function matchName(match) {
  const key = String(match?.match_key || "");
  if (key.length <= 3 || /\d/.test(key)) return key;
  return match?.round_label || key;
}

/** Der Text eines noch leeren Platzes im Baum (leer, wenn jemand drinsitzt oder nichts bekannt ist). */
export function treeSlotLabel(slot, findMatch = () => undefined) {
  const info = describeSlot(slot, () => "", findMatch);
  if (info.kind !== "pending") return "";
  const source = normalizeSource(slot?.source);
  if (!source?.draw || !source.match_key) return info.label;
  const from = findMatch(source.match_key);
  const round = from?.round_label || from?.round_name || (from?.round ? `Runde ${from.round}` : "");
  if (!round) return info.label;
  // Aus einem Duell kommt der Sieger, aus einem Lauf kommen die Weiterkommer.
  const duel = (from.slots || []).length <= 2 && String(from.match_type || "duel") === "duel";
  return `${source.flow === "W" ? (duel ? "Sieger" : "Weiter") : "Verlierer"} aus ${round}`;
}
