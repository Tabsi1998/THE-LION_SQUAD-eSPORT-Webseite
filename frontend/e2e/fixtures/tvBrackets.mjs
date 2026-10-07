// Erfundene Turnierbäume für die TV-Tests (Meilenstein 59, #1115-#1120) - gebaut wie im Server
// (services/custom_bracket.py): Setzliste, Herkunft je Platz („W:A:1“), Runden nach Abhängigkeit, Abschnitte WB, LB,
// GF und BRONZE. `decide` trägt ein Ergebnis ein und füllt die Ziel-Plätze wie der Server, `start` startet ein Spiel an
// einer Station. Alle Namen erfunden. Ein ES-Modul, damit Vitest (src/**) und Playwright (e2e/) dieselben Bäume nutzen.

export const NAMES = [
  "NeonFalke", "KartKönigin", "LuckyLion", "PixelPaula", "DriftDaniel", "BoostBerta", "TurboTom", "SchnellSchnecke",
  "KurvenKarl", "NitroNina", "BlitzBea", "RaketenRudi", "SternSeppi", "GipfelGabi", "PistenPaul", "ZickZackZoe",
  "RetroRosi", "MaxiMoto", "LisaLaser", "OttoOverdrive", "Der unglaublich lange Spielername Nummer Eins", "FunkenFritz",
  "WolkenWilma", "HupenHanna", "GasGustav", "BremsBruno", "TurboTanja", "PokalPia", "ZielZeno", "RundenRita",
  "SlalomSami", "KometKai",
];

function matchKey(index) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let key = "";
  let value = index;
  for (;;) {
    key = alphabet[value % 26] + key;
    value = Math.floor(value / 26) - 1;
    if (value < 0) return key;
  }
}

function seedPositions(size) {
  if (size === 1) return [1];
  return seedPositions(size / 2).flatMap((seed) => [seed, size + 1 - seed]);
}

function parseSource(raw) {
  if (/^\d+$/.test(raw)) return { type: "seed", seed: Number(raw), raw };
  const [flow, key, rank] = raw.split(":");
  return { type: "rank", flow, match_key: key, rank: Number(rank), raw };
}

/** Ein Turnier aus Zeilen wie im Server-Schema: `[{ section, roundName, key, sources: ["1", "W:A:1"] }]`. */
function build(specs, count, { matchType = "duel", qualifiers = 1, title = "Lions Herbst-Cup", stageType = "single_elimination" } = {}) {
  const byKey = new Map(specs.map((spec) => [spec.key, spec]));
  const depth = new Map();
  const depthOf = (key) => {
    if (depth.has(key)) return depth.get(key);
    const refs = byKey.get(key).sources.map(parseSource).filter((source) => source.type === "rank").map((source) => source.match_key);
    const value = refs.length ? Math.max(...refs.map(depthOf)) + 1 : 1;
    depth.set(key, value);
    return value;
  };
  const registrations = NAMES.slice(0, count).map((name, index) => ({ id: `r${index + 1}`, display_name: name, seed: index + 1 }));
  const matches = specs.map((spec, order) => {
    const slots = spec.sources.map((raw, index) => {
      const source = parseSource(raw);
      const seeded = source.type === "seed" ? registrations[source.seed - 1] : null;
      return { slot: index + 1, source, registration_id: seeded ? seeded.id : null, seed: source.seed ?? null, status: seeded ? "filled" : source.type === "seed" ? "bye" : "pending" };
    });
    const filled = slots.filter((slot) => slot.registration_id).length;
    return {
      id: `m-${spec.key}`, match_key: spec.key, section: spec.section, round: depthOf(spec.key), round_name: spec.roundName, order,
      stage_id: "stage-1", stage_number: 1, stage_type: stageType, match_type: matchType, slots, results: [],
      settings: { match_size: slots.length, qualifiers_per_match: qualifiers, duration_minutes: 30 }, duration_minutes: 30,
      status: filled === slots.length ? "ready" : "pending",
    };
  });
  return {
    tournament: { id: "t1", slug: "herbst-cup", title, status: "live", format: stageType, public_phase: "live" },
    registrations,
    stages: [{ id: "stage-1", name: "Turnierbaum", number: 1, stage_type: stageType, match_type: matchType }],
    matches: [],
    matches_v2: matches,
    engine: "stage",
  };
}

