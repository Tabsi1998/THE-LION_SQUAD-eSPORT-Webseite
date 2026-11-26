// Startrechte für die nächste Season (#1627, docs/LIGA.md „F.2a Startrechte für die nächste Season“): Wörter und Sätze für die
// Verwaltung (Reiter „Anmeldung und Kader“) und für das eigene Team (unter Teams, Ligaseite). Zustände, Fristen und die
// Nachrückerregel rechnet der Server - hier steht nur, wie sie heißen.
import { viennaDateTime } from "@/lib/vienna";
import { MOVEMENT_TEXT } from "@/lib/leagueSuccessor";

const LONG = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };

// Getrennte Zustände: Prognose, bestätigt, Zusage, Teilnahme. „Zugesagt“ ist nicht „Spielt mit“ - das ist erst die Zuteilung.
const STATE_LABEL = {
  forecast: "Prognose", confirmed: "Automatisch dabei", offered: "Zusage offen", accepted: "Zugesagt", declined: "Abgemeldet",
  expired: "Verfallen", revoked: "Zurückgenommen", participating: "Spielt mit", rejected: "Abgelehnt", waitlist: "Warteliste",
};
// Farbe des Abzeichens: offen fällt auf, erledigt ist ruhig, verloren gedämpft.
const STATE_TONE = { offered: "warn", accepted: "ok", participating: "ok", confirmed: "info", declined: "muted", expired: "muted", revoked: "muted",
  rejected: "muted", waitlist: "warn" };
const COUNT_ORDER = [["offered", "Zusage offen"], ["accepted", "zugesagt"], ["confirmed", "automatisch dabei"], ["participating", "spielen mit"],
  ["declined", "abgemeldet"], ["expired", "verfallen"], ["rejected", "abgelehnt"], ["waitlist", "auf der Warteliste"], ["revoked", "zurückgenommen"]];
const WHY_TEXT = { declined: "abgemeldet", expired: "Frist verfallen", rejected: "von der Leitung abgelehnt" };
const GROUP_TEXT = { non_promoted: "der beste Nicht-Aufsteiger", relegated: "der beste Absteiger bleibt" };

// Kurz gehalten: Die Auswahl muss am Handy (390 px) ganz lesbar sein - die Erklärung steht im Hinweis darunter.
export const MODE_OPTIONS = [["accept", "Mit Zusage innerhalb der Frist"], ["auto", "Automatisch dabei"]];
export const SUCCESSOR_OPTIONS = [["next", "Automatisch nach der Regel"], ["lead", "Die Leitung löst es aus"]];

export const stateLabel = (state) => STATE_LABEL[state] || "";
export const stateTone = (state) => STATE_TONE[state] || "muted";
export const whyText = (why) => WHY_TEXT[why] || "";

/** „15.12.2026, 18:00 Uhr“ in Wiener Zeit - leer ohne Frist. */
export function untilText(value) {
  return value ? `${viennaDateTime(value, LONG)} Uhr` : "";
}

/** Die Zeile über der Übersicht: „4 Zusage offen · 3 zugesagt · 1 verfallen“ - nur, was es gibt. */
export function countsLine(counts) {
  return COUNT_ORDER.filter(([key]) => counts?.[key]).map(([key, word]) => `${counts[key]} ${word}`).join(" · ");
}

/** Der Satz für das eigene Co-Team unter dem Antrag. Leer ohne Startrecht (Season ohne die Einstellung) und sobald es zugeteilt ist. */
export function rightLine(carry) {
  const right = carry?.start_right;
  if (!right) return "";
  const label = carry.division_label;
  const back = right.fills?.from_label;
  if (right.state === "offered") {
    // Startdatum erreicht und Frist vorbei: Es verfällt nicht mehr von selbst - die Leitung entscheidet.
    if (right.waits_for_lead) return `Die Frist für die Zusage zu ${label} ist vorbei. Jetzt entscheidet die Liga-Leitung – meldet euch dort.`;
    // Pause: Der Endstand der Vorgänger-Season wird geprüft, die Frist steht still und ist danach um diese Zeit länger.
    if (right.paused && right.fills) return `Nachgerückt: In ${label} ist ein Platz frei geworden. Die Frist ruht, solange der Endstand der Vorgänger-Season geprüft wird. Zusagen oder ablehnen geht trotzdem – ohne Antwort bleibt ihr in ${back}.`;
    if (right.paused) return `Startrecht für ${label}: Die Frist ruht, solange der Endstand der Vorgänger-Season geprüft wird – danach läuft sie um diese Zeit länger. Zusagen geht trotzdem.`;
    if (right.fills) return `Nachgerückt: In ${label} ist ein Platz frei geworden. Bitte bis ${untilText(right.accept_until)} zusagen oder ablehnen – ohne Antwort bleibt ihr in ${back}.`;
    return `Startrecht für ${label}: bitte bis ${untilText(right.accept_until)} zusagen. Ohne Zusage verfällt es.`;
  }
  if (right.state === "confirmed" && right.fills) return `Nachgerückt in ${label}. Wer lieber in ${back} bleibt, lehnt bis zum Start ab.`;
  if (right.state === "accepted") return `Zugesagt für ${label}. Die Staffel teilt die Liga-Leitung noch zu.`;
  if (right.state === "expired") return "Das Startrecht ist verfallen: Die Frist für die Zusage ist vorbei.";
  return "";
}

