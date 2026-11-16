// Live vor Ort in der App (#1556, #1162, #2393): Warteschlange je Station für die Turnierleitung - dieselben Wörter wie
// im Web (frontend/src/lib/liveQueue.js, lib/tvQueue.js, components/tls/live/StationTile.jsx). Die Daten kommen fertig
// vom Server (GET /tournaments/<id>/live-queue, services/live_queue.py); hier steht nur, wie sie aussehen und welche
// Knöpfe eine Kachel zeigt. Alle Felder sind freiwillig - ältere Server lassen sie weg.
import { viennaTime } from "./vienna";

export type QueueEntry = {
  match_id: string;
  match_key?: string | null;
  label?: string | null;
  stage_name?: string | null;
  state?: "running" | "called" | "queued" | string;
  position?: number | null;
  station_id?: string | null;
  station_text?: string | null;
  names?: string[];
  open_slots?: number | null;
  heat?: boolean | null;
  ready?: boolean;
  waiting_for?: "draw" | "previous" | string | null;
  forecast?: boolean;
  planned_at?: string | null;
  forecast_at?: string | null;
  delay_minutes?: number | null;
  duration_minutes?: number | null;
  called_at?: string | null;
  report_by?: string | null;
  no_show_due_at?: string | null;
  no_show_names?: string[];
  started_at?: string | null;
  paused_at?: string | null;
  paused_seconds?: number | null;
  busy_at?: { state?: string; station_text?: string } | null;
};

export type QueueStation = {
  id: string;
  name?: string | null;
  station_text?: string | null;
  status?: "free" | "busy" | "broken" | string;
  running?: QueueEntry | null;
  next?: QueueEntry | null;
  after?: QueueEntry | null;
  waiting?: number;
  hold_issue?: { kind?: "other" | "stuck" | string; tournament_title?: string | null } | null;
};

export type LiveQueue = {
  applies?: boolean;
  now?: string | null;
  stations?: QueueStation[];
  matches?: Record<string, QueueEntry>;
  unplaced?: string[];
  summary?: { delay_minutes?: number | null; last?: { label?: string | null; forecast_at?: string | null } | null } | null;
  operate?: { all?: boolean; station_ids?: string[] } | null;
};

// Ab so viel Verschiebung heißt es „Verzug“ - darunter ist es Rauschen (wie am TV, #1564).
export const DELAY_SHOWN_FROM = 5;
const clock = (value?: string | null) => (value ? viennaTime(value, { hour: "2-digit", minute: "2-digit" }) : "");

/** „+11 Min.“ - erst ab 5 Minuten; früher als geplant „12 Min. früher“. */
export function delayText(minutes: number | null | undefined): string {
  const value = Number(minutes);
  if (minutes === null || minutes === undefined || Number.isNaN(value) || Math.abs(value) < DELAY_SHOWN_FROM) return "";
  return value > 0 ? `+${value} Min.` : `${Math.abs(value)} Min. früher`;
}

/** „+11 Min. · Finale jetzt ca. 20:51“ - der Verzug und wann das letzte Spiel jetzt beginnt. */
export function queueSummaryLine(summary: LiveQueue["summary"]): string {
  const last = summary?.last;
  if (!last?.forecast_at) return "";
  const delay = delayText(summary?.delay_minutes);
  return delay ? `${delay} · ${last.label} jetzt ca. ${clock(last.forecast_at)}` : `Im Plan · ${last.label} ca. ${clock(last.forecast_at)}`;
}

/** Ist der Eintrag ein Lauf (mehr als zwei Plätze)? Der Server sagt es (`heat`), ältere Antworten zählen die Plätze. */
export function queueIsHeat(entry: QueueEntry | null | undefined): boolean {
  if (typeof entry?.heat === "boolean") return entry.heat;
  return (entry?.names || []).length + (Number(entry?.open_slots) || 0) > 2;
}

