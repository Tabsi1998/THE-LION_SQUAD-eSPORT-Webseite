// Selbstanmeldung mit Co-Team (docs/LIGA.md, B.4, #2205): Texte zu dem, was der Server schickt, und das Formular der Season. Geprüft wird auf dem Server.
import { asInstant, fromViennaInput, viennaDateTime, viennaInputValue } from "@/lib/vienna";

const LONG = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };

export const APPLICATION_STATES = {
  none: { label: "Nicht angemeldet", tone: "quiet" },
  open: { label: "Anmeldung offen", tone: "info" },
  submitted: { label: "Eingereicht", tone: "info" },
  in_review: { label: "In Prüfung", tone: "info" },
  accepted: { label: "Angenommen", tone: "ok" },
  rejected: { label: "Abgelehnt", tone: "warn" },
  waitlist: { label: "Warteliste", tone: "warn" },
  withdrawn: { label: "Zurückgezogen", tone: "quiet" },
};
export const STATE_CLASS = {
  quiet: "border-white/15 text-white/60",
  info: "border-[#29B6E8]/50 text-[#29B6E8]",
  ok: "border-ok/50 text-ok",
  warn: "border-warn/50 text-warn",
};
// Solange das Co-Team hier steht, läuft sein Antrag.
const RUNNING = new Set(["submitted", "in_review", "accepted", "waitlist"]);

/** Was das eigene Team sieht (#2348): angenommen heißt dort „Angemeldet“, ohne Staffel mit „Zuteilung folgt“. Die Leitung liest weiter „Angenommen“. */
export function teamStateLabel(state, application) {
  if (state === "accepted" && !application?.staffel_left) return application?.staffel ? "Angemeldet" : "Angemeldet – Zuteilung folgt";
  return (APPLICATION_STATES[state] || APPLICATION_STATES.none).label;
}

/** Nach dem Einreichen: was jetzt gilt - mit „automatisch annehmen“ entscheidet die Season gleich (#2348). ``solo``: als Spieler (#1629, P2). */
export function submittedToast(status, solo = false) {
  if (status === "accepted") return solo ? "Angemeldet. Du hast einen Startplatz." : "Angemeldet. Ihr habt einen Startplatz.";
  if (status === "waitlist") return solo ? "Eingereicht. Du stehst auf der Warteliste." : "Eingereicht. Ihr steht auf der Warteliste.";
  return "Anmeldung eingereicht. Die Liga-Leitung prüft sie jetzt.";
}

/**
 * Solo-Liga (#1629, P2): Die Person meldet sich selbst an. Der Server sagt es mit ``kind: "solo"`` (eigene Sicht) bzw.
 * ``participant_kind: "solo"`` (öffentlicher Block) - Team-Ligen tragen keines der Felder.
 */
export function isSoloApplication(view, block) {
  return view?.kind === "solo" || block?.participant_kind === "solo";
}

/** Darf die Person sich jetzt als Spieler anmelden? Dann steht der Knopf „Als Spieler anmelden“ auf der Ligaseite - sonst sagen die
 * Gründe der Prüfung, warum nicht (``player.problems``). */
export function canStartPersonApplication(view) {
  if (view?.kind !== "solo" || view?.application?.state !== "open" || view?.season_problems?.length) return false;
  return Boolean(view.player?.can_submit) && !RUNNING.has(view.player.state);
}

/** Hinweis in der Verwaltung bei „automatisch annehmen“: Offene Anmeldungen bleiben bei der Leitung und halten ihren Platz (wer zuerst kommt, wird zuerst bedient). */
export function waitingLine(count) {
  if (!count) return "";
  return count === 1 ? "1 Anmeldung wartet auf Prüfung und hält ihren Platz frei" : `${count} Anmeldungen warten auf Prüfung und halten ihren Platz frei`;
}

export const ENTRY_POLICY_OPTIONS = [["all", "Alle Konten, auch externe Teams"], ["members", "Nur Vereinsmitglieder"]];
// Solo-Liga (#1629, P2): Es melden sich Personen an, keine Teams.
export const ENTRY_POLICY_OPTIONS_SOLO = [["all", "Alle Konten"], ["members", "Nur Vereinsmitglieder"]];

