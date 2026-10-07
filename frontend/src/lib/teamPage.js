import { viennaDateTime } from "@/lib/vienna";

// Team-Seite (#1191): reine Helfer für Termine, letzte Spiele und den Einladungs-Link - ohne React, mit Tests.

/** Der Name des Schlüssels in der Adresse: /teams/<id>?einladung=<schlüssel>. */
export const INVITE_PARAM = "einladung";

const OUTCOME_LABELS = { win: "Sieg", loss: "Niederlage", draw: "Unentschieden" };

/** „Sieg“, „Niederlage“, „Unentschieden“ - bei Durchgängen „Platz 2“. */
export function outcomeLabel(row) {
  if (!row) return "";
  if (row.kind === "heat") return row.rank ? `Platz ${row.rank}` : "Gewertet";
  return OUTCOME_LABELS[row.outcome] || "Gewertet";
}

/** Die Zeile eines fertigen Spiels: „3:1 gegen Pixelpiraten“ oder „Platz 2 von 6“. */
export function recentLine(row) {
  if (!row) return "";
  if (row.kind === "heat") return row.rank ? `Platz ${row.rank}${row.field ? ` von ${row.field}` : ""}` : "Durchgang gewertet";
  const against = row.opponent ? `gegen ${row.opponent}` : "";
  if (row.forfeit && !row.score) return `${row.outcome === "win" ? "Gewonnen" : "Verloren"} ${against} (kampflos)`.trim();
  return [row.score, against].filter(Boolean).join(" ");
}

/** Unter dem Titel eines kommenden Turniers: „Herbst-LAN · Sa., 17.10. · 16:00“. */
export function upcomingLine(row) {
  const t = row?.tournament || {};
  const when = t.start_date ? viennaDateTime(t.start_date, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  return [t.event_name, when ? when.replace(", ", " · ") : "", !t.event_name ? t.game_name : ""].filter(Boolean).join(" · ");
}

/** Der Schlüssel aus der Adresse - oder leer. */
export function inviteTokenFrom(search) {
  try {
    return (new URLSearchParams(search || "").get(INVITE_PARAM) || "").trim();
  } catch {
    return "";
  }
}

// Wappen-Kopf (#1347): Rollen in Alltagsworten unter den Gesichtern.
export const ROLE_LABELS = { captain: "Kapitän", co_captain: "Co-Kapitän", player: "Spieler" };

/** Die Rolle eines Mitglieds: Kapitän (Leitung), Co-Kapitän oder Spieler. */
export function memberRole(team, member) {
  if (!team || !member) return "player";
  if (team.leader_id === member.id) return "captain";
  if ((team.co_leader_ids || []).includes(member.id)) return "co_captain";
  return "player";
}

/** Die Gesichter-Reihe: Kapitän zuerst, dann die Co-Kapitäne, dann alle anderen in ihrer Reihenfolge. */
export function orderedFaces(team) {
  const order = { captain: 0, co_captain: 1, player: 2 };
  return (team?.members || [])
    .map((member, index) => ({ member, index, role: memberRole(team, member) }))
    .sort((a, b) => order[a.role] - order[b.role] || a.index - b.index)
    .map(({ member, role }) => ({ ...member, role, roleLabel: ROLE_LABELS[role] }));
}

/** Zwei Buchstaben für ein Gesicht ohne Bild: „NeonFalke“ → „NF“, „luna byte“ → „LB“. */
export function initials(name) {
  const text = String(name || "").trim();
  if (!text) return "?";
  const words = text.split(/[\s_.-]+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const capitals = text.match(/[A-ZÄÖÜ]/g) || [];
  if (capitals.length >= 2) return (capitals[0] + capitals[1]).toUpperCase();
  return text.slice(0, 2).toUpperCase();
}

// Team auflösen (#1274): ein Satz, was passiert - Mitglieder, Chat und kommende Turnier-Anmeldungen werden genannt.
export function dissolveSentence(preview) {
  if (!preview) return "";
  const members = Number(preview.member_count || 0);
  const chat = Number(preview.chat_messages || 0);
  const parts = [
    members === 1 ? "Das Mitglied verliert das Team" : `Alle ${members} Mitglieder verlieren das Team`,
    chat ? `der Team-Chat mit ${chat === 1 ? "einer Nachricht" : `${chat} Nachrichten`} wird gelöscht` : "der Team-Chat wird gelöscht",
  ];
  const titles = (preview.withdraw || []).map((row) => `„${row.title}“`);
  if (titles.length === 1) parts.push(`die Anmeldung für ${titles[0]} wird zurückgezogen`);
  if (titles.length > 1) parts.push(`die Anmeldungen für ${titles.slice(0, -1).join(", ")} und ${titles[titles.length - 1]} werden zurückgezogen`);
  const last = parts.pop();
  return `${parts.join(", ")} und ${last}. Fertige Turniere und Auszeichnungen bleiben.`;
}

/** Eingetippt wie der Teamname - Groß/klein und doppelte Leerzeichen zählen nicht (wie im Server). */
export function sameTeamName(team, typed) {
  const norm = (value) => String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("de");
  return Boolean(norm(typed)) && norm(typed) === norm(team?.name);
}
