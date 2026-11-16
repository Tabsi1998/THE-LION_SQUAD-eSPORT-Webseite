// Kleine Helfer der Staffel-Seite (#2262), von Überblick und Teilnehmer gemeinsam genutzt.
import { lateEntryText } from "@/lib/leagueTable";
import { staffelManageUrl } from "@/lib/staffelTabs";

// Wer in der Staffel spielt: zugeteilt (der Server nennt es „approved“; „checked_in“ aus alten Ständen zählt mit).
export const ACTIVE_STAFFEL_REGISTRATION = new Set(["approved", "checked_in"]);

/** Für „Was fehlt“ (`staffelNeeds`): Zuteilen führt zum Abschnitt „Co-Team zuteilen“, alles andere an seine Stelle. */
export const needsUrl = (tournamentId) => (tab) => staffelManageUrl(tournamentId, tab, tab === "participants" ? "zuteilen" : "");

/** „Nachgemeldet ab Woche 3“ an einer Anmeldung (`late_entry.from_week`) - derselbe Satz wie in Tabelle, TV und Druck. */
export function registrationLateText(registration) {
  const late = registration?.late_entry;
  if (!late) return "";
  return lateEntryText({ late_entry: true, late_from_week: typeof late === "object" ? late.from_week : null });
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