/** K.-o. mit Duellen wie `_auto_single_elim_schema`, auf Wunsch mit Spiel um Platz 3. */
export function singleElimination(count, { bronze = false, title } = {}) {
  let sources = seedPositions(count).map(String);
  const specs = [];
  const rounds = [];
  let round = 1;
  while (sources.length > 1) {
    const keys = [];
    const next = [];
    for (let index = 0; index < sources.length; index += 2) {
      const key = matchKey(specs.length);
      specs.push({ section: "WB", roundName: `Runde ${round}`, key, sources: [sources[index], sources[index + 1]] });
      keys.push(key);
      next.push(`W:${key}:1`);
    }
    rounds.push(keys);
    sources = next;
    round += 1;
  }
  if (bronze && rounds.length >= 2) {
    const semis = rounds[rounds.length - 2];
    specs.push({ section: "BRONZE", roundName: "Spiel um Platz 3", key: matchKey(specs.length), sources: [`L:${semis[0]}:1`, `L:${semis[1]}:1`] });
  }
  return build(specs, count, { title });
}

/** Doppel-K.-o. mit Duellen wie `_auto_double_elim_schema`. */
export function doubleElimination(count, { title } = {}) {
  let sources = seedPositions(count).map(String);
  const specs = [];
  const wbRounds = [];
  let round = 1;
  while (sources.length > 1) {
    const keys = [];
    const next = [];
    for (let index = 0; index < sources.length; index += 2) {
      const key = matchKey(specs.length);
      specs.push({ section: "WB", roundName: `Winner Runde ${round}`, key, sources: [sources[index], sources[index + 1]] });
      keys.push(key);
      next.push(`W:${key}:1`);
    }
    wbRounds.push(keys);
    sources = next;
    round += 1;
  }
  let lbIndex = 0;
  const lbKey = () => `L${matchKey(lbIndex++)}`;
  let lbRound = 1;
  let previous = [];
  for (let index = 0; index < wbRounds[0].length; index += 2) {
    const key = lbKey();
    specs.push({ section: "LB", roundName: `Loser Runde ${lbRound}`, key, sources: [`L:${wbRounds[0][index]}:1`, `L:${wbRounds[0][index + 1]}:1`] });
    previous.push(key);
  }
  lbRound += 1;
  for (const wbRound of wbRounds.slice(1)) {
    const drop = [];
    wbRound.forEach((wbKey, index) => {
      if (index >= previous.length) return;
      const key = lbKey();
      specs.push({ section: "LB", roundName: `Loser Runde ${lbRound}`, key, sources: [`W:${previous[index]}:1`, `L:${wbKey}:1`] });
      drop.push(key);
    });
    lbRound += 1;
    previous = drop;
    if (previous.length > 1) {
      const collapse = [];
      for (let index = 0; index < previous.length; index += 2) {
        const key = lbKey();
        specs.push({ section: "LB", roundName: `Loser Runde ${lbRound}`, key, sources: [`W:${previous[index]}:1`, `W:${previous[index + 1]}:1`] });
        collapse.push(key);
      }
      lbRound += 1;
      previous = collapse;
    }
  }
  specs.push({ section: "GF", roundName: "Grand Final", key: "GF", sources: [`W:${wbRounds[wbRounds.length - 1][0]}:1`, `W:${previous[0]}:1`] });
  return build(specs, count, { title, stageType: "double_elimination" });
}

/**
 * Durchgänge mit 4 Spielern, 2 kommen weiter, mit Loser Bracket (wie die TV-Vorschau): A und B, dann C (Winner
 * Bracket), D und E (Loser Bracket), Grand Final. 8 Spieler.
 */
export function heatDoubleElimination({ title } = {}) {
  const specs = [
    { section: "WB", roundName: "Runde 1", key: "A", sources: ["1", "4", "5", "8"] },
    { section: "WB", roundName: "Runde 1", key: "B", sources: ["2", "3", "6", "7"] },
    { section: "WB", roundName: "Runde 2", key: "C", sources: ["W:A:1", "W:A:2", "W:B:1", "W:B:2"] },
    { section: "LB", roundName: "Loser Runde 1", key: "D", sources: ["L:A:1", "L:A:2", "L:B:1", "L:B:2"] },
    { section: "LB", roundName: "Loser Runde 2", key: "E", sources: ["W:D:1", "W:D:2", "L:C:1", "L:C:2"] },
    { section: "GF", roundName: "Grand Final", key: "GF", sources: ["W:C:1", "W:C:2", "W:E:1", "W:E:2"] },
  ];
  return build(specs, 8, { title, matchType: "ffa", qualifiers: 2, stageType: "custom_bracket" });
}

