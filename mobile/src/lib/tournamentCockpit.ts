// Turnier-Cockpit in der App (#1653, #2393): die Liste „Probleme“ nach denselben Regeln wie im Web
// (frontend/src/lib/tournamentCockpit.js). Kein eigenes System - sie entsteht aus „Braucht Aufmerksamkeit“ und den
// Auslosungen (GET /tournaments/<slug>/lead) und dem Verzug aus der Warteschlange je Station (GET …/live-queue). Hier
// steht nur, wie die Fälle heißen, wie dringend sie sind und wohin ein Tipp führt (`fall` oder `station`).
import { DELAY_SHOWN_FROM, delayText, type LiveQueue } from "./liveQueue";

export type ProblemTone = "warn" | "honor" | "brand";

// Dringlichkeit: kleiner ist dringender - dieselbe Reihenfolge wie der Server (services/match_attention.py). Ein
// Liga-Verfahren (`procedure`) ist hier ein Einspruch wie der Streitfall und steht vorn; Verzug und Auslosung kennt nur
// das Cockpit, beide hinten, weil sie von selbst weiterlaufen.
export const PROBLEM_KINDS: Readonly<Record<string, { rank: number; chip: string; tone: ProblemTone }>> = Object.freeze({
  dispute: { rank: 0, chip: "Einspruch", tone: "warn" },
  procedure: { rank: 0, chip: "Einspruch", tone: "warn" },
  no_show: { rank: 1, chip: "Nicht erschienen", tone: "warn" },
  station_broken: { rank: 2, chip: "Defekt", tone: "warn" },
  result_missing: { rank: 3, chip: "Ergebnis fehlt", tone: "honor" },
  report_conflict: { rank: 4, chip: "Meldungen weichen ab", tone: "honor" },
  delay: { rank: 5, chip: "Verzug", tone: "honor" },
  draw: { rank: 6, chip: "Auslosung", tone: "brand" },
});
const OTHER = { rank: 7, chip: "", tone: "honor" as ProblemTone };

// Solange das Cockpit offen ist (zu sehen und die App im Vordergrund), fragt es zusätzlich im Takt nach: „Ergebnis
// fehlt“ und Verzug entstehen mit der Zeit, ohne dass sich etwas ändert, das der Änderungsstrom meldet.
export const COCKPIT_POLL_MS = 20000;

export type CockpitAttention = {
  id: string;
  kind?: string;
  title?: string;
  detail?: string;
  label?: string;
  names?: string;
  station_text?: string;
  station_id?: string;
  match_id?: string;
  match_ids?: string[];
  overdue_minutes?: number | null;
  since?: string | null;
};

export type CockpitDraw = { id: string; label?: string; stage_name?: string; pot_size?: number; due_at?: string | null };

export type Problem = {
  id: string;
  kind: string;
  target: "case" | "station";
  rank: number;
  chip: string;
  tone: ProblemTone;
  title: string;
  where: string;
  what: string;
  detail: string;
  minutes: number;
  since: string;
  stationId: string;
  matchId?: string;
  search?: string;
};

const natural = (a?: string, b?: string) => String(a || "").localeCompare(String(b || ""), "de", { numeric: true });
const shortStation = (text?: string | null) => String(text || "").split(" · ")[0];

/** Wohin ein Fall führt, als Adresse wie im Web: der Fall (`?fall=`) oder bei Verzug die Station (`?station=`). */
export function problemSearch(problem: Partial<Problem> | null | undefined): string {
  if (problem?.stationId && problem.kind === "delay") return `?station=${encodeURIComponent(problem.stationId)}`;
  return `?fall=${encodeURIComponent(problem?.id || "")}`;
}

