// Turnierleitung am Handy (#1156): wie die Liste der offenen Spiele filtert und was in jeder Zeile steht - dieselben
// Wörter wie auf der Website (frontend/src/lib/tournamentLead.js).
import type { ResultEntry } from "./resultEntry";

export type LeadFilter = "all" | "running" | "missing";
const RUNNING = new Set(["in_progress", "running", "waiting_result"]);

export function leadFilter(item: ResultEntry, filter: LeadFilter) {
  if (filter === "running") return RUNNING.has(String(item?.status)) || item?.timing?.running_minutes != null;
  if (filter === "missing") return Boolean(item?.timing?.missing);
  return true;
}

export function leadNames(item: Pick<ResultEntry, "kind" | "participants">) {
  const names = (item?.participants || []).map((row) => row.name || "Teilnehmer");
  if (item?.kind === "duel" && names.length === 2) return `${names[0]} gegen ${names[1]}`;
  return `${names.length} Teilnehmer`;
}

export function leadLine(item: ResultEntry, formatWhen: (value: string) => string = (value) => value) {
  const timing = item?.timing || {};
  if (item?.status === "disputed") return "In Klärung – Dispute offen";
  if (timing.missing) return `Ergebnis fehlt · ${timing.overdue_minutes ?? 0} Min. über der Zeit`;
  if (timing.running_minutes != null) return `läuft ${timing.running_minutes} Min.${timing.overdue_minutes ? ` · ${timing.overdue_minutes} Min. über der Zeit` : ""}`;
  if (timing.overdue_minutes) return `${timing.overdue_minutes} Min. über der Zeit`;
  if (item?.scheduled_at) return `geplant ${formatWhen(item.scheduled_at)}`;
  return "ohne feste Zeit";
}