/** Durchgänge wie `_auto_ffa_custom_schema`: eine Runde Durchgänge, dann ein Finale aus den Weiterkommern. */
export function heats(count, { size = 4, qualifiers = 2, title } = {}) {
  const seeds = Array.from({ length: count }, (_, index) => String(index + 1));
  const specs = [];
  for (let index = 0; index < seeds.length; index += size) {
    specs.push({ section: "WB", roundName: "Runde 1", key: matchKey(specs.length), sources: seeds.slice(index, index + size) });
  }
  if (specs.length > 1) {
    const finalSources = specs.flatMap((spec) => Array.from({ length: qualifiers }, (_, rank) => `W:${spec.key}:${rank + 1}`));
    specs.push({ section: "WB", roundName: "Finale", key: matchKey(specs.length), sources: finalSources });
  }
  return build(specs, count, { title, matchType: "ffa", qualifiers, stageType: "ffa_custom_bracket" });
}

/** Liga wie `_auto_league_schema`: jeder gegen jeden, Spieltage nach der Kreis-Methode (nur die Hinrunde). */
export function league(count, { title = "Lions Liga" } = {}) {
  let players = Array.from({ length: count }, (_, index) => index + 1);
  if (players.length % 2) players.push(null);
  const specs = [];
  for (let day = 1; day < players.length; day += 1) {
    for (let index = 0; index < players.length / 2; index += 1) {
      const [home, away] = [players[index], players[players.length - 1 - index]];
      if (home && away) specs.push({ section: "LIGA", roundName: `Spieltag ${day}`, key: matchKey(specs.length), sources: [String(home), String(away)], day });
    }
    players = [players[0], players[players.length - 1], ...players.slice(1, -1)];
  }
  const bracket = build(specs, count, { title, stageType: "league" });
  // Spieltage hängen nicht voneinander ab - die Runde ist der Spieltag.
  bracket.matches_v2.forEach((match, index) => { match.round = specs[index].day; });
  return bracket;
}

export function find(bracket, key) {
  const match = bracket.matches_v2.find((row) => row.match_key === key);
  if (!match) throw new Error(`Spiel ${key} gibt es nicht`);
  return match;
}

/** Wie der Server: der Platz in der Wertung, den eine Herkunft meint („L“ zählt ab den Weiterkommern). */
function absoluteRank(source, from) {
  if (source.flow !== "L") return source.rank;
  const size = from.slots.length;
  const qualifiers = Math.min(from.settings.qualifiers_per_match || 1, size);
  return source.rank <= size - qualifiers ? qualifiers + source.rank : source.rank;
}

/**
 * Ein Ergebnis: `ranking` sind Anmeldungen in der Reihenfolge der Plätze (ohne Angabe gewinnt die kleinere Setznummer).
 * Füllt die Ziel-Plätze, setzt fertige Spiele auf „ready“.
 */
export function decide(bracket, key, ranking = null) {
  const match = find(bracket, key);
  const players = match.slots.map((slot) => slot.registration_id).filter(Boolean);
  const order = ranking || [...players].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const qualifiers = match.settings.qualifiers_per_match || 1;
  match.status = "completed";
  match.completed_at = "2026-10-10T15:00:00+02:00";
  match.results = order.map((registrationId, index) => ({ registration_id: registrationId, rank: index + 1, score: (order.length - index) * 10 + 2, qualified: index < qualifiers }));
  if (match.slots.length === 2) match.winner_id = order[0];
  delete match.started_at;
  for (const other of bracket.matches_v2) {
    other.slots.forEach((slot) => {
      if (slot.source?.type !== "rank" || slot.source.match_key !== key) return;
      const registrationId = order[absoluteRank(slot.source, match) - 1];
      if (!registrationId) return;
      slot.registration_id = registrationId;
      slot.status = "filled";
    });
    if (other.status === "pending" && other.slots.every((slot) => slot.registration_id)) other.status = "ready";
  }
  return bracket;
}

/** Ein Spiel startet an einer Station (wie die Stationsverwaltung: Status „läuft“, Startzeit). */
export function start(bracket, key, { station = "PC 3", startedAt = "2026-10-10T14:20:00+02:00" } = {}) {
  const match = find(bracket, key);
  match.status = "running";
  if (station) {
    match.station_id = `st-${station.replace(/\s+/g, "-").toLowerCase()}`;
    match.station_name = station;
    match.station_label = station;
  }
  if (startedAt) match.started_at = startedAt;
  return bracket;
}

/** Mehrere Ergebnisse nacheinander, jeweils die kleinere Setznummer vorn. */
export function play(bracket, keys) {
  for (const key of keys) decide(bracket, key);
  return bracket;
}

export function clone(bracket) {
  return JSON.parse(JSON.stringify(bracket));
}

