// Durchgänge als Startaufstellung (#1120): die Plätze eines Durchgangs im versetzten Raster wie beim Start eines Rennens -
// zwei Reihen, die rechte etwas nach hinten versetzt, in der Reihenfolge der Plätze im Durchgang. Nach dem Ergebnis rücken
// die Weiterkommer mit „weiter“ nach vorn, die anderen rutschen mit „→ Loser Bracket“ oder „raus“ zur Seite. Duelle
// bleiben „A gegen B“. Dazu: was an einer Station gerade läuft oder als Nächstes kommt (Stations-Ansicht).
import { advancementsOf, outcomeLabel } from "@/lib/tvTravel";
import { isLiveMatch } from "@/lib/tvLive";
import { isMatchDone } from "@/lib/slotSource";

/** Ein Duell (zwei Plätze) wird „A gegen B“, alles andere ein Raster. */
export function isDuelMatch(match) {
  return String(match?.match_type || "duel") === "duel" && (match?.slots || []).length <= 2;
}

/**
 * Die Plätze im Raster. Vor dem Ergebnis: Startplatz 1 links vorn, 2 rechts etwas dahinter, 3 links in der zweiten Reihe
 * … Nach dem Ergebnis: vorn die Weiterkommer (nach Platz, nebeneinander), dahinter etwas zur Seite die anderen.
 * Gibt je Platz `{ registrationId, slot, col, row, back, start, rank, score, kind, label }` und die Zahl der Reihen zurück.
 */
export function startGrid(match, matches = [], { lastStage = true, table = false } = {}) {
  const slots = (match?.slots || []).map((slot, index) => ({ ...slot, start: index + 1 }));
  const outcomes = advancementsOf(match, matches, { lastStage, table });
  const decided = outcomes.length > 0 && isMatchDone(match);
  if (!decided) {
    const places = slots.map((slot, index) => ({
      registrationId: slot.registration_id || null,
      slot: slot.slot ?? index + 1,
      start: slot.start,
      col: index % 2,
      row: Math.floor(index / 2),
      back: false,
      rank: null,
      score: null,
      kind: null,
      label: "",
    }));
    return { decided: false, places, rows: Math.ceil(places.length / 2), frontRows: 0 };
  }
  const byRegistration = new Map(outcomes.map((entry) => [entry.registrationId, entry]));
  const ranked = slots
    .map((slot) => ({ slot, outcome: byRegistration.get(slot.registration_id) || null }))
    .sort((a, b) => (a.outcome?.rank ?? 99) - (b.outcome?.rank ?? 99) || a.slot.start - b.slot.start);
  const forward = (entry) => entry.outcome && ["win", "place"].includes(entry.outcome.kind) && (entry.outcome.kind === "win" || entry.outcome.place === 1);
  const front = ranked.filter(forward);
  const back = ranked.filter((entry) => !forward(entry));
  const frontRows = Math.ceil(front.length / 2);
  const place = (entry, index, offset, isBack) => ({
    registrationId: entry.slot.registration_id || null,
    slot: entry.slot.slot ?? entry.slot.start,
    start: entry.slot.start,
    col: index % 2,
    row: offset + Math.floor(index / 2),
    back: isBack,
    rank: entry.outcome?.rank ?? null,
    score: entry.outcome?.score ?? null,
    kind: entry.outcome?.kind ?? null,
    label: outcomeLabel(entry.outcome),
  });
  const places = [...front.map((entry, index) => place(entry, index, 0, false)), ...back.map((entry, index) => place(entry, index, frontRows, true))];
  return { decided: true, places, rows: frontRows + Math.ceil(back.length / 2), frontRows };
}

/** Wie das Raster beschriftet ist: vor dem Ergebnis „Startplatz 2“, danach „Platz 1 · 54 Punkte“. */
export function gridSubline(place) {
  if (!place) return "";
  if (place.rank === null || place.rank === undefined) return `Startplatz ${place.start}`;
  return [`Platz ${place.rank}`, place.score !== null && place.score !== undefined ? `${place.score} Punkte` : ""].filter(Boolean).join(" · ");
}

function scheduledOrder(a, b) {
  const at = Date.parse(a.scheduled_at || "") || Number.MAX_SAFE_INTEGER;
  const bt = Date.parse(b.scheduled_at || "") || Number.MAX_SAFE_INTEGER;
  return at - bt || (a.round || 0) - (b.round || 0) || (a.order || 0) - (b.order || 0);
}

/**
 * Was an einer Station läuft oder als Nächstes kommt (Stations-Ansicht, #1120): `mode` „live“ (läuft gerade), „next“
 * (kommt als Nächstes) oder `null` (nichts geplant). Zuerst zählt, was dort läuft, dann was die Stationsverwaltung dort
 * eingeplant hat (zugewiesen, Warteschlange), dann das früheste offene Spiel mit dieser Station.
 */
export function stationLineup(stationId, station, matches = []) {
  const atStation = (matches || []).filter((match) => match?.station_id && match.station_id === stationId);
  const live = atStation.filter(isLiveMatch).sort(scheduledOrder)[0];
  if (live) return { mode: "live", match: live };
  const byId = new Map((matches || []).map((match) => [match.id, match]));
  const open = (match) => match && !isMatchDone(match);
  const assigned = byId.get(station?.current_match_id);
  if (open(assigned)) return { mode: isLiveMatch(assigned) ? "live" : "next", match: assigned };
  for (const id of station?.queue_match_ids || []) {
    if (open(byId.get(id))) return { mode: "next", match: byId.get(id) };
  }
  const next = atStation.filter(open).sort(scheduledOrder)[0];
  return next ? { mode: "next", match: next } : { mode: null, match: null };
}
