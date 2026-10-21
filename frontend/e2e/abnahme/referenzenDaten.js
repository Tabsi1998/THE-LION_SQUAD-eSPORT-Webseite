const { expect } = require("@playwright/test");

// Testdaten der Referenzen-Übersicht (#1878) über die echten Routen: Teilnahmen in vier Jahren und fünf Spielen
// (Podest und ohne Podest, ein sehr langer Name, ein Name in zwei Einträgen), eine Rennliga mit Aufstieg (2024 und 2025
// Liga 2, 2026 Liga 1 laufend), eine Team-Liga (Division 3, dann Division 2 laufend) und eine Turnierserie mit einem
// Termin heute. Fremde Namen stehen nur in den Wertungen. Nur erfundene Namen. Gibt zurück, was die Specs prüfen.

const SERIES = "/api/reference-series/admin";

async function send(page, method, url, data) {
  const cookies = await page.context().cookies();
  const csrf = decodeURIComponent(cookies.find((cookie) => cookie.name === "csrf_token")?.value || "");
  return page.request.fetch(url, { method, data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
}

async function ok(response) {
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

/** Der Wiener Kalendertag, `offset` Tage von heute (JJJJ-MM-TT). */
function viennaDayOffset(offset) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset, 12)).toISOString().slice(0, 10);
}

const POINTS = { points_mode: "scheme", points_by_place: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] };
const TABLE_RULES = { points_mode: "organizer", match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff", "wins"] };

/**
 * Eine Saison mit Fahrer- bzw. Gesamtwertung: das Mitglied auf `place` von `field`, `scored` von `total` Terminen gewertet,
 * der nächste Termin `nextIn` Tage von heute (0 = heute).
 */
async function driverSeason(admin, lineage, { season, tier, status, place, field, scored, total, nextIn, profileId, memberName, stamp }) {
  const series = await ok(await send(admin, "POST", `${SERIES}/series`, {
    lineage_id: lineage.id, season, tier, status, default_time: "20:00", rules: POINTS,
  }));
  const member = await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/participants`, { name: memberName }));
  await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/participants/${member.id}/assign`, { link: "member", profile_id: profileId }));
  const foreign = [];
  for (let index = 1; index < field; index += 1) {
    foreign.push(await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/participants`, { name: `Fremd ${index} ${stamp}` })));
  }
  const rounds = [];
  for (let index = 0; index < total; index += 1) {
    const day = index < scored ? viennaDayOffset((status === "active" ? -7 : -400) - (scored - index) * 7) : viennaDayOffset(nextIn + (index - scored) * 7);
    rounds.push(await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/rounds`, { code: `R${index + 1}`, day })));
  }
  for (const round of rounds.slice(0, scored)) {
    const url = `${SERIES}/series/${series.id}/rounds/${round.id}/results`;
    const { version } = await ok(await admin.request.get(url));
    const order = [...foreign.slice(0, place - 1), member, ...foreign.slice(place - 1)];
    await ok(await send(admin, "PUT", url, {
      rows: order.map((item, rank) => ({ participant_id: item.id, place: rank + 1 })), status: "published", expected_version: version,
    }));
  }
  return series;
}

