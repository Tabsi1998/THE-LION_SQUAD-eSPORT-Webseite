// Live-Warteschlange am Turnierbaum-TV (#1634): je Station „Jetzt“ (Spiel, Namen, Spielzeit) und „Als Nächstes“ - die
// Daten kommen fertig vom Server (GET /tournaments/<id>/live-queue?key=…, services/live_queue.py), dieselbe Quelle wie
// die Stationen der Turnierleitung (#1556). Hier steht nur, was der TV daraus zeigt. Ohne Warteschlange (online, keine
// Stationen, ältere Server) gibt es keine Bahnen - der TV bleibt dann genau wie vorher.
import { delayText } from "@/lib/liveQueue";
import { matchName } from "@/lib/tvLive";
import { matchRoundLabel } from "@/lib/tournamentLabels";
import { viennaTime } from "@/lib/vienna";

const clock = (value) => (value ? viennaTime(value, { hour: "2-digit", minute: "2-digit" }) : "");

/**
 * Die Bahnen je Station in der Reihenfolge des Servers: `{ id, name, status, now, next, waiting }` - `now` das laufende
 * Spiel, `next` das nächste (aufgerufen oder geplant). Defekte Stationen bleiben sichtbar. Ohne gültige Antwort `[]`.
 */
export function queueLanes(queue) {
  if (!queue || queue.applies !== true || !Array.isArray(queue.stations)) return [];
  return queue.stations.filter((station) => station?.id).map((station) => ({
    id: station.id,
    name: station.name || station.station_text || "Station",
    status: String(station.status || "free"),
    now: station.running || null,
    next: station.next || null,
    waiting: Number(station.waiting) || 0,
  }));
}

const stamp = (value) => {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
};

/**
 * Das nächste Spiel der ganzen Halle für die Fußzeile „Als Nächstes“ (#1828): aus derselben Live-Warteschlange wie die
 * Stationen - ein aufgerufenes zuerst, sonst das mit der frühesten Prognose. `{ lane, entry }` oder `null`. So nennt die
 * Fußzeile nach einem Austritt dieselbe Station und dieselben Spieler wie die Stations-Ansicht.
 */
export function queueNextUp(queue) {
  const picks = queueLanes(queue)
    .map((lane, index) => ({ lane, entry: lane.next, index }))
    .filter((pick) => pick.entry && pick.lane.status !== "broken");
  picks.sort((a, b) => (a.entry.state === "called" ? 0 : 1) - (b.entry.state === "called" ? 0 : 1)
    || stamp(a.entry.forecast_at) - stamp(b.entry.forecast_at)
    || a.index - b.index);
  return picks.length ? { lane: picks[0].lane, entry: picks[0].entry } : null;
}

/** Gibt es etwas zu zeigen - ein laufendes oder ein nächstes Spiel an irgendeiner Station? */
export function hasQueue(queue) {
  // Auch eine defekte Station allein zählt (Codex): die Halle soll „Bitte nicht benutzen“ sehen.
  return queueLanes(queue).some((lane) => lane.now || lane.next || lane.status === "broken");
}

/** Ist der Eintrag ein Lauf (mehr als zwei Plätze)? Der Server sagt es (`heat`), ältere Antworten zählen die Plätze. */
export function queueIsHeat(entry) {
  if (typeof entry?.heat === "boolean") return entry.heat;
  return (entry?.names || []).length + (Number(entry?.open_slots) || 0) > 2;
}

/**
 * „Viertelfinale · Spiel B“ - mit dem Spiel aus dem Baum wie überall am TV. Ohne Baum (Turnierleitung, Spielplan) der
 * Rundenname des Servers, im Lauf mit dem Durchgang: „Loser Runde 1 · Durchgang LA“ (#1824).
 */
export function queueWhat(entry, match = null) {
  if (match) return [matchRoundLabel(match), matchName(match)].filter(Boolean).join(" · ");
  const label = entry?.label || "Spiel";
  const key = String(entry?.match_key || "");
  // Kurze Kürzel („A“, „LA“, „R1-3“) sind der Durchgang; ein Wort als Kürzel steht schon als Name da.
  const heat = queueIsHeat(entry) && key && key !== label && (key.length <= 3 || /\d/.test(key));
  return heat ? `${label} · Durchgang ${key}` : label;
}

const MAX_NAMES = 4;
const openText = (open) => `${open === 1 ? "1 Platz" : `${open} Plätze`} offen`;

/**
 * Wer spielt - dieselbe Darstellung am TV, in der Turnierleitung und im Spielplan: Duell „A vs. B“ (`versus: "gegen"`
 * für „A gegen B“), im Lauf bis vier Namen (`rows`: je zwei in einer Zeile), darüber „5 Spieler“ oder mit
 * `overflow: "plus"` die ersten vier und „+N“. Offene Plätze in Worten - nie eine leere Zeile. `compact` (fünf oder
 * sechs Stationen auf einer TV-Seite): im Lauf nur die Zahl.
 */
export function queueWho(entry, { compact = false, versus = "vs.", rows = true, overflow = "count" } = {}) {
  const names = (entry?.names || []).filter(Boolean);
  const open = Number(entry?.open_slots) || 0;
  let who;
  if (names.length <= 2) who = names.join(` ${versus} `);
  // Viele Stationen auf einer Seite (drei Reihen, Codex): kurz bleiben, sonst sprengen lange Namen die Karte.
  else if (compact) who = `${names.length} Spieler`;
  else if (names.length > MAX_NAMES) who = overflow === "plus" ? `${names.slice(0, MAX_NAMES).join(" · ")} +${names.length - MAX_NAMES}` : `${names.length} Spieler`;
  // Im Lauf (Fabian 19.10.): bis vier Namen, je zwei in einer Zeile - die Halle sieht, wer gerade fährt.
  else if (rows && !open) who = [names.slice(0, 2), names.slice(2)].map((row) => row.join(" · ")).join("\n");
  else who = names.join(" · ");
  if (open) return who ? `${who} · ${openText(open)}` : openText(open);
  return who || "Teilnehmer offen";
}

/**
 * Die Zeile unter „Als Nächstes“: aufgerufen (Ton `call`, „Aufgerufen · antreten bis 14:32“) oder geplant (Ton `next`,
 * „ca. 14:40“ bzw. „voraussichtlich ca. 14:40“), dazu der Verzug ab 5 Minuten in Worten.
 */
export function queueNextLine(entry) {
  if (!entry) return { tone: "none", text: "", delay: "" };
  if (entry.state === "called") {
    return { tone: "call", text: entry.report_by ? `Aufgerufen · antreten bis ${clock(entry.report_by)}` : "Aufgerufen · bitte jetzt zur Station", delay: "" };
  }
  const when = entry.forecast_at ? `${entry.forecast ? "voraussichtlich " : ""}ca. ${clock(entry.forecast_at)}` : "";
  return { tone: "next", text: when, delay: delayText(entry.delay_minutes) };
}

/** Woran der TV einen Wechsel an der Station erkennt: anderes laufendes Spiel, anderes nächstes, aufgerufen. */
export function laneSignature(lane) {
  return [lane?.now?.match_id || "-", lane?.next?.match_id || "-", lane?.next?.state || "-"].join("|");
}

/** Wer spielt, wie es die Stationen der Turnierleitung und der Spielplan zeigen: „A gegen B“, im Lauf die Namen in
 * einer Zeile, ab fünf die ersten vier und „+N“ (#1824). */
export function stationWho(entry) {
  return queueWho(entry, { versus: "gegen", rows: false, overflow: "plus" });
}