function when(value) {
  return `${viennaDateTime(value, LONG)} Uhr`;
}

/** Der Stand des Fensters als kurzer Satz. */
export function windowLine(block) {
  if (block?.state === "open") return `Offen bis ${when(block.closes_at)}`;
  if (block?.state === "upcoming") return `Öffnet am ${when(block.opens_at)}`;
  // Abgesagt (#2607): Die Anmeldung endete mit der Absage - der Satz nennt sie, nie „vorbei seit“ einem späteren Fensterende.
  if (block?.state === "closed" && block.cancelled) return `Abgesagt am ${when(block.cancelled_at || block.closes_at)}`;
  if (block?.state === "closed") return `Vorbei seit ${when(block.closes_at)}`;
  return "";
}

/**
 * Nachmeldung (Entscheidung Nr. 180, #1632): Endet die Anmeldung nach dem Beginn der Season, sagt es ein Satz - sonst leer.
 * `closesAt` und `startAt` sind Zeitpunkte vom Server oder aus dem Formular (ohne Zone als Wiener Uhr).
 */
export function afterStartLine(closesAt, startAt) {
  if (!closesAt || !startAt) return "";
  const closes = asInstant(closesAt);
  const start = asInstant(startAt);
  if (Number.isNaN(closes.getTime()) || Number.isNaN(start.getTime()) || closes <= start) return "";
  return `Anmeldung läuft nach Season-Start weiter (bis ${when(closes)}).`;
}

/** Vorgabe der Nachmeldefrist (#2422, Nr. 184) - dieselbe wie auf dem Server (services/league_late.DEFAULT_DAYS). */
export const LATE_DAYS_DEFAULT = 14;

/**
 * Das wirksame Ende der Anmeldung (#2422, Nr. 184): min(Ende des Fensters, Start + Frist), mit Verlängerung der Leitung
 * min(Fenster, max(Start + Frist, Verlängerung)).
 * Endet das Fenster vor dem Start, bleibt es beim Fenster. Gibt ein Date zurück oder null.
 */
export function effectiveCloses(closesAt, startAt, days, extensionUntil) {
  if (!closesAt) return null;
  const closes = asInstant(closesAt);
  if (Number.isNaN(closes.getTime())) return null;
  const start = startAt ? asInstant(startAt) : null;
  if (!start || Number.isNaN(start.getTime()) || closes <= start) return closes;
  const parsed = days === "" || days == null ? LATE_DAYS_DEFAULT : Number(days);
  const span = Number.isFinite(parsed) && parsed >= 0 ? parsed : LATE_DAYS_DEFAULT;
  const regular = new Date(start.getTime() + span * 86400000);
  // Eine Verlängerung verlängert nur, sie verkürzt nie (Review #2422): max(regulär, Verlängerung), begrenzt aufs Fensterende.
  const extended = extensionUntil ? asInstant(extensionUntil) : null;
  const cap = extended && !Number.isNaN(extended.getTime()) && extended > regular ? extended : regular;
  return closes <= cap ? closes : cap;
}

/** Hinweis in der Verwaltung, wenn die Frist die Anmeldung früher schließt als das Fenster. */
export function lateCapLine(closesAt, startAt, days, extensionUntil) {
  const effective = effectiveCloses(closesAt, startAt, days, extensionUntil);
  if (!effective || !closesAt || effective >= asInstant(closesAt)) return "";
  // Nur wenn die Verlängerung wirklich das Ende setzt - sonst gilt die (längere) Frist.
  const viaExtension = extensionUntil && asInstant(extensionUntil).getTime() === effective.getTime();
  return viaExtension
    ? `Verlängert bis ${when(effective)}. Danach schließt die Anmeldung, auch wenn das Fenster länger eingestellt ist.`
    : `Die Anmeldung schließt am ${when(effective)}, auch wenn das Fenster länger eingestellt ist.`;
}

