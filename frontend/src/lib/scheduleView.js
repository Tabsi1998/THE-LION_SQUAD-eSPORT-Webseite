// Öffentlicher Spielplan (#1562): aus der Baum-Antwort (/api/tournaments/:id/bracket) eine Liste zum Lesen - je Runde
// oder je Station, auf Wunsch nur die eigenen Spiele. Zeit, Station und „voraussichtlich“ kommen vom Server (Planer,
// Spieltag-Lauf, Terminabstimmung); hier wird nichts geplant, nur sortiert und beschriftet.
import { finderFor, sourceLabel } from "@/lib/slotSource";
import { formatBracketSection, formatScheduleGroupLabel, slotName, stationText } from "@/lib/tournamentLabels";
import { isCancelled, isDone, isLive } from "@/lib/bracketGraph";

export const NO_STATION = "Ohne Station";
const GROUP_SECTION = /^group_/i;

/** Wie es um ein Spiel steht: live (läuft), done (entschieden), cancelled (entfällt) oder open. */
export function statusTone(match) {
  if (isLive(match)) return "live";
  if (isDone(match)) return "done";
  if (isCancelled(match)) return "cancelled";
  return "open";
}

function scoreOf(results, registrationId) {
  const row = (results || []).find((result) => result?.registration_id && result.registration_id === registrationId);
  if (!row) return null;
  const score = Number(row.score);
  return Number.isFinite(score) && row.score != null ? score : null;
}

function winnerIds(match) {
  const results = match?.results || [];
  const winners = results.filter((row) => row?.outcome === "winner" || Number(row?.rank) === 1).map((row) => row.registration_id);
  // Zwei auf Platz 1 heißt Unentschieden - dann ist niemand Sieger.
  return winners.length === 1 ? new Set(winners) : new Set();
}

// Wie im Turnierbaum (lib/bracketGraph heatText): voll „4 Spieler“, teils „2 von 4 Spielern“, noch leer „4 Plätze“.
function heatCount(filled, seats) {
  if (filled === seats) return `${filled} Spieler`;
  if (filled) return `${filled} von ${seats} Spielern`;
  return `${seats} ${seats === 1 ? "Platz" : "Plätze"}`;
}

/** Einträge in Spielreihenfolge: Runde, dann Reihenfolge im Baum. */
export function scheduleEntries(bracket) {
  const matches = bracket?.matches_v2 || [];
  const tournament = bracket?.tournament || {};
  const registrations = new Map((bracket?.registrations || []).map((reg) => [reg.id, reg]));
  const mineIds = new Set((bracket?.registrations || []).filter((reg) => reg?.is_mine).map((reg) => reg.id));
  const finder = finderFor(matches);
  // Solange der Baum Vorschau ist, die Vorschau (vorgeplant, Fabian live 14.10.) - sonst nur echte Spiele.
  const real = matches.filter((match) => !match?.is_preview);
  return (real.length ? real : matches)
    .map((match) => {
      const done = isDone(match);
      const winners = done ? winnerIds(match) : new Set();
      const slots = [...(match.slots || [])].sort((a, b) => Number(a.slot ?? a.position ?? 0) - Number(b.slot ?? b.position ?? 0));
      const sides = slots.map((slot) => {
        const reg = registrations.get(slot.registration_id) || null;
        const label = reg?.display_name || reg?.ingame_name || reg?.user?.display_name || sourceLabel(slot.source, finder(match)) || slotName("", slot, match);
        return {
          id: slot.registration_id || null,
          label,
          known: !!reg,
          score: done ? scoreOf(match.results, slot.registration_id) : null,
          winner: !!slot.registration_id && winners.has(slot.registration_id),
          mine: !!slot.registration_id && mineIds.has(slot.registration_id),
        };
      });
      const station = stationText(match);
      const filled = sides.filter((side) => side.id).length;
      return {
        id: match.id,
        match,
        round: Number(match.matchday_number || match.round || 0),
        order: Number(match.order ?? 0),
        roundLabel: match.round_label || formatScheduleGroupLabel(match, tournament),
        groupLabel: GROUP_SECTION.test(String(match.section || "")) ? formatBracketSection(match.section) : "",
        stationKey: match.station_id || (station ? station : ""),
        stationLabel: station,
        scheduledAt: match.scheduled_at || null,
        // Vom Planer nur vorhergesagt (die Plätze stehen noch nicht fest): „voraussichtlich“.
        // Vorschau-Baum: alles nur voraussichtlich - wer gegen wen spielt, kann sich bis zum Check-in-Ende noch ändern.
        forecast: (!!match.schedule_forecast || !!match.is_preview) && !done && !isLive(match),
        startedAt: match.started_at || null,
        tone: statusTone(match),
        sides,
        // Mehr als zwei Plätze (Lauf, FFA): „Lauf A · 4 Spieler“ statt „A gegen B gegen C gegen D“ (Abnahme #1593).
        heat: sides.length > 2 ? { name: `Lauf ${match.match_key || ""}`.trim(), count: heatCount(filled, sides.length) } : null,
        mine: sides.some((side) => side.mine),
      };
    })
    .sort((a, b) => a.round - b.round || a.order - b.order);
}

/** Nach Runden: die Reihenfolge der Runden bleibt die des Baums. */
export function groupByRound(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = `${entry.round}:${entry.roundLabel}`;
    if (!groups.has(key)) groups.set(key, { key, label: entry.roundLabel, entries: [] });
    groups.get(key).entries.push(entry);
  }
  return [...groups.values()];
}

function byTime(a, b) {
  if (a.scheduledAt && b.scheduledAt && a.scheduledAt !== b.scheduledAt) return a.scheduledAt < b.scheduledAt ? -1 : 1;
  if (!a.scheduledAt !== !b.scheduledAt) return a.scheduledAt ? -1 : 1;
  return a.round - b.round || a.order - b.order;
}

export function hasStations(entries) {
  return entries.some((entry) => entry.stationKey);
}

/** Nach Stationen: je Station die Spiele nach Zeit; „PC 2“ vor „PC 10“, Spiele ohne Station zuletzt. */
export function groupByStation(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.stationKey || "";
    if (!groups.has(key)) {
      // „Switch 4 · Switch 2“: der Name der Station groß, das Gerät klein daneben (Abnahme #1593).
      const [name, ...device] = (entry.stationLabel || NO_STATION).split(" · ");
      groups.set(key, { key: key || "none", label: entry.stationLabel || NO_STATION, name, device: device.join(" · "), entries: [] });
    }
    groups.get(key).entries.push(entry);
  }
  const list = [...groups.values()];
  for (const group of list) group.entries.sort(byTime);
  return list.sort((a, b) => {
    if ((a.key === "none") !== (b.key === "none")) return a.key === "none" ? 1 : -1;
    return a.label.localeCompare(b.label, "de", { numeric: true, sensitivity: "base" });
  });
}

export function onlyMine(entries) {
  return entries.filter((entry) => entry.mine);
}