/** Eine Team-Liga-Saison, Tabelle laut Veranstalter: das eigene Team auf `place` von `teams`. */
async function tableSeason(admin, lineage, { season, tier, status, place, teams, scored, total, nextIn, own, stamp }) {
  const series = await ok(await send(admin, "POST", `${SERIES}/series`, {
    lineage_id: lineage.id, season, tier, status, team_name: own, rules: TABLE_RULES,
  }));
  const others = Array.from({ length: teams - 1 }, (_, index) => `Fremd Team ${index + 1} ${stamp}`);
  const table = [...others.slice(0, place - 1), own, ...others.slice(place - 1)].map((team, index) => ({ team, rank: index + 1, points: (teams - index) * 3 }));
  for (let index = 0; index < total; index += 1) {
    const day = index < scored ? viennaDayOffset((status === "active" ? -3 : -380) - (scored - index) * 7) : viennaDayOffset(nextIn + (index - scored) * 7);
    const round = await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/rounds`, { code: `ST${index + 1}`, day, opponent: others[index % others.length] }));
    if (index >= scored) continue;
    const url = `${SERIES}/series/${series.id}/rounds/${round.id}/results`;
    const { version } = await ok(await admin.request.get(url));
    await ok(await send(admin, "PUT", url, {
      rows: [], matches: [{ home: own, away: others[index % others.length], home_score: 3, away_score: 1, maps: [], lineup: [] }],
      official_table: table, status: "published", expected_version: version,
    }));
  }
  return series;
}

async function createReferenceWorld(admin, stamp) {
  const longName = `Maximilian-Leopold Löwenherz-Probenhofer ${stamp}`;
  const shortName = `Kralle ${stamp}`;
  const profile = async (name) => (await ok(await send(admin, "POST", "/api/membership/profiles/admin", { display_name: name }))).id;
  const longId = await profile(longName);
  const shortId = await profile(shortName);

  // Rennliga mit Aufstieg: 2024 Liga 2 (4.), 2025 Liga 2 (1.), 2026 Liga 1 laufend (2.).
  const racing = await ok(await send(admin, "POST", `${SERIES}/lineages`, { title: `Probe Racing F1 ${stamp}`, kind: "racing", label: "F1", organizer: "Probe Racing", game_name: "F1 25" }));
  const racingSeasons = [];
  racingSeasons.push(await driverSeason(admin, racing, { season: "2024", tier: "Liga 2", status: "completed", place: 4, field: 6, scored: 2, total: 2, nextIn: 0, profileId: shortId, memberName: shortName, stamp }));
  racingSeasons.push(await driverSeason(admin, racing, { season: "2025", tier: "Liga 2", status: "completed", place: 1, field: 6, scored: 2, total: 2, nextIn: 0, profileId: shortId, memberName: shortName, stamp }));
  racingSeasons.push(await driverSeason(admin, racing, { season: "2026", tier: "Liga 1", status: "active", place: 2, field: 8, scored: 6, total: 10, nextIn: 3, profileId: shortId, memberName: shortName, stamp }));

  // Team-Liga: 2025 Division 3 (2., Aufstieg), 2026 Division 2 laufend (3. von 8).
  const own = `Lions Alpha ${stamp}`;
  const league = await ok(await send(admin, "POST", `${SERIES}/lineages`, { title: `Probe Liga Call of Duty ${stamp}`, kind: "team_league", label: "4vs4", organizer: "Probe Verband", game_name: "Call of Duty" }));
  const leagueSeasons = [];
  leagueSeasons.push(await tableSeason(admin, league, { season: "2025", tier: "Division 3", status: "completed", place: 2, teams: 8, scored: 1, total: 1, nextIn: 0, own, stamp }));
  leagueSeasons.push(await tableSeason(admin, league, { season: "2026", tier: "Division 2", status: "active", place: 3, teams: 8, scored: 3, total: 7, nextIn: 2, own, stamp }));

  // Turnierserie: Saison 1 und 2 vorbei, Saison 3 läuft und hat heute einen Termin.
  const cup = await ok(await send(admin, "POST", `${SERIES}/lineages`, { title: `Probe Masters Serie ${stamp}`, kind: "series", organizer: "Probe Masters", game_name: "TFT" }));
  const cupSeasons = [];
  cupSeasons.push(await driverSeason(admin, cup, { season: "Saison 1", tier: null, status: "completed", place: 9, field: 12, scored: 1, total: 1, nextIn: 0, profileId: longId, memberName: longName, stamp }));
  cupSeasons.push(await driverSeason(admin, cup, { season: "Saison 2", tier: null, status: "completed", place: 5, field: 12, scored: 1, total: 1, nextIn: 0, profileId: longId, memberName: longName, stamp }));
  cupSeasons.push(await driverSeason(admin, cup, { season: "Saison 3", tier: null, status: "active", place: 5, field: 12, scored: 2, total: 5, nextIn: 0, profileId: longId, memberName: longName, stamp }));

  // Teilnahmen: Podest und ohne, vier Jahre, fünf Spiele; die Meister-Saison der Rennliga als eigene Referenz.
  const solo = (profileId, placement, extra = {}) => ({ kind: "solo", member_profile_ids: [profileId], placement, ...extra });
  const team = (name, ids, placement, extra = {}) => ({ kind: "team", team_name: name, member_profile_ids: ids, placement, ...extra });
  const references = {};
  const add = async (key, body) => {
    references[key] = await ok(await send(admin, "POST", "/api/references", { status: "completed", visibility: "public", mode: "online", ...body }));
  };
  await add("spring", { title: "Frühjahrs-Cup", organizer: "Probe Kartwerk Liga", game_name: "Mario Kart 8", start_date: viennaDayOffset(-220),
    entries: [solo(longId, 1, { participant_count: 32 }), solo(shortId, 4, { participant_count: 32 })] });
  await add("clash", { title: "Winter Clash Finale", organizer: "Probe Austria Open", game_name: "Rocket League", format: "Team 3v3", start_date: viennaDayOffset(-250),
    entries: [team(`Lions Rocket ${stamp}`, [shortId], 2, { team_count: 16 })] });
  await add("champion", { title: "Probe Racing F1 · Liga 2", organizer: "Probe Racing", game_name: "F1 25", season: "2025", league: "Liga 2", start_date: viennaDayOffset(-320),
    series_id: racingSeasons[1].id, entries: [solo(shortId, 1, { participant_count: 6 })] });
  await add("autumn", { title: "Autumn Cup", organizer: "Probe Kart Vienna", game_name: "Mario Kart 8", start_date: viennaDayOffset(-370),
    entries: [solo(longId, 1), team(`Lions Kart ${stamp}`, [longId, shortId], 5)] });
  await add("summer", { title: "Sommer-Liga", organizer: "Probe Kartwerk Liga", game_name: "Mario Kart 8", start_date: viennaDayOffset(-500),
    entries: [solo(shortId, 3)] });
  await add("showdown", { title: "Spring Showdown", organizer: "Probe Rocket League Open", game_name: "Rocket League", format: "Team 3v3", start_date: viennaDayOffset(-560),
    entries: [team(`Lions Rocket ${stamp}`, [shortId], 7)] });
  await add("autumn24", { title: "Herbst-Turnier", organizer: "Probe Gamesbar", game_name: "Mario Kart 8", start_date: viennaDayOffset(-710),
    entries: [solo(shortId, 3)] });
  await add("community", { title: "Community Cup", organizer: "Probe Valorant AT", game_name: "Valorant", format: "Team 5v5", start_date: viennaDayOffset(-770),
    entries: [team(`Lions Five ${stamp}`, [longId], 9)] });
  await add("founding", { title: "Gründungsturnier der Lions Esports Akademie mit einem außergewöhnlich langen Namen", organizer: "Probe Kart Vienna", game_name: "Mario Kart 8", format: "Team 2v2", start_date: viennaDayOffset(-1050),
    entries: [team(`Lions Duo ${stamp}`, [longId, shortId], 2)] });

  return {
    profiles: [longId, shortId], names: { long: longName, short: shortName }, own, references,
    lineages: { racing, league, cup }, seasons: { racing: racingSeasons, league: leagueSeasons, cup: cupSeasons },
  };
}

/** Aufräumen nach dem Lauf: Spuren archivieren, Profile abschalten, Referenzen löschen. */
async function removeReferenceWorld(admin, world) {
  if (!world) return;
  for (const reference of Object.values(world.references || {})) await send(admin, "DELETE", `/api/references/${reference.id}`).catch(() => {});
  for (const lineage of Object.values(world.lineages || {})) await send(admin, "POST", `${SERIES}/lineages/${lineage.id}/archive`).catch(() => {});
  for (const id of world.profiles || []) await send(admin, "PATCH", `/api/membership/profiles/admin/${id}`, { is_active: false }).catch(() => {});
}

module.exports = { createReferenceWorld, removeReferenceWorld, send, ok, viennaDayOffset };