/** „Viertelfinale“ - im Lauf mit dem Durchgang: „Loser Runde 1 · Durchgang LA“ (#1824). */
export function queueWhat(entry: QueueEntry | null | undefined): string {
  const label = entry?.label || "Spiel";
  const key = String(entry?.match_key || "");
  const heat = queueIsHeat(entry) && key && key !== label && (key.length <= 3 || /\d/.test(key));
  return heat ? `${label} · Durchgang ${key}` : label;
}

const MAX_NAMES = 4;
const openText = (open: number) => `${open === 1 ? "1 Platz" : `${open} Plätze`} offen`;

/** Wer spielt: „A gegen B“, im Lauf die Namen mit „·“, ab fünf die ersten vier und „+N“ - offene Plätze in Worten. */
export function stationWho(entry: QueueEntry | null | undefined): string {
  const names = (entry?.names || []).filter(Boolean);
  const open = Number(entry?.open_slots) || 0;
  let who: string;
  if (names.length <= 2) who = names.join(queueIsHeat(entry) ? " · " : " gegen ");
  else if (names.length > MAX_NAMES) who = `${names.slice(0, MAX_NAMES).join(" · ")} +${names.length - MAX_NAMES}`;
  else who = names.join(" · ");
  if (open) return who ? `${who} · ${openText(open)}` : openText(open);
  return who || "Teilnehmer offen";
}

/** „voraussichtlich ca. 14:40 · +11 Min.“ - wann ein wartendes Spiel dran ist. */
export function queueWhen(entry: QueueEntry | null | undefined): string {
  const parts = [entry?.forecast_at ? `${entry.forecast ? "voraussichtlich " : ""}ca. ${clock(entry.forecast_at)}` : "", delayText(entry?.delay_minutes)];
  return parts.filter(Boolean).join(" · ");
}

/** „Aufgerufen 14:20 · antreten bis 14:30 · nicht erschienen ab 14:35“. */
export function calledLine(entry: QueueEntry): string {
  return [
    entry.called_at ? `Aufgerufen ${clock(entry.called_at)}` : "Aufgerufen",
    entry.report_by ? `antreten bis ${clock(entry.report_by)}` : "",
    entry.no_show_due_at ? `nicht erschienen ab ${clock(entry.no_show_due_at)}` : "",
    entry.no_show_names?.length ? `${entry.no_show_names.join(", ")} nicht erschienen` : "",
  ].filter(Boolean).join(" · ");
}

export type StationTone = "running" | "called" | "broken" | "free" | "other" | "stuck";

/** Zustand der Kachel in Worten - dieselben wie im Web, TV und Matchplan. */
export const STATION_TONE_LABELS: Record<StationTone, string> = {
  running: "Läuft",
  called: "Aufgerufen",
  broken: "Defekt",
  free: "Frei",
  other: "Anderes Turnier",
  stuck: "Hängt",
};

export function stationTone(station: QueueStation | null | undefined): StationTone {
  if (station?.status === "broken") return "broken";
  if (station?.hold_issue?.kind === "other") return "other";
  if (station?.running) return "running";
  if (station?.next?.state === "called") return "called";
  if (station?.hold_issue?.kind === "stuck") return "stuck";
  return "free";
}

/** Was die Station gerade hält: ein laufendes Spiel oder einen Aufruf - nur das lässt sich freigeben. */
export function stationHolds(station: QueueStation | null | undefined): QueueEntry | null {
  if (station?.running) return station.running;
  return station?.next?.state === "called" ? station.next : null;
}

/** Darf die Person diese Station bedienen? Der Server sagt es (`operate`) - ohne Angabe nie. */
export function canOperateStation(queue: LiveQueue | null | undefined, station: QueueStation): boolean {
  const operate = queue?.operate;
  return Boolean(operate?.all || (operate?.station_ids || []).includes(station.id));
}

export type NextAction = { kind: "waiting"; text: string } | { kind: "start" } | { kind: "call" } | { kind: "hint"; text: string } | null;

