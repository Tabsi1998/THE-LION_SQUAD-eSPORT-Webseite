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

export type LeadTab = "cockpit" | "attention" | "results" | "notice";

/**
 * Womit die Turnierleitung startet, wenn kein Reiter gewählt ist (#1653, wie defaultLeadTab im Web): ein Fall aus einem
 * Link (`fall`) öffnet „Braucht Aufmerksamkeit“. Vor Ort mit Warteschlange ist das Cockpit der Einstieg - es zeigt die
 * Fälle mit. Ohne Warteschlange wie bisher: Fälle, sonst Ergebnisse. `ready`: Ansicht und Warteschlange sind geladen -
 * bis dahin `""` (sonst springt der Reiter nach dem Laden).
 */
export function defaultLeadTab({ fall = "", cases = 0, queue = false, ready = false }: { fall?: string; cases?: number; queue?: boolean; ready?: boolean } = {}): LeadTab | "" {
  if (fall) return "attention";
  if (!ready) return "";
  if (queue) return "cockpit";
  return cases ? "attention" : "results";
}

/** Trägt die Zeile die Spielzeit-Uhr (#1167)? Ein laufendes Spiel mit Startzeit - nicht im Streitfall. */
export function leadClocked(item: Pick<ResultEntry, "started_at" | "status" | "timing">): boolean {
  return Boolean(item?.started_at) && item?.timing?.running_minutes != null && item?.status !== "disputed";
}

export type DrawCard = {
  id: string;
  group?: string;
  stage_id?: string;
  stage_name?: string;
  label?: string;
  round_label?: string;
  match_keys?: string[];
  pot_size?: number;
  pot?: string[];
  due_at?: string | null;
  can_draw?: boolean;
};

/**
 * Restzeit bis zum automatischen Los (#1590): ganze Minuten nach der Serverzeit - `now` ist die Serveruhr jetzt
 * (`serverNow` aus lib/matchClock mit dem Abstand, der beim Laden gemessen wurde), nie die Geräteuhr allein.
 */
export function drawCountdown(card: Pick<DrawCard, "due_at"> | null | undefined, now: number): string {
  const due = card?.due_at ? new Date(card.due_at).getTime() : NaN;
  if (Number.isNaN(due) || !Number.isFinite(now)) return "";
  const left = Math.ceil((due - now) / 60000);
  if (left <= 0) return "der Server lost jeden Moment selbst";
  return `automatisch in ${left} Min.`;
}

/** Wohin gelost wird (#1829): „nach Runde 1 → Loser Runde 1 (LA, LB)“. */
export function drawTargetText(card: Pick<DrawCard, "label" | "round_label" | "match_keys"> | null | undefined): string {
  const keys = (card?.match_keys || []).join(", ");
  return `nach ${card?.label} → ${card?.round_label ? `${card.round_label} (${keys})` : keys}`;
}
