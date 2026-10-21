// Ergebnistabelle je Runde (#1950): erfundene Rennliga mit 20 Fahrern - Runde 1 mit Qualifying und Rennen (Zeiten,
// Abstände, Pole, schnellste Runde, Fahrer des Tages, Ausfall, Strafsekunden, Teamfarben), Runde 2 ein Rennen ohne
// Zeiten, Runde 3 geplant. Dazu die Serienseite und die Statistik der Saison. Nur erfundene Namen.

const TEAMS = [
  ["Probe Löwen", "#facc15"], ["Nordwind Racing", "#8b5cf6"], ["Probe Löwen B", "#e879f9"], ["Alpenblitz", "#ef4444"],
  ["Kurvenkunst", "#22d3ee"], ["Talwind GP", "#a5b4fc"], ["Team Zwei", null], ["Reverse Pole", "#f59e0b"],
  ["Probe DarkFriday", "#3b82f6"], ["Sonstige", null],
];
const OWN = ["Probe Löwen", "Probe Löwen B", "Probe DarkFriday"];
const FIRST = ["Lena", "Kai", "Jonas", "Tom", "Nina", "Mira", "Paul", "Eva", "Jon", "Sara", "Ben", "Max", "Lukas", "Anna",
  "Felix", "Iris", "Theo", "Ida", "Leo", "Uma"];
const LAST = ["Brandt", "Funke", "Weber", "Seiler", "Volk", "Stahl", "Ritter", "Kern", "Wirbel", "Lind", "Hof", "Pfeil",
  "Rand", "Kogler", "Sturm", "Graf", "Moos", "Berg", "Wald", "Fels"];

const drivers = FIRST.map((first, index) => {
  const [team, color] = TEAMS[Math.floor(index / 2)];
  return { key: `d${index + 1}`, name: `${first} ${LAST[index]}`, number: String([98, 1, 45, 8, 53, 72, 91, 36, 13, 74, 2, 86, 9, 33, 97, 77, 21, 64, 5, 30][index]), team, color };
});
// Kai Funke und Mira Stahl sind öffentliche Vereinsfahrer.
const CLUB = { d2: "kai-funke", d6: "mira-stahl" };
const SCHEME = [35, 30, 26, 23, 20, 17, 15, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

function person(driver, extra = {}) {
  return {
    key: driver.key, name: driver.name, name_hidden: false, club_member: Boolean(CLUB[driver.key]),
    profile_slug: CLUB[driver.key] || null, own: OWN.includes(driver.team), status: "finished", marks: [],
    start_number: driver.number, team: driver.team, team_color: driver.color, grid: null, gained: null, time: null,
    gap: null, penalty_seconds: null, points: null, fastest_lap: false, fastest_lap_time: null, driver_of_the_day: false,
    ...extra,
  };
}

function ms(text) {
  const [minutes, rest] = text.includes(":") ? text.split(":") : ["0", text];
  return Number(minutes) * 60000 + Math.round(Number(rest.replace(",", ".")) * 1000);
}
function lap(total) {
  const minutes = Math.floor(total / 60000);
  const seconds = ((total % 60000) / 1000).toFixed(3).replace(".", ",");
  return `${minutes}:${seconds.padStart(6, "0")}`;
}
function gap(diff) {
  const seconds = diff / 1000;
  if (seconds >= 60) return `+${lap(diff)}`;
  return `+${seconds.toFixed(3).replace(".", ",")}`;
}

const QUALI_ORDER = [2, 3, 1, 5, 4, 6, 9, 8, 11, 7, 12, 10, 16, 14, 13, 15, 17, 18, 20, 19];
const POLE = ms("1:40,474");
const qualiRows = QUALI_ORDER.map((n, index) => {
  const driver = drivers[n - 1];
  const time = POLE + [0, 261, 587, 695, 910, 926, 1960, 2039, 2167, 2413, 2472, 2526, 3400, 4245, 4484, 5288, 5402, 5610, 6012, 6455][index];
  return person(driver, { place: index + 1, time: lap(time), gap: index ? gap(time - POLE) : null, marks: index ? [] : ["pole"] });
});
const gridOf = Object.fromEntries(QUALI_ORDER.map((n, index) => [`d${n}`, index + 1]));

const RACE_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20];
const WIN = ms("31:55,056");
const raceGaps = [0, 6197, 6360, 6897, 10000, 22219, 23168, 30000, 31975, 33714, 34594, 56678, 94878, 103963, 112402, 118230, 125004, 131876];
const raceRows = RACE_ORDER.map((n, index) => {
  const driver = drivers[n - 1];
  const place = index + 1;
  const grid = gridOf[driver.key];
  const lapped = index === RACE_ORDER.length - 1;
  return person(driver, {
    place, grid, gained: grid - place,
    time: index ? null : lap(WIN),
    gap: index ? (lapped ? "+1 Runde" : gap(raceGaps[index])) : null,
    points: SCHEME[index] + (driver.key === "d2" ? 1 : 0),
    marks: driver.key === "d2" ? ["fastest_lap", "pole"] : [],
    fastest_lap: driver.key === "d2", fastest_lap_time: driver.key === "d2" ? "1:43,375" : null,
    driver_of_the_day: driver.key === "d1",
    penalty_seconds: [11, 12].includes(index) ? 5 : null,
  });
});
raceRows.push(person(drivers[15], { place: null, status: "dnf", grid: gridOf.d16, points: 0 }));
// Ein Name ist auf Wunsch ausgeblendet.
raceRows[16] = { ...raceRows[16], name: null, name_hidden: true, start_number: null };
qualiRows[QUALI_ORDER.indexOf(18)] = { ...qualiRows[QUALI_ORDER.indexOf(18)], name: null, name_hidden: true, start_number: null };

