const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("../abnahme/abnahmeSession");

// Gemeinsame Hilfen der Liga-Gesamtabnahme G.1 (#1632, docs/liga/abnahme.md): echtes Backend, echtes MongoDB, Testwelt aus
// scripts/seed_liga_g1.py (Stand-Datei über ABNAHME_STATE, gesetzt von scripts/run_liga_g1.sh). Keine nachgestellte API.

const ROOT = path.join(__dirname, "..", "..", "..");
const SHOTS = process.env.ABNAHME_SHOTS || "";
const SMALL = { width: 390, height: 844 };
const LARGE = { width: 1440, height: 900 };
const WIDTHS = [SMALL, LARGE];
const MINUTE = 60_000;
const ADMIN = "/api/admin/leagues";
const RUN = state?.run || "";
// Der Seed schreibt einen G.1-Stand (mit „run“); ein Stand der anderen Abnahme-Seeds hat keinen.
const READY = ENABLED && Boolean(state?.run);
const SKIP_REASON = `nur für die Liga-Gesamtabnahme (scripts/run_liga_g1.sh, Stand ${STATE_FILE})`;

// Modi mit Ergebnisregel (C.3): Punkte je Map sind Pflicht, der Sieger erreicht das Ziel genau.
const MODES = [
  { mode: "stellung", label: "Stellung", result_rule: { kind: "score", target: 250 } },
  { mode: "suchen", label: "Suchen & Zerstören", result_rule: { kind: "rounds", target: 6, round_limit: 11 } },
  { mode: "kontrolle", label: "Kontrolle", result_rule: { kind: "rounds", target: 3, round_limit: 5 } },
];
const LOSER_SCORE = { stellung: 180, suchen: 3, kontrolle: 1 };
const TARGET = { stellung: 250, suchen: 6, kontrolle: 3 };
// Erfundene Test-Maps und ihre Modi.
const MAPS = [
  ["Hafenkante", ["stellung", "suchen", "kontrolle"]], ["Nebelwerk", ["stellung", "suchen"]], ["Turmruine", ["suchen", "kontrolle"]],
  ["Salzmine", ["stellung", "kontrolle"]], ["Bahnhof Nord", ["stellung", "suchen"]], ["Gletscherbau", ["stellung", "suchen"]],
  ["Uferhalle", ["stellung", "suchen", "kontrolle"]],
];
const POOL = {
  stellung: ["Hafenkante", "Nebelwerk", "Salzmine", "Bahnhof Nord", "Gletscherbau"],
  suchen: ["Hafenkante", "Nebelwerk", "Turmruine", "Bahnhof Nord", "Uferhalle"],
  kontrolle: ["Hafenkante", "Turmruine", "Uferhalle"],
};
// Best of 5 wie im Regelwerk: Stellung, Suchen, Kontrolle, Stellung, Suchen.
const MODE_ORDER = ["stellung", "suchen", "kontrolle", "stellung", "suchen"];

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "kein seitliches Scrollen").toBeLessThanOrEqual(1);
}

/** Ein eigener Browser-Kontext je Person. Gäste sehen 401 auf /api/auth/* - das ist erwartet. */
async function as(browser, testInfo, role, viewport = LARGE) {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport, locale: "de-AT", timezoneId: "Europe/Vienna" });
  const page = await context.newPage();
  await signIn(page, role);
  const allow = role === "anon" ? (response) => response.url().includes("/api/auth/") : () => false;
  return { page, role, problems: watch(page, { allow }), close: () => context.close() };
}

/** Abschluss einer Person: keine Seitenfehler, keine Konsolenfehler, keine 4xx/5xx im Browser - dann schließen. */
async function done(...people) {
  for (const person of people) {
    expect(person.problems, `Probleme bei ${person.role}`).toEqual([]);
    await person.close();
  }
}

