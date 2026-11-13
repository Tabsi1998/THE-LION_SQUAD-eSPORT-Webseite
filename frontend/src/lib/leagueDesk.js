// Leitstand der Season (E.4, docs/LIGA.md „E.4 Leitstand“, Nr. 152, 153): Filter, Sätze und die Werte der Rundnachricht. Die Aufgaben
// rechnet der Server (GET /api/admin/leagues/seasons/{id}/desk) aus denselben Quellen wie „Mein Dienst“ - hier steht nur die Anzeige.
import { remainingText } from "@/lib/leagueProcedures";
import { shortWhen } from "@/lib/leagueSchedule";

export const DESK_FILTERS = [
  { key: "all", label: "Alle" },
  { key: "mine", label: "Nur meine" },
];

export const BROADCAST_LIMITS = { titleMin: 3, titleMax: 80, textMin: 10, textMax: 1000 };

export const AUDIENCES = [
  { key: "captains", label: "Captains und Vertreter", hint: "Vorgabe. Ohne Captain und Vertreter die Leitung des Hauptteams." },
  { key: "players", label: "Alle Spieler", hint: "Jedes Mitglied der Co-Teams und die Leitung der Hauptteams." },
];

/** Die Gruppen nach Filter: ``mine`` nur, was die Person selbst erledigen kann. */
export function filterGroups(groups = [], filter = "all") {
  return groups.map((group) => ({ ...group, items: filter === "mine" ? (group.items || []).filter((item) => item.mine) : group.items || [] }));
}

/** „Frist: noch 2 Tage (Sa 14.11. 20:00)“, „seit Mo 09.11. 18:00“ oder nichts. */
export function deskWhen(item, now = Date.now()) {
  if (item.due_at) {
    const left = remainingText(item.due_at, now);
    return { kind: "due", text: `Frist ${left === "abgelaufen" ? "abgelaufen" : left} · ${shortWhen(item.due_at)}`, over: left === "abgelaufen" };
  }
  if (item.since) return { kind: "since", text: `seit ${shortWhen(item.since)}`, over: false };
  return null;
}

/** Wer zuständig ist: übernommen von jemandem, sonst die Zuständigkeit der Gruppe. */
export function deskResponsible(item, group) {
  if (item.assignee) return item.assignee.own ? "Von dir übernommen" : `Übernommen von ${item.assignee.name}`;
  if (item.kind === "reschedule") return `Gegenseite, sonst ${group?.responsible || "die Liga-Leitung"}`;
  return group?.responsible || "Liga-Leitung";
}

/** Kreise der Rundnachricht aus den Liga N der Season: ganze Season, je Liga N, je Staffel. */
export function scopeOptions(divisions = []) {
  const rows = [{ value: "season:", label: "Ganze Season" }];
  for (const division of divisions || []) {
    if ((division.status || "active") !== "active") continue;
    rows.push({ value: `division:${division.id}`, label: division.label || `Liga ${division.level}` });
    for (const staffel of division.staffeln || []) {
      rows.push({ value: `staffel:${staffel.tournament_id}`, label: `${division.label || `Liga ${division.level}`} · Staffel ${staffel.staffel || ""}`.trim() });
    }
  }
  return rows;
}

export function splitScope(value) {
  const [scope, id] = String(value || "season:").split(":");
  return { scope: scope || "season", scope_id: id || null };
}

/** Was vor dem Senden noch fehlt - ``""``: nichts. */
export function broadcastProblem({ title, text }) {
  const subject = String(title || "").trim();
  const body = String(text || "").trim();
  if (subject.length < BROADCAST_LIMITS.titleMin) return `Betreff: mindestens ${BROADCAST_LIMITS.titleMin} Zeichen.`;
  if (subject.length > BROADCAST_LIMITS.titleMax) return `Betreff: höchstens ${BROADCAST_LIMITS.titleMax} Zeichen.`;
  if (body.length < BROADCAST_LIMITS.textMin) return `Nachricht: mindestens ${BROADCAST_LIMITS.textMin} Zeichen.`;
  if (body.length > BROADCAST_LIMITS.textMax) return `Nachricht: höchstens ${BROADCAST_LIMITS.textMax} Zeichen.`;
  return "";
}

/** Eine Kennung je geöffnetem Dialog: Der Server schickt je Kennung genau einmal (Doppelklick, zweiter Versuch). */
export function newRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `rn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function peopleText(count) {
  return count === 1 ? "1 Person" : `${count} Personen`;
}