const SESSIONS_R1 = [
  { id: "q1", key: "qualifying", session: "Qualifying", label: "Qualifying", kind: "qualifying", state: "scored", club_day: "2026-10-08", time: "20:00", counts: false, has_result: true, columns: ["start_number", "time", "gap"], pole: { key: "d2", time: "1:40,474" }, best_club: "d2", original: null, rows: qualiRows },
  { id: "r1", key: "rennen", session: "Rennen", label: "Rennen", kind: "race", state: "scored", club_day: "2026-10-08", time: "20:30", counts: true, has_result: true, columns: ["start_number", "grid", "time", "gap", "penalty_seconds", "points"], pole: null, best_club: "d2", original: null, rows: raceRows },
];

const HEAD = {
  lineage: { title: "Probe Rennliga", slug: "probe-rennliga", kind: "racing", label: "F1", organizer: "Probe Racing League", game_name: "F1 25" },
  series: { season: "Season 2026", season_slug: "season-2026", status: "active" },
  own_teams: OWN,
};

const ROUND_1 = {
  ...HEAD, today: "2026-10-21",
  round: { number: 1, total: 3, code: "R1", title: null, venue: "Baku City Circuit", country_code: "AZ", club_day: "2026-10-08", kind: "regular", cancelled: false, scored: true },
  previous: null,
  next: { number: 2, code: "R2", title: null, venue: "Marina Bay", country_code: "SG" },
  sessions: SESSIONS_R1, main: "rennen",
  summary: {
    winner: { key: "d1", session: "rennen", grid: gridOf.d1 },
    pole: { key: "d2", session: "qualifying", time: "1:40,474" },
    fastest_lap: { key: "d2", session: "rennen", time: "1:43,375" },
    driver_of_the_day: { key: "d1", session: "rennen" },
  },
  club_drivers: ["d2", "d6"],
};

const plainRows = drivers.slice(0, 12).map((driver, index) => person(driver, { place: index + 1, points: SCHEME[index], start_number: null }));
const ROUND_2 = {
  ...HEAD, today: "2026-10-21",
  round: { number: 2, total: 3, code: "R2", title: null, venue: "Marina Bay", country_code: "SG", club_day: "2026-10-15", kind: "regular", cancelled: false, scored: true },
  previous: { number: 1, code: "R1", venue: "Baku City Circuit", country_code: "AZ" },
  next: { number: 3, code: "R3", venue: "Monza", country_code: "IT" },
  sessions: [
    { id: "q2", key: "qualifying", session: "Qualifying", label: "Qualifying", kind: "qualifying", state: "missing", club_day: "2026-10-15", time: "20:00", counts: false, has_result: false, columns: [], pole: null, best_club: null, original: null, rows: [] },
    { id: "r2", key: "rennen", session: "Rennen", label: "Rennen", kind: "race", state: "scored", club_day: "2026-10-15", time: "20:30", counts: true, has_result: true, columns: ["points"], pole: null, best_club: "d2", original: null, rows: plainRows },
  ],
  main: "rennen",
  summary: { winner: { key: "d1", session: "rennen", grid: null }, pole: null, fastest_lap: null, driver_of_the_day: null },
  club_drivers: ["d2", "d6"],
};

const roundEntry = (id, code, session, kind, weekend, extra) => ({
  id, code, session, session_kind: kind, weekend, kind: "regular", counts: kind !== "qualifying", title: null, opponent: null,
  original_club_day: null, original_starts_at: null, starts_at: null, status: extra.state === "scored" ? "scored" : "planned", ...extra,
});
const ROUNDS = [
  roundEntry("q1", "R1", "Qualifying", "qualifying", 1, { position: 1, venue: "Baku City Circuit", country_code: "AZ", club_day: "2026-10-08", time: "20:00", state: "scored" }),
  roundEntry("r1", "R1", "Rennen", "race", 1, { position: 2, venue: "Baku City Circuit", country_code: "AZ", club_day: "2026-10-08", time: "20:30", state: "scored" }),
  roundEntry("q2", "R2", "Qualifying", "qualifying", 2, { position: 3, venue: "Marina Bay", country_code: "SG", club_day: "2026-10-15", time: "20:00", state: "missing" }),
  roundEntry("r2", "R2", "Rennen", "race", 2, { position: 4, venue: "Marina Bay", country_code: "SG", club_day: "2026-10-15", time: "20:30", state: "scored" }),
  roundEntry("q3", "R3", "Qualifying", "qualifying", 3, { position: 5, venue: "Monza", country_code: "IT", club_day: "2026-10-29", time: "20:00", state: "planned" }),
  roundEntry("r3", "R3", "Rennen", "race", 3, { position: 6, venue: "Monza", country_code: "IT", club_day: "2026-10-29", time: "20:30", state: "planned" }),
];