function fromAttention(item: CockpitAttention): Problem {
  const kind = PROBLEM_KINDS[item.kind || ""] || OTHER;
  return {
    id: item.id,
    kind: item.kind || "",
    target: "case",
    rank: kind.rank,
    chip: kind.chip || item.title || "Fall",
    tone: kind.tone,
    title: item.title || kind.chip || "Fall",
    where: shortStation(item.station_text),
    what: [item.label, item.names].filter(Boolean).join(" · "),
    detail: item.detail || "",
    minutes: Number(item.overdue_minutes) || 0,
    since: item.since || "",
    stationId: item.station_id || "",
  };
}

function fromDraw(card: CockpitDraw): Problem {
  const kind = PROBLEM_KINDS.draw;
  return {
    id: card.id,
    kind: "draw",
    target: "case",
    rank: kind.rank,
    chip: kind.chip,
    tone: kind.tone,
    title: `Auslosung bereit · ${card.pot_size} ${card.pot_size === 1 ? "Name" : "Namen"}`,
    where: "",
    what: [card.stage_name, card.label].filter(Boolean).join(" · "),
    detail: "",
    minutes: 0,
    since: card.due_at || "",
    stationId: "",
  };
}

/**
 * Verzug je Station: das nächste Spiel beginnt mindestens `DELAY_SHOWN_FROM` Minuten später als geplant (dieselbe
 * Schwelle wie am TV). Eine defekte Station hat ihren eigenen Fall, eine ohne Plan-Zeit keinen Verzug.
 */
export function delayProblems(queue: LiveQueue | null | undefined): Problem[] {
  return (queue?.stations || []).flatMap((station) => {
    const next = station?.next;
    const minutes = Number(next?.delay_minutes);
    if (!next || station.status === "broken" || next.delay_minutes == null || !(minutes >= DELAY_SHOWN_FROM)) return [];
    const kind = PROBLEM_KINDS.delay;
    const names = (next.names || []).join(" gegen ");
    return [{
      id: `dl-${station.id}`,
      kind: "delay",
      target: "station" as const,
      rank: kind.rank,
      chip: kind.chip,
      tone: kind.tone,
      title: `${delayText(minutes)} hinter dem Plan`,
      where: shortStation(station.station_text || station.name),
      what: [next.label, names].filter(Boolean).join(" · "),
      detail: next.state === "called" ? "Aufgerufen – die Spieler sind unterwegs." : "Als Nächstes – aufrufen, sobald die Station frei ist.",
      minutes,
      since: next.planned_at || "",
      stationId: station.id,
      matchId: next.match_id || "",
    }];
  });
}

/** Dringendstes zuerst; innerhalb einer Art das, was am längsten drüber ist, dann das Älteste, dann nach Station. */
export function sortProblems(rows: Problem[]): Problem[] {
  return [...rows].sort((a, b) => a.rank - b.rank || b.minutes - a.minutes
    || String(a.since || "~").localeCompare(String(b.since || "~")) || natural(a.where, b.where) || natural(a.id, b.id));
}

/** Die Liste „Probleme“: Fälle aus `attention`, Auslosungen aus `draws` und Verzug aus der Warteschlange. */
export function cockpitProblems({ attention = [], draws = [], queue = null }: {
  attention?: CockpitAttention[] | null;
  draws?: CockpitDraw[] | null;
  queue?: LiveQueue | null;
} = {}): Problem[] {
  const cases = (attention || []).filter((item) => item?.id);
  // Ein Spiel nur einmal: Hat es schon einen Fall, zeigt das Cockpit dafür keinen Verzug mehr.
  const withCase = new Set(cases.flatMap((item) => [item.match_id, ...(item.match_ids || [])]).filter(Boolean));
  const rows = [
    ...cases.map(fromAttention),
    ...(draws || []).filter((card) => card?.id).map(fromDraw),
    ...delayProblems(queue).filter((row) => !withCase.has(row.matchId)),
  ];
  return sortProblems(rows).map((row) => ({ ...row, search: problemSearch(row) }));
}

/** „3 Probleme“ - für die Überschrift und den Vorleser. */
export function problemCountText(count: number): string {
  if (!count) return "Keine Probleme";
  return count === 1 ? "1 Problem" : `${count} Probleme`;
}