/** Aufruf der echten API aus dem Kontext der Person (mit CSRF-Kopf), außerhalb der Wache. Antwort: Status und Inhalt. */
async function api(person, method, url, data) {
  const page = person.page || person;
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "csrf_token")?.value || "";
  const response = await page.request.fetch(url, { method, headers: { "X-CSRF-Token": decodeURIComponent(csrf) }, data });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status(), body, text };
}

/** Wie api(), erwartet 200 und gibt den Inhalt zurück. */
async function ok(person, method, url, data) {
  const result = await api(person, method, url, data);
  expect(result.status, `${method} ${url}: ${result.text.slice(0, 400)}`).toBe(200);
  return result.body;
}

const get = (person, url) => ok(person, "GET", url);

/** Zeit-Helfer aus scripts/seed_liga_g1.py (Fristen-Job, Veto-Zeitüberschreitung, Ergebnisse altern lassen, Altdaten). */
function job(name, args = {}) {
  const argv = [path.join(ROOT, "scripts", "seed_liga_g1.py"), "--job", name];
  for (const [key, value] of Object.entries(args)) argv.push(`--${key}`, String(value));
  const output = execFileSync(process.env.PYTHON || "python3", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return JSON.parse(output.trim().split("\n").pop());
}

/** Heute in Wien als JJJJ-MM-TT. */
function viennaDay(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * MINUTE);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

const teamIndexOfSquad = (squadId) => state.teams.findIndex((row) => row.squad_id === squadId);

/** Spiele einer Staffel (fest, ohne Vorschau) und die Zuordnung Anmeldung → Index im Stand. */
async function staffelMatches(person, tid) {
  const body = await get(person, `/api/tournaments/${tid}/matches-v2`);
  return (Array.isArray(body) ? body : body.matches || []).filter((row) => !row.is_preview);
}

async function registrationIndex(person, tid) {
  const rows = await get(person, `/api/tournaments/${tid}/registrations`);
  return Object.fromEntries(rows.map((row) => [row.id, teamIndexOfSquad(row.squad_id)]));
}

async function standings(person, tid) {
  const rows = await get(person, `/api/tournaments/${tid}/standings`);
  return Object.fromEntries(rows.map((row) => [row.registration_id, row]));
}

/** Liga und Season über die API, mit Modi, Maps, Pool, Regelwerk, Liga 1 und Staffeln (Szenarien 1 und 2). */
async function buildLeague(admin, lead, { name, staffeln = 1, season = {}, publish = true } = {}) {
  const game = state.game;
  await ok(admin, "PATCH", `/api/games/${game.id}`, { match_modes: MODES });
  const known = (await get(admin, `/api/games/${game.id}/maps`)).maps;
  const maps = {};
  for (const [mapName, modes] of MAPS) {
    maps[mapName] = known.find((row) => row.name === mapName)
      || await ok(admin, "POST", `/api/games/${game.id}/maps`, { name: mapName, modes, note: "Test-Map der Abnahme (erfunden)" });
  }
  const league = await ok(lead, "POST", ADMIN, { name, game_id: game.id });
  const seasonRow = await ok(lead, "POST", `${ADMIN}/${league.id}/seasons`, {
    start_date: `${viennaDay(-1)}T00:00:00`, weeks_total: 20, round_robin_legs: 1, best_of: 5, team_size: 4,
    max_staffel_size: 16, game_mode_order: MODE_ORDER, rules_text: "Regeln der Abnahme-Season (Platzhalter)", ...season,
  });
  await ok(lead, "PUT", `${ADMIN}/seasons/${seasonRow.id}/map-pool`, {
    modes: Object.entries(POOL).map(([mode, names]) => ({ mode, map_ids: names.map((mapName) => maps[mapName].id) })),
  });
  const division = await ok(lead, "POST", `${ADMIN}/seasons/${seasonRow.id}/divisions`, {});
  const tids = [];
  for (let index = 0; index < staffeln; index += 1) {
    tids.push((await ok(lead, "POST", `${ADMIN}/divisions/${division.id}/staffeln`, {})).tournament_id);
  }
  let rule = null;
  if (publish) {
    const scope = `/api/admin/league-rules/league_season/${seasonRow.id}`;
    const draft = await ok(lead, "PUT", `${scope}/draft`, { title: "Regelwerk Abnahme", body_md: "# Fairplay\n\nFair spielen. Platzhalter der Abnahme, erfunden.\n", annexes: [] });
    rule = await ok(lead, "POST", `${scope}/publish`, {
      revision: draft.revision, valid_from: viennaDay(0), change_reason: "Fassung für die Abnahme", requires_consent: false, confirm_empty: true });
  }
  return { game, maps, league, season: seasonRow, division, tids, tid: tids[0], rule };
}

/** Ein Co-Team aus dem Stand direkt zuteilen (Weg der Leitung). */
async function assign(lead, tid, index) {
  const team = state.teams[index];
  return ok(lead, "POST", `/api/tournaments/${tid}/squad-registrations`, { team_id: team.team_id, squad_id: team.squad_id });
}

/** Spiele einer Serie: Maps laut Veto (planned_games) oder aus dem Pool, Sieger je Position, Punkte nach Ergebnisregel. */
function seriesGames(winners, home, away, { planned = null, maps = null } = {}) {
  return winners.map((winner, index) => {
    const position = index + 1;
    const mode = MODE_ORDER[index];
    const mapId = planned ? planned[index].map_id : maps[POOL[mode][index % POOL[mode].length]].id;
    const loser = winner === home ? away : home;
    return { position, mode, map_id: mapId, winner_registration_id: winner, scores: { [winner]: TARGET[mode], [loser]: LOSER_SCORE[mode] } };
  });
}

/** Siegerfolgen: 3:0, 3:1, 3:2 aus Sicht von `winner`. */
function pattern(score, winner, loser) {
  return {
    "3:0": [winner, winner, winner],
    "3:1": [winner, loser, winner, winner],
    "3:2": [winner, loser, loser, winner, winner],
  }[score];
}

function resultsOf(winner, loser, score) {
  const [won, lost] = score.split(":").map(Number);
  return [{ registration_id: winner, rank: 1, score: won }, { registration_id: loser, rank: 2, score: lost }];
}

/** Die ersten `count` einsatzfähigen Spieler einer Seite laut Check-in-Block. */
async function presentOf(person, matchId, count) {
  const page = await get(person, `/api/matches/${matchId}/page`);
  const roster = page.checkin.roster.filter((row) => !row.blocked);
  return roster.slice(0, count ?? page.checkin.min_present).map((row) => row.id);
}

async function checkIn(person, matchId) {
  return ok(person, "POST", `/api/matches/${matchId}/checkin`, { present: await presentOf(person, matchId) });
}

/** Das Veto über die API durchziehen: jeweils die Seite am Zug wählt die erste zulässige Map. */
async function playVeto(people, matchId) {
  const any = Object.values(people)[0];
  let block = (await get(any, `/api/matches/${matchId}/veto`)).veto;
  for (let guard = 0; guard < 40 && block.status === "running"; guard += 1) {
    const actor = people[block.current.registration_id];
    const option = block.options.find((row) => row.allowed);
    await ok(actor, "POST", `/api/matches/${matchId}/veto/pick`, { map_id: option.map_id, version: block.version });
    block = (await get(any, `/api/matches/${matchId}/veto`)).veto;
  }
  expect(block.status).toBe("done");
  return block;
}

module.exports = {
  ADMIN, ENABLED, LARGE, MINUTE, MODE_ORDER, MODES, POOL, READY, RUN, SKIP_REASON, SMALL, TARGET, WIDTHS,
  api, as, assign, buildLeague, checkIn, done, get, job, noSideScroll, ok, pattern, playVeto, presentOf, registrationIndex,
  resultsOf, seriesGames, shot, staffelMatches, standings, state, teamIndexOfSquad, viennaDay,
};
