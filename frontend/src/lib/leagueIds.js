// Spiel-ID je Liga-Season (docs/LIGA.md, #2108): Liga-Spieler brauchen die Pflicht-ID des Spiels (z. B. die
// Activision-ID; die des Hauptspiels gilt für seine Versionen). Je Season und Spieler hält der Server fest, welche ID
// gilt - eine Änderung im Profil gilt erst nach der Freigabe durch die Liga-Leitung. Hier nur die Darstellung.

export const ID_STATE_LABELS = {
  locked: "festgehalten",
  pending: "im Profil – wird beim ersten Aufstellen festgehalten",
  missing: "fehlt",
  late: "wartet auf Freigabe",
  free: "keine Pflicht-ID",
};

/** Die ID wie der Server sie schreibt: ein Feld = der Wert, mehrere = „Label: Wert · Label: Wert“. */
export function idText(fields = [], values = {}) {
  const rows = fields.map((field) => [field.label || field.key, String(values?.[field.key] ?? "").trim()]);
  if (rows.length === 1) return rows[0][1] || null;
  return rows.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join(" · ") || null;
}

/** Die Pflicht-IDs aus dem Profilformular: die des Hauptspiels, eigene Werte der Version gehen vor. */
export function profileValues(entry, gameIds = {}) {
  const source = (entry?.identity_slug && gameIds?.[entry.identity_slug]) || {};
  const own = (entry?.game_slug && gameIds?.[entry.game_slug]) || {};
  const merged = { ...source, ...own };
  return Object.fromEntries((entry?.fields || []).map((field) => [field.key, String(merged[field.key] ?? "").trim()]));
}

function complete(fields = [], values = {}) {
  return fields.length > 0 && fields.every((field) => values[field.key]);
}

function sameValues(fields = [], first = {}, second = {}) {
  return fields.every((field) => String(first?.[field.key] ?? "").trim() === String(second?.[field.key] ?? "").trim());
}

/**
 * Hinweis im Profil je laufender Season - live aus dem Formular, damit er beim Tippen stimmt.
 * `tone`: "warn" (handeln nötig) oder "info"; `null`, wenn es nichts zu sagen gibt.
 */
export function leagueIdNotice(entry, gameIds = {}) {
  if (!entry || !(entry.fields || []).length) return null;
  const fields = entry.fields;
  const what = fields.map((field) => field.label || field.key).join(", ");
  const current = profileValues(entry, gameIds);
  const title = entry.title || "Liga";
  if (entry.state === "locked") {
    if (sameValues(fields, entry.locked, current)) {
      return { tone: "info", text: `In ${title} gilt deine ${what} ${entry.text}.` };
    }
    return {
      tone: "warn",
      text: `In der laufenden Liga (${title}) gilt weiter ${entry.text}. Eine neue ID muss die Liga-Leitung freigeben – bis dahin spielst du mit der gemeldeten.`,
    };
  }
  if (entry.state === "late") {
    return { tone: "warn", text: `${title}: Du bist nach dem Stichtag ins Co-Team gekommen – die Liga-Leitung muss deine ${what} erst freigeben.` };
  }
  if (complete(fields, current)) {
    return { tone: "info", text: `${title}: ${idText(fields, current)} wird beim ersten Aufstellen für die Season festgehalten.` };
  }
  return { tone: "warn", text: `${title}: Deine ${what} fehlt – ohne sie kannst du in der Liga nicht aufgestellt werden.` };
}

/** Wer im Kader gerade nicht aufgestellt werden kann - mit Grund (für die Zeile unter den Spieler-Chips). */
export function blockedPlayers(roster = []) {
  return roster.filter((person) => person?.lineup_blocked).map((person) => ({ id: person.id, name: person.name, reason: person.lineup_blocked }));
}

/** Kurzer Satz für den Zuteilen-Dialog: wem die ID fehlt. */
export function missingIdsLine(players = [], label = "Spiel-ID") {
  const missing = players.filter((player) => !player.ok);
  if (!missing.length) return "";
  const names = missing.map((player) => player.name).join(", ");
  return `Ohne gültige ${label}: ${names}. Zuteilen geht trotzdem – aufgestellt werden kann erst, wer die ID hat.`;
}
