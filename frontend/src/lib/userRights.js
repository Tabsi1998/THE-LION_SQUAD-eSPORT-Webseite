// Alle Benutzer (#1357): Rolle und Freigaben ändern sich erst mit „Speichern“ und einer Rückfrage. Die Rückfrage sagt in
// einem Satz, was die Person damit bekommt oder verliert - aus denselben Bereichen wie der Server (lib/permissions.js).
import { AREAS, GRANTABLE_AREAS, ROLE_AREAS, areaLabel, roleLabel } from "@/lib/permissions";

// Was ein Bereich in Alltagswörtern öffnet - für die Rückfrage.
export const AREA_ACCESS = {
  tournaments: "Turniere, Events, Stationen, Fast Lap, Jahreswertung und Gewinne",
  content: "News, Galerie, Medien, Sponsoren, Partner und Navigation",
  club: "Mitgliederdaten, Anträge, Dokumente und Benutzer",
  finance: "Rechnungsaufträge, Kosten und Freigaben",
  system: "Einstellungen, Betrieb, Logs und Verbindungen",
  moderation: "Meldungen, Wortfilter und Verwarnungen",
};

export const ADMIN_ROLES = ["moderator", "tournament_admin", "club_admin", "superadmin"];

/** Bereiche aus Rolle und Freigaben, in der festen Reihenfolge. */
export function effectiveAreas(role, grants = []) {
  const fromRole = ROLE_AREAS[role] || [];
  const granted = (grants || []).filter((area) => GRANTABLE_AREAS.includes(area));
  return AREAS.filter((area) => fromRole.includes(area) || granted.includes(area));
}

function joinWords(words) {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} und ${words[words.length - 1]}`;
}

function accessText(areas) {
  return joinWords(areas.map((area) => `${areaLabel(area)} (${AREA_ACCESS[area] || areaLabel(area)})`));
}

/**
 * Was eine Änderung von Rolle und Freigaben bedeutet.
 * @returns {{ changed: boolean, roleChanged: boolean, grantsChanged: boolean, gained: string[], lost: string[], sentence: string, risky: boolean }}
 */
export function rightsChange({ name, fromRole, toRole, fromGrants = [], toGrants = [] }) {
  const person = name || "Die Person";
  const roleChanged = (fromRole || "player") !== (toRole || "player");
  const sortedFrom = [...(fromGrants || [])].filter((area) => GRANTABLE_AREAS.includes(area)).sort();
  const sortedTo = [...(toGrants || [])].filter((area) => GRANTABLE_AREAS.includes(area)).sort();
  const grantsChanged = sortedFrom.join(",") !== sortedTo.join(",");
  const before = effectiveAreas(fromRole, fromGrants);
  const after = effectiveAreas(toRole, toGrants);
  const gained = after.filter((area) => !before.includes(area));
  const lost = before.filter((area) => !after.includes(area));
  const parts = [];
  if (roleChanged && toRole === "superadmin") {
    parts.push(`${person} wird Superadmin und bekommt damit Zugriff auf alles – auch auf Rollen, Freigaben und das Sperren von Admin-Konten.`);
  } else {
    if (roleChanged) parts.push(`${person} bekommt die Rolle „${roleLabel(toRole)}“.`);
    if (gained.length) parts.push(`${person} bekommt damit Zugriff auf ${accessText(gained)}.`);
    if (lost.length) parts.push(`${person} verliert damit den Zugriff auf ${accessText(lost)}.`);
    if (!gained.length && !lost.length && (roleChanged || grantsChanged)) parts.push("An den Bereichen ändert sich dadurch nichts.");
  }
  const risky = gained.length > 0 || (roleChanged && ADMIN_ROLES.includes(toRole));
  return { changed: roleChanged || grantsChanged, roleChanged, grantsChanged, gained, lost, sentence: parts.join(" "), risky };
}

/** Wie das Blatt den Stand der Einladung zum Mitgliedsantrag nennt. */
export function invitationText(invitation, formatDay) {
  if (!invitation?.status) return "";
  const day = (value) => (value ? formatDay(value) : "");
  if (invitation.status === "open") return `Zum Mitgliedsantrag eingeladen am ${day(invitation.created_at)} – noch offen.`;
  if (invitation.status === "applied") return `Antrag gestellt${invitation.applied_at ? ` am ${day(invitation.applied_at)}` : ""}.`;
  if (invitation.status === "withdrawn") return "Die Einladung zum Mitgliedsantrag wurde zurückgezogen.";
  if (invitation.status === "expired") return "Die Einladung zum Mitgliedsantrag ist abgelaufen.";
  return "";
}

/** Warum (oder ob) das Konto gesperrt werden kann - für die Zeile im Blatt. */
export function banState({ target, me, isSuperAdmin }) {
  if (!target) return { canAct: false, text: "" };
  if (me?.id && me.id === target.id) return { canAct: false, text: "Das eigene Konto lässt sich nicht sperren." };
  if (!target.is_banned && target.role === "superadmin") return { canAct: false, text: "Superadmin-Konten lassen sich nicht bannen – zuerst die Rolle ändern." };
  if (target.ban_protected && !isSuperAdmin) {
    return { canAct: false, text: `Konto mit Adminbereich – ${target.is_banned ? "entsperren" : "sperren"} kann nur der Superadmin.` };
  }
  return { canAct: true, text: "" };
}
