// Kleine Helfer der Staffel-Seite (#2262), von Überblick und Teilnehmer gemeinsam genutzt.
import { lateEntryText } from "@/lib/leagueTable";
import { staffelStand } from "@/lib/seasonTabs";
import { staffelManageUrl } from "@/lib/staffelTabs";
import { staffelBeforeStart } from "@/pages/admin/tournament/StaffelParts";

// Wer in der Staffel spielt: zugeteilt (der Server nennt es „approved“; „checked_in“ aus alten Ständen zählt mit).
export const ACTIVE_STAFFEL_REGISTRATION = new Set(["approved", "checked_in"]);

/** Hat die Person dieses Liga-Recht in der Staffel (`league_capabilities` vom Server)? */
export const hasCapability = (tournament, capability) => (tournament?.league_capabilities || []).includes(capability);

/** Für „Was fehlt“ (`staffelNeeds`): Zuteilen führt zum Abschnitt „Co-Team zuteilen“, alles andere an seine Stelle. */
export const needsUrl = (tournamentId) => (tab) => staffelManageUrl(tournamentId, tab, tab === "participants" ? "zuteilen" : "");

// Liga-Wörter statt Turnier-Status (Fabian zu #2262: kein „Entwurf“ bei Staffeln). Vor dem Start gibt es keinen Status zum Wählen.
export const STAFFEL_STATUS_WORDS = {
  live: "Spielbetrieb", paused: "Pausiert", completed: "Beendet", results_published: "Ergebnisse veröffentlicht", archived: "Archiviert",
  cancelled: "Abgesagt",
};
const BEFORE_START_WORD = "Vor dem Start";

// Was eine laufende Staffel wirklich braucht: weiterspielen, pausieren, beenden, absagen. Archivieren und den Endstand regelt die Season
// (Reiter Abschluss); steht die Staffel schon dort, zeigt die Auswahl den Stand zusätzlich an.
export const STAFFEL_RUNNING_STATUSES = ["live", "paused", "completed", "cancelled"];

/** Der Stand in Worten - dieselben Wörter wie das Abzeichen: Liga-Stand der Season, sonst „Vor dem Start“ bzw. das Liga-Wort. */
export function staffelStandText(tournament, now = new Date()) {
  const stand = staffelStand(tournament, { now });
  if (stand) return stand.label;
  if (staffelBeforeStart(tournament)) return BEFORE_START_WORD;
  return STAFFEL_STATUS_WORDS[tournament?.status] || BEFORE_START_WORD;
}

/** „Nachgemeldet ab Woche 3“ an einer Anmeldung (`late_entry.from_week`) - derselbe Satz wie in Tabelle, TV und Druck. */
export function registrationLateText(registration) {
  const late = registration?.late_entry;
  if (!late) return "";
  return lateEntryText({ late_entry: true, late_from_week: typeof late === "object" ? late.from_week : null });
}

/**
 * Kader-Hinweis je Co-Team aus der Kaderübersicht der Season (`GET …/roster`, nur mit „Kader prüfen“): „6 im Kader · alle IDs gültig“,
 * „4 im Kader · 1 ohne gültige ID“, unter der Mindestgröße als Warnung. Die Anmeldungen selbst tragen weder Kadergröße noch IDs - ohne
 * die Übersicht steht hier nichts. `{text, warn}` oder `null`.
 */
export function kaderLine(squad) {
  if (!squad) return null;
  const players = Array.isArray(squad.players) ? squad.players : [];
  const count = Number.isFinite(squad.member_count) ? squad.member_count : players.length;
  const missing = players.filter((player) => player && player.ok === false).length;
  const parts = [`${count} im Kader`];
  if (players.length) parts.push(missing ? `${missing} ohne gültige ID` : "alle IDs gültig");
  if (squad.short) parts.push(`unter Mindestkader ${squad.min_squad_size}`);
  return { text: parts.join(" · "), warn: Boolean(missing || squad.short) };
}

const ACTIVE_SANCTION = new Set(["active", "provisional"]);

/**
 * Aktive Strafen je Anmeldung aus dem Strafen-Reiter der Season (`GET …/sanctions`, nur mit „Strafen“): gegen das Co-Team oder
 * einen Spieler darin. Zuordnung über die Anmeldung, sonst über das Co-Team in dieser Staffel. `{registrationId: [Strafe]}`.
 */
export function sanctionsByRegistration(items = [], registrations = [], tournamentId = "") {
  const out = {};
  const active = (items || []).filter((row) => ACTIVE_SANCTION.has(row?.status));
  for (const registration of registrations || []) {
    const rows = active.filter((row) => row.registration_id === registration.id
      || (registration.squad_id && row.squad_id === registration.squad_id && (!row.tournament_id || row.tournament_id === tournamentId)));
    if (rows.length) out[registration.id] = rows;
  }
  return out;
}
