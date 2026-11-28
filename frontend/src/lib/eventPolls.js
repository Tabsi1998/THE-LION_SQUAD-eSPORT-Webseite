import { formatWhen } from "@/lib/datetime";

// Abstimmung im Event (#2612): Wörter und Regeln der Karte auf der Event-Seite. Die Zeiten kommen vom Server in UTC und
// stehen hier in Wiener Zeit (formatWhen). Der Server entscheidet, ob abgestimmt werden darf und ob das Ergebnis zu
// sehen ist - die Seite erklärt es nur.

/** Das Schild der Karte: offen, schon abgestimmt oder beendet (Arten aus lib/statusKinds.js). */
export function pollChip(poll) {
  if (poll?.status === "closed") return { kind: "done", label: "Beendet" };
  const voted = (poll?.rights || []).some((right) => right?.state === "used");
  return voted ? { kind: "joined", label: "Abgestimmt" } : { kind: "soon", label: "Offen" };
}

/** Die Frist in einem Satz - offen bis …, beendet seit …, oder offen bis zum Beenden. */
export function pollDeadlineText(poll, now = new Date()) {
  if (poll?.status === "closed") {
    const end = poll.closed_at || poll.closes_at;
    return end ? `Beendet seit ${formatWhen(end, { now })}` : "Beendet";
  }
  return poll?.closes_at ? `Abstimmen bis ${formatWhen(poll.closes_at, { now })}` : "Offen, bis die Verwaltung sie beendet";
}

/** Was die Abstimmung erlaubt: eine oder mehrere Antworten, Ergebnis sofort oder später. */
export function pollRuleText(poll) {
  const max = Number(poll?.max_choices) || 1;
  const choices = max > 1 ? `Bis zu ${max} Antworten` : "Eine Antwort";
  const result = poll?.results_visibility === "after_close"
    ? (poll?.closes_at ? "Ergebnis nach der Frist" : "Ergebnis nach dem Ende")
    : "Ergebnis sofort sichtbar";
  return `${choices} · ${result}`;
}

/** Warum das Ergebnis noch fehlt. */
export function pollHiddenText(poll, now = new Date()) {
  return poll?.closes_at
    ? `Das Ergebnis erscheint nach der Frist (${formatWhen(poll.closes_at, { now })}).`
    : "Das Ergebnis erscheint, sobald die Abstimmung beendet ist.";
}

/** Eine Antwort an- oder abwählen: bei einer Antwort ersetzt sie die alte, bei mehreren bis zur Grenze. */
export function toggleChoice(current, code, max = 1) {
  const list = Array.isArray(current) ? current : [];
  if (list.includes(code)) return list.filter((item) => item !== code);
  if ((Number(max) || 1) <= 1) return [code];
  return list.length >= max ? list : [...list, code];
}

/** Die eigene Stimme (erstes Stimmrecht - heute „Deine Stimme“, mit #2615 auch Begleitpersonen). */
export function chosenOf(poll) {
  const choices = poll?.rights?.[0]?.choices;
  return Array.isArray(choices) ? choices : [];
}
