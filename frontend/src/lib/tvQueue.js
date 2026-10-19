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

/** Gibt es etwas zu zeigen - ein laufendes oder ein nächstes Spiel an irgendeiner Station? */
export function hasQueue(queue) {
  // Auch eine defekte Station allein zählt (Codex): die Halle soll „Bitte nicht benutzen“ sehen.
  return queueLanes(queue).some((lane) => lane.now || lane.next || lane.status === "broken");
}

/** „Viertelfinale · Spiel B“ - mit dem Spiel aus dem Baum wie überall am TV, sonst der Text des Servers. */
export function queueWhat(entry, match = null) {
  if (match) return [matchRoundLabel(match), matchName(match)].filter(Boolean).join(" · ");
  return entry?.label || "Spiel";
}

const together = (names, compact) => (compact && names.length > 2 ? `${names.length} Spieler` : names.join(names.length > 2 ? " · " : " vs. "));

/**
 * Wer spielt: „A vs. B“, im Lauf bis vier Namen zweizeilig (ab fünf „5 Spieler“), offene Plätze in Worten - nie eine
 * leere Zeile. `compact` (fünf oder sechs Stationen auf einer Seite): im Lauf nur die Zahl.
 */
export function queueWho(entry, { compact = false } = {}) {
  const names = (entry?.names || []).filter(Boolean);
  const open = Number(entry?.open_slots) || 0;
  if (open && names.length) return `${together(names, compact)} · ${open === 1 ? "1 Platz" : `${open} Plätze`} offen`;
  if (open) return `${open === 1 ? "1 Platz" : `${open} Plätze`} offen`;
  // Im Lauf (Fabian 19.10.): bis vier Namen, je zwei in einer Zeile - die Halle sieht, wer gerade fährt.
  // Viele Stationen auf einer Seite (drei Reihen, Codex): kurz bleiben, sonst sprengen lange Namen die Karte.
  if (names.length > 4 || (compact && names.length > 2)) return `${names.length} Spieler`;
  if (names.length > 2) return [names.slice(0, 2), names.slice(2)].map((row) => row.join(" · ")).join("\n");
  return names.join(" vs. ") || "Teilnehmer offen";
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