/** Startplätze für die Ligaseite - ohne Grenze kein Satz. */
export function seatsLine(block) {
  if (!block?.slots) return "";
  if (block.slots_free > 0) return `${block.slots_free} von ${block.slots} Startplätzen frei`;
  if (!block.waitlist) return `Alle ${block.slots} Startplätze vergeben`;
  return block.waitlist_full ? `Alle ${block.slots} Startplätze vergeben, auch die Warteliste ist voll` : `Alle ${block.slots} Startplätze vergeben, die Warteliste ist offen`;
}

/** Die Zahlen oben im Eingang. */
export function statsLine(stats = {}) {
  const parts = [stats.slots ? `${stats.taken} von ${stats.slots} Startplätzen belegt` : "Keine Grenze bei den Startplätzen"];
  if (stats.open) parts.push(`${stats.open} offen`);
  if (stats.waiting) parts.push(`${stats.waiting} auf der Warteliste`);
  if (stats.unassigned) parts.push(`${stats.unassigned} noch ohne Staffel`);
  if (!stats.open && !stats.waiting && !stats.unassigned) parts.push("nichts offen");
  return parts.join(" · ");
}

/** Gibt es jemanden, der jetzt anmelden kann? Dann steht der Knopf auf der Ligaseite. */
export function canStartApplication(view) {
  if (view?.application?.state !== "open" || view?.season_problems?.length) return false;
  return (view?.squads || []).some((row) => row.can_apply && !RUNNING.has(row.state));
}

/** Ist dieses Co-Team im Assistenten wählbar? Ein laufender Antrag steht nur da. */
export function isSelectable(row) {
  return row.can_apply && !RUNNING.has(row.state);
}

const text = (value) => (value == null ? "" : String(value));
const number = (value) => (value === "" || value == null ? null : Number(value));
const clean = (value) => (value || "").trim() || null;

/** Die Selbstanmeldung einer Season als Formular. */
export function applicationToForm(season = {}) {
  return {
    application_opens: viennaInputValue(season.application_opens_at),
    application_closes: viennaInputValue(season.application_closes_at),
    application_slots: text(season.application_slots),
    application_waitlist: season.application_waitlist ?? true,
    application_waitlist_limit: text(season.application_waitlist_limit),
    application_waitlist_note: season.application_waitlist_note || "",
    application_privacy_text: season.application_privacy_text || "",
    entry_policy: season.entry_policy || "all",
    sibling_squads_in_staffel: Boolean(season.sibling_squads_in_staffel),
    // Neue Co-Teams starten in der untersten Liga (#1623): Seasons von vorher tragen das Feld nicht - dann ist es aus.
    new_squads_lowest_division: Boolean(season.new_squads_lowest_division),
    application_auto_accept: Boolean(season.application_auto_accept),
    // Nachmeldefrist (#2422): leer heißt Vorgabe (14 Tage nach dem Start).
    late_registration_days: text(season.late_registration_days),
    // Seasons von vor #2205 tragen die Felder nicht. Niemand hat sie angefasst: Dann geht auch nichts mit.
    had_application: season.entry_policy != null || season.application_opens_at != null,
  };
}

/** Das Formular als Anfrage, leer heißt ``null``. Eine ältere Season, an der niemand etwas eingetragen hat, bleibt, wie sie ist. */
export function applicationPayload(form) {
  const touched = form.had_application || form.application_opens || form.application_closes;
  if (!touched) return {};
  return {
    application_opens_at: fromViennaInput(form.application_opens),
    application_closes_at: fromViennaInput(form.application_closes),
    application_slots: number(form.application_slots),
    application_waitlist: Boolean(form.application_waitlist),
    application_waitlist_limit: number(form.application_waitlist_limit),
    application_waitlist_note: clean(form.application_waitlist_note),
    application_privacy_text: clean(form.application_privacy_text),
    entry_policy: form.entry_policy || "all",
    sibling_squads_in_staffel: Boolean(form.sibling_squads_in_staffel),
    new_squads_lowest_division: Boolean(form.new_squads_lowest_division),
    application_auto_accept: Boolean(form.application_auto_accept),
    late_registration_days: number(form.late_registration_days),
  };
}
