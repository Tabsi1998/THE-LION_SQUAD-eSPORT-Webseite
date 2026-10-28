// Captain und Vertreter je Co-Team (docs/LIGA.md, #1649): Anzeige und Auswahl an einer Stelle.
// Beide stehen im Kader und sind verschiedene Personen; ohne beide handelt im Liga-Spiel die Teamleitung.

export const SQUAD_ROLES = [
  { field: "captain_id", label: "Captain", short: "C" },
  { field: "vice_captain_id", label: "Vertreter", short: "V" },
];

export function personName(person) {
  return person?.display_name || person?.username || "Unbekannt";
}

// Die Rolle einer Person im Co-Team („Captain“, „Vertreter“) oder null.
export function roleOf(squad, userId) {
  if (!squad || !userId) return null;
  return SQUAD_ROLES.find((role) => squad[role.field] === userId) || null;
}

// Wer für eine Rolle in Frage kommt: der Kader (in seiner Reihenfolge), ohne die Person der anderen Rolle.
export function roleChoices(memberIds, members, field, squad) {
  const other = field === "captain_id" ? squad?.vice_captain_id : squad?.captain_id;
  const byId = new Map((members || []).map((member) => [member.id, member]));
  return (memberIds || [])
    .filter((id) => id && id !== other && byId.has(id))
    .map((id) => ({ id, name: personName(byId.get(id)) }));
}

// Eine Zeile für die Karte: „Captain: Mila · Vertreter: Tom“ oder der Hinweis auf die Teamleitung.
export function rolesSummary(squad, members) {
  const byId = new Map((members || []).map((member) => [member.id, member]));
  const parts = SQUAD_ROLES
    .filter((role) => squad?.[role.field])
    .map((role) => `${role.label}: ${byId.has(squad[role.field]) ? personName(byId.get(squad[role.field])) : "nicht mehr im Kader"}`);
  return parts.length ? parts.join(" · ") : "Ohne Captain – im Liga-Spiel handelt die Teamleitung.";
}

// Nach einer Änderung am Kader: Rollen, deren Person nicht mehr im Kader steht, bleiben stehen - der Server lehnt das
// ab. Die Oberfläche sperrt deshalb das Abwählen einer Person mit Rolle (``isLocked``), bis die Rolle neu vergeben ist.
export function isLocked(squad, userId) {
  return Boolean(roleOf(squad, userId));
}