/**
 * Was unter „Als Nächstes“ steht: worauf das Spiel wartet, „Starten“ nach dem Aufruf (nie an einer defekten Station),
 * „Aufrufen“ an einer freien Station - sonst ein Satz, wann aufgerufen wird. Ohne Recht keine Knöpfe.
 */
export function nextAction(station: QueueStation, canOperate: boolean): NextAction {
  const next = station.next;
  if (!next) return null;
  const tone = stationTone(station);
  if (!next.ready) return { kind: "waiting", text: next.waiting_for === "draw" ? "wartet auf die Auslosung" : "wartet auf die Vorspiele" };
  if (next.state === "called") return canOperate && tone !== "broken" ? { kind: "start" } : null;
  if (station.running || tone === "other" || tone === "stuck") {
    return { kind: "hint", text: tone === "other" || tone === "stuck" ? "Aufrufen, sobald die Station frei ist." : "Aufrufen nach dem laufenden Spiel." };
  }
  if (tone === "broken" || !canOperate) return null;
  return { kind: "call" };
}

/** Die Rückfrage vor „Freigeben“ (#1162): ein laufendes Spiel verliert seine Station, ein Aufruf geht zurück. */
export function releaseQuestion(station: QueueStation): { text: string; yes: string } {
  return station.running
    ? { text: "Das Spiel läuft noch. Station trotzdem freigeben? Das Ergebnis trägst du danach unter „Ergebnisse“ ein.", yes: "Freigeben" }
    : { text: "Aufruf zurücknehmen? Die Spieler bekommen Bescheid, das Spiel geht zurück in die Warteschlange.", yes: "Zurücknehmen" };
}

/** Die Rückfrage, wenn an der Station gerade ein anderes Turnier spielt (`confirm_other`). */
export function brokenOtherQuestion(station: QueueStation): string {
  return `An dieser Station spielt gerade „${station.hold_issue?.tournament_title || "ein anderes Turnier"}“. Trotzdem als defekt melden? Dessen Leitung bekommt Bescheid und legt das Spiel um.`;
}

type Done = { idempotent_replay?: boolean; state?: string; holds?: { other_tournament?: string | null; state?: string | null } | null };

/** Was nach einem Tipp auf eine Station gemeldet wird - dieselben Sätze wie im Web (TournamentLeadPage.jsx). */
export function stationDoneText(kind: "call" | "start" | "release" | "broken" | "ready", done: Done | null | undefined, where: string): string {
  const answer = done || {};
  if (kind === "call") return answer.idempotent_replay ? `War schon an ${where} aufgerufen.` : `Aufgerufen an ${where} – die Spieler bekommen Bescheid.`;
  if (kind === "start") return answer.idempotent_replay ? "Läuft bereits." : `Gestartet an ${where} – die Uhr läuft.`;
  if (kind === "release") {
    if (answer.idempotent_replay) return `${where} war schon frei.`;
    return answer.state === "running" ? `${where} ist frei – das Ergebnis trägst du unter „Ergebnisse“ ein.` : `${where} ist frei – der Aufruf ist zurückgenommen, die Spieler bekommen Bescheid.`;
  }
  if (kind === "ready") return answer.idempotent_replay ? `${where} war schon bereit.` : `${where} ist wieder bereit.`;
  const held = answer.holds?.other_tournament ? `Dort spielt gerade „${answer.holds.other_tournament}“ – dessen Leitung hat Bescheid bekommen.`
    : answer.holds?.state === "running" ? "Das laufende Spiel steht noch dort – mit „Umlegen“ auf eine freie Station."
      : answer.holds?.state === "called" ? "Der Aufruf steht noch dort – mit „Umlegen“ an einer freien Station neu aufrufen." : "";
  return [answer.idempotent_replay ? `${where} war schon als defekt gemeldet.` : `${where} ist als defekt gemeldet.`, held].filter(Boolean).join(" ");
}