/** Das Abzeichen am Antrag des eigenen Teams - leer heißt: wie bisher (`teamStateLabel`). */
export function teamBadge(row) {
  const state = row?.carry_over?.start_right?.state;
  if (state === "offered" && row.carry_over.start_right.waits_for_lead) return "Startrecht – Leitung entscheidet";
  if (state === "offered") return "Startrecht – Zusage offen";
  if (state === "accepted") return "Zugesagt – Zuteilung folgt";
  if (state === "expired") return "Startrecht verfallen";
  return "";
}

/** Die Farbe dazu: offen fällt auf, verfallen ist gedämpft - ``undefined`` heißt: die Farbe des Antrags. */
export function teamBadgeTone(row) {
  const state = row?.carry_over?.start_right?.state;
  return state === "offered" ? "warn" : state === "expired" ? "quiet" : undefined;
}

/** Vor der Folge-Season: Prognose aus der laufenden Tabelle bzw. bestätigtes Startrecht aus dem Endstand. */
export function outlookLine(item) {
  if (!item) return "";
  const move = item.movement === "stay" ? "bleibt in der Liga" : MOVEMENT_TEXT[item.movement] || "";
  if (item.state === "forecast") {
    const place = item.rank ? ` (Platz ${item.rank})` : "";
    return `Prognose nach der laufenden Tabelle: ${move}${place}. Fest ist das erst, wenn die Season abgeschlossen ist.`;
  }
  const way = item.movement === "stay" ? "" : ` (${move})`;
  return `Bestätigt: Startrecht für ${item.division_label} in der nächsten Season${way}. Zusagen geht, sobald die neue Season angelegt ist.`;
}

/** Ein frei gewordener Platz in der Verwaltung: warum er frei ist und wer nach der Regel dran ist. */
export function placeLine(place, { paused = false, started = false } = {}) {
  const names = Object.fromEntries((place.candidates || []).map((row) => [row.application_id, row.display_name]));
  const head = `${place.division_label}: Platz von ${place.display_name} frei (${whyText(place.why)}).`;
  // In der Pause und ab dem Startdatum rückt niemand nach - dann nennt die Zeile keinen Vorschlag.
  if (paused) return `${head} Solange der Endstand der Vorgänger-Season geprüft wird, rückt niemand nach.`;
  if (started) return `${head} Das Startdatum ist erreicht: Nachrücken geht nur noch von Hand im Eingang.`;
  if (place.pick) return `${head} Nach der Regel rückt ${names[place.pick]} nach – ${GROUP_TEXT[place.group] || "der Nächste der Tabelle"}.`;
  if (place.tied?.length) return `${head} Gleichstand zwischen ${place.tied.map((key) => names[key]).join(" und ")} – ein Los gibt es nicht, bitte wählen.`;
  return `${head} Es gibt keinen Nachrücker – der Platz ist frei für Warteliste und Anmeldungen.`;
}

/** Das Formular der Einstellung: ohne gespeicherte Einstellung aus, mit den Vorgaben vorbelegt. */
export function settingsForm(settings, defaults) {
  return { active: Boolean(settings), ...(defaults || {}), ...(settings || {}) };
}

/** Die Eingabe als Werte für den Server: ganze Zahlen, ein leeres Zahlenfeld nimmt die Vorgabe. Ausgeschaltet schickt nur das.
 * `confirmOpen`: die Rückfrage ist bestätigt - offene Startrechte dürfen als zugesagt gelten. */
export function settingsPayload(form, confirmOpen = false) {
  const confirmed = confirmOpen ? { confirm_open: true } : {};
  if (!form.active) return { active: false, ...confirmed };
  const number = (value) => (value === "" || value == null ? null : Number.parseInt(String(value), 10));
  return { active: true, mode: form.mode, accept_days: number(form.accept_days), successor: form.successor, remind_hours: number(form.remind_hours),
    announce: Boolean(form.announce), ...confirmed };
}

/** Die Rückfrage vor dem Ausschalten bzw. Umschalten auf „automatisch“: Offene Startrechte gelten dann als zugesagt. Leer, wenn
 * es bei „mit Zusage“ bleibt oder nichts offen ist - dann gibt es nichts zu fragen. */
export function openRightsQuestion(form, openRights) {
  const count = Number(openRights) || 0;
  if (!count || (form.active && form.mode === "accept")) return "";
  return count === 1 ? "1 offenes Startrecht gilt dann als zugesagt und braucht keine Zusage mehr."
    : `${count} offene Startrechte gelten dann als zugesagt und brauchen keine Zusage mehr.`;
}
