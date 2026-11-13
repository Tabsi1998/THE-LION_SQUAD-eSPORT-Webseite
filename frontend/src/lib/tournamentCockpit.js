// Turnier-Cockpit (#1653): die Hauptseite der Turnierleitung am Turniertag vor Ort. Kein eigenes System - die Liste
// „Probleme“ entsteht aus dem, was die Turnierleitung schon lädt: „Braucht Aufmerksamkeit“ und die Auslosungen
// (GET /tournaments/<slug>/lead, services/match_attention.py) und der Verzug aus der Warteschlange je Station
// (GET /tournaments/<slug>/live-queue, services/live_queue.py). Hier steht nur, wie sie heißen, wie dringend sie sind
// und wohin ein Tipp führt. Die App (mobile/) übernimmt dieselben Regeln mit #2393.
import { DELAY_SHOWN_FROM, delayText } from "@/lib/liveQueue";

// Dringlichkeit: kleiner ist dringender. Für die Fälle aus „Braucht Aufmerksamkeit“ dieselbe Reihenfolge wie der
// Server (services/match_attention.py, Sortierung am Ende von attention_items): Streitfall, nicht erschienen, Station
// defekt, Ergebnis fehlt, Meldungen weichen ab - innerhalb einer Art das am längsten Überfällige zuerst. Das Cockpit
// weicht an zwei Stellen bewusst ab: Ein Liga-Verfahren (`procedure`, Protest oder Einspruch) steht beim Server ganz
// hinten, hier ist es ein Einspruch wie der Streitfall und steht vorn. Und das Cockpit kennt zwei Arten mehr, die der
// Server nicht als Fall führt - Verzug und Auslosung -, beide hinten, weil sie von selbst weiterlaufen.
export const PROBLEM_KINDS = Object.freeze({
  dispute: { rank: 0, chip: "Einspruch", tone: "warn" },
  procedure: { rank: 0, chip: "Einspruch", tone: "warn" },
  no_show: { rank: 1, chip: "Nicht erschienen", tone: "warn" },
  station_broken: { rank: 2, chip: "Defekt", tone: "warn" },
  result_missing: { rank: 3, chip: "Ergebnis fehlt", tone: "honor" },
  report_conflict: { rank: 4, chip: "Meldungen weichen ab", tone: "honor" },
  delay: { rank: 5, chip: "Verzug", tone: "honor" },
  draw: { rank: 6, chip: "Auslosung", tone: "brand" },
});
const OTHER = { rank: 7, chip: "", tone: "honor" };

// Solange das Cockpit offen ist, fragt es zusätzlich im Takt nach (zum Änderungsstrom dazu): „Ergebnis fehlt“ und Verzug
// entstehen mit der Zeit, ohne dass sich etwas ändert, das der Strom meldet. Kurz genug für den Turniertag, und die
// Abfrage läuft nie doppelt (useLiveRefresh).
export const COCKPIT_POLL_MS = 20000;

const natural = (a, b) => String(a || "").localeCompare(String(b || ""), "de", { numeric: true });
const shortStation = (text) => String(text || "").split(" · ")[0];

/** Wohin ein Fall führt: der Fall in „Braucht Aufmerksamkeit“ (mit seinen Knöpfen) oder die Station im Cockpit. */
export function problemSearch(problem) {
  const params = new URLSearchParams();
  if (problem?.stationId && problem.kind === "delay") params.set("station", problem.stationId);
  else params.set("fall", problem?.id || "");
  return `?${params.toString()}`;
}

/** Ein Fall aus „Braucht Aufmerksamkeit“ als Zeile. */
function fromAttention(item) {
  const kind = PROBLEM_KINDS[item.kind] || OTHER;
  return {
    id: item.id,
    kind: item.kind,
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

/** „Auslosung bereit“ (#1590) - die Karte steht wie jeder Fall in „Braucht Aufmerksamkeit“. */
function fromDraw(card) {
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
export function delayProblems(queue) {
  return (queue?.stations || []).flatMap((station) => {
    const next = station?.next;
    const minutes = Number(next?.delay_minutes);
    if (!next || station.status === "broken" || !(minutes >= DELAY_SHOWN_FROM)) return [];
    const kind = PROBLEM_KINDS.delay;
    const names = (next.names || []).join(" gegen ");
    return [{
      id: `dl-${station.id}`,
      kind: "delay",
      target: "station",
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
    }];
  });
}

/** Dringendstes zuerst; innerhalb einer Art das, was am längsten drüber ist, dann das Älteste, dann nach Station. */
export function sortProblems(rows) {
  return [...rows].sort((a, b) => a.rank - b.rank || b.minutes - a.minutes
    || String(a.since || "~").localeCompare(String(b.since || "~")) || natural(a.where, b.where) || natural(a.id, b.id));
}

/**
 * Die Liste „Probleme“ des Cockpits: Fälle aus `attention`, Auslosungen aus `draws` und Verzug aus der Warteschlange.
 * Jede Zeile trägt `search` - die Adresse, zu der ein Tipp führt.
 */
export function cockpitProblems({ attention = [], draws = [], queue = null } = {}) {
  const rows = [
    ...(attention || []).filter((item) => item?.id).map(fromAttention),
    ...(draws || []).filter((card) => card?.id).map(fromDraw),
    ...delayProblems(queue),
  ];
  return sortProblems(rows).map((row) => ({ ...row, search: problemSearch(row) }));
}

/** „3 Probleme“ - für die Überschrift und den Screenreader. */
export function problemCountText(count) {
  if (!count) return "Keine Probleme";
  return count === 1 ? "1 Problem" : `${count} Probleme`;
}
