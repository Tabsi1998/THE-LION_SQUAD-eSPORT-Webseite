import RIGHTS from "./staffRoleRights.json";

// Was eine Helfer-Rolle im Turnier darf (#1384) - aus derselben Liste, die der Server prüft (staffRoleRights.json spiegelt
// services/tournament_permissions.STAFF_RIGHTS; ein Gleichheits-Test hält beide gleich). Derselbe Satz steht in der Nachricht
// an den Helfer.

const LABELS = Object.fromEntries(RIGHTS.rights.map((row) => [row.key, row.label]));

function words(items) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} und ${items[items.length - 1]}`;
}

/** Die Rechte einer Rolle als Wörter, in der Reihenfolge des Servers. */
export function staffRoleRights(role) {
  return (RIGHTS.roles[role] || []).map((key) => LABELS[key]).filter(Boolean);
}

/** „Darf hier: Teilnehmer, Ergebnisse und Check-in.“ - wie der Server. Unbekannte Rolle: leer. */
export function staffRoleSentence(role) {
  if (!Object.prototype.hasOwnProperty.call(RIGHTS.roles, role)) return "";
  const rights = staffRoleRights(role);
  return rights.length ? `Darf hier: ${words(rights)}.` : "Darf hier nur ansehen – ändern kann diese Rolle nichts.";
}

/** Mehrere Rollen im selben Turnier („Mein Dienst“): ein Satz mit allem, was eine davon darf - leer ohne bekannte Rolle. */
export function staffRolesSentence(roles = []) {
  const known = roles.filter((role) => Object.prototype.hasOwnProperty.call(RIGHTS.roles, role));
  if (!known.length) return "";
  const keys = new Set(known.flatMap((role) => RIGHTS.roles[role]));
  const rights = RIGHTS.rights.filter((row) => keys.has(row.key)).map((row) => row.label);
  return rights.length ? `Darf hier: ${words(rights)}.` : "Darf hier nur ansehen – ändern kann diese Rolle nichts.";
}