const totals = {};
for (const row of [...raceRows, ...plainRows]) totals[row.key] = (totals[row.key] || 0) + (row.points || 0);
const standingRows = drivers.map((driver) => {
  const race = raceRows.find((row) => row.key === driver.key);
  const plain = plainRows.find((row) => row.key === driver.key);
  const results = [];
  if (race) results.push({ round_id: "r1", place: race.place, points: race.points, marks: race.status === "dnf" ? ["dnf"] : race.marks, counted: true, dropped: false, grid: race.grid, ...(race.fastest_lap ? { fastest_lap_time: "1:43,375" } : {}), ...(race.driver_of_the_day ? { driver_of_the_day: true } : {}) });
  if (plain) results.push({ round_id: "r2", place: plain.place, points: plain.points, marks: [], counted: true, dropped: false });
  return { key: driver.key, name: driver.key === "d17" ? null : driver.name, name_hidden: driver.key === "d17", club_member: Boolean(CLUB[driver.key]), profile_slug: CLUB[driver.key] || null, points: totals[driver.key] || 0, computed_points: totals[driver.key] || 0, previous_rank: null, results };
}).sort((a, b) => b.points - a.points).map((row, index) => ({ ...row, rank: index + 1 }));

const SERIES_PAGE = {
  lineage: HEAD.lineage,
  series: { ...HEAD.series, tier: null, title: null, weekend: { formats: [{ from_round: 1, sessions: [{ label: "Qualifying", counts: false, points: "none", grid: "manual", offset: 0 }, { label: "Rennen", counts: true, points: "series", grid: "qualifying", offset: 30 }] }] } },
  rules: { points_mode: "scheme", points_by_place: SCHEME, count_mode: "all", count_n: 0, tiebreakers: [], bonuses: { fastest_lap: { points: 1, max_place: 10 } }, activity_points: { points: 0, from_round: 1 } },
  today: "2026-10-21",
  progress: { total: 3, scored: 2, cancelled: 0, remaining: 1, next: { ...ROUNDS[4] } },
  rounds: ROUNDS,
  standings: { round_id: "r2", rows: standingRows },
  final: null,
  racing: {
    seasons: [], team_scoring: { enabled: false }, teams: null,
    drivers: Object.fromEntries(drivers.map((driver) => [driver.key, { team: driver.team, guest: false, round_teams: { r1: driver.team, r2: driver.team } }])),
    club_teams: OWN,
    club_drivers: ["d2", "d6"],
    qualifying: [{ round_id: "q1", places: Object.fromEntries(QUALI_ORDER.map((n, index) => [`d${n}`, index + 1])), pole: "d2" }],
  },
};

function stat(driver, values) {
  return { key: driver.key, name: driver.key === "d17" ? null : driver.name, name_hidden: driver.key === "d17", club_member: Boolean(CLUB[driver.key]), profile_slug: CLUB[driver.key] || null, races: 2, wins: 0, podiums: 0, poles: 0, fastest_laps: 0, driver_of_the_day: 0, dnfs: 0, avg_grid: null, avg_finish: null, gained: null, ...values };
}
const STATISTICS = {
  ...HEAD,
  drivers: drivers.map((driver, index) => stat(driver, {
    wins: index === 0 ? 2 : 0, podiums: index < 3 ? 2 : 0, poles: driver.key === "d2" ? 1 : 0, fastest_laps: driver.key === "d2" ? 1 : 0,
    driver_of_the_day: driver.key === "d1" ? 1 : 0, dnfs: driver.key === "d16" ? 1 : 0, avg_grid: gridOf[driver.key] || null,
    avg_finish: index < 15 ? index + 1 : null, gained: gridOf[driver.key] && index < 15 ? gridOf[driver.key] - (index + 1) : null,
  })),
  teams: TEAMS.map(([team], index) => ({ key: team, team, own: OWN.includes(team), races: 4, wins: index === 0 ? 2 : 0, podiums: index < 2 ? 3 : 0, poles: team === "Probe Löwen" ? 1 : 0, fastest_laps: team === "Probe Löwen" ? 1 : 0, driver_of_the_day: index === 0 ? 1 : 0, dnfs: team === "Reverse Pole" ? 1 : 0, avg_grid: 3 + index, avg_finish: 2 + index, gained: index % 3 ? index : -index })),
  metrics: {
    drivers: ["wins", "podiums", "poles", "fastest_laps", "driver_of_the_day", "dnfs", "avg_grid", "avg_finish", "gained"],
    teams: ["wins", "podiums", "poles", "fastest_laps", "driver_of_the_day", "dnfs", "avg_grid", "avg_finish", "gained"],
  },
};

module.exports = { ROUND_1, ROUND_2, SERIES_PAGE, STATISTICS };
