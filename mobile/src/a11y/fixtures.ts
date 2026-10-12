// Erfundene Testdaten für die Barrierefreiheits-Prüfung (#1155): lange Namen und Listen mit acht Personen, damit die
// Prüfung mit großer Schrift volle Screens sieht und nicht nur leere Zustände. Keine echten Personen.

const NAMES = [
  "KiwiKomet der Unaufhaltsame",
  "NeonFalke aus dem Mühlviertel",
  "Sternenstaub Lena Zweitausendsieben",
  "Donnerbüffel Maximilian",
  "Pixelpirat Hochgeschwindigkeit",
  "Morgenrot Gamer Oberösterreich",
  "Schattenläufer der Nordkurve",
  "Quantenquokka mit Turbo",
];
const START = "2026-11-14T09:00:00+01:00";
const END = "2026-11-16T18:00:00+01:00";
export const LONG_TEAM = "Lions Rocket Academy Oberösterreich Nord";

export const people = NAMES.map((name, index) => ({
  id: `p${index + 1}`,
  user_id: `p${index + 1}`,
  username: `spieler${index + 1}`,
  display_name: name,
  name,
  avatar_url: null,
}));
const ids = people.map((person) => person.id);

const tournament = {
  id: "x1", slug: "x1", title: "Herbst-LAN 2026 · EA SPORTS FC 26 Cup der langen Namen", status: "registration_open",
  game_name: "EA SPORTS FC 26", game: { name: "EA SPORTS FC 26", display_name: "EA SPORTS FC 26" }, start_date: START, end_date: END,
  participant_count: 8, max_participants: 16, participants: NAMES, format_label: "Single Elimination", team_mode: "solo",
  registration_enabled: true, matches: [], standings: NAMES.map((name, index) => ({ rank: index + 1, name, points: 24 - index * 3 })),
};
const event = {
  id: "x1", slug: "x1", title: "Vereinsabend mit sehr langer Bezeichnung im Herbst", name: "Vereinsabend mit sehr langer Bezeichnung im Herbst",
  start_date: START, end_date: END, location: "Vereinsheim Linz-Urfahr, Halle 2", status: "upcoming", visibility: "public",
  has_registration: true, participant_view: "public",
  registrations: people.map((person) => ({ id: person.id, user_id: person.id, display_name: person.display_name, status: "confirmed" })),
};
const track = { id: "tr1", name: "Autodromo Nazionale Monza", country: "Italien" };
const challenge = {
  id: "x1", slug: "x1", title: "Fast Lap Herbst-Challenge auf dem Autodromo Nazionale Monza", status: "active", start_date: START,
  end_date: END, participant_count: 8, track_count: 1, tracks: [track],
};
const leaderboard = {
  challenge, track,
  entries: people.map((person, index) => ({
    user_id: person.id, username: person.username, display_name: person.display_name, time_ms: 81234 + index * 321,
    time_str: `1:2${index}.234`, rank: index + 1, gap_str: index ? `+${index}.321` : "", attempts: 3, points: 25 - index * 3,
  })),
};
const squad = { id: "s1", team_id: "x1", name: "Herbst-LAN Squad mit sehr langem Namen", members: people, member_ids: ids, status: "active", game: "Rocket League" };
const team = {
  id: "x1", name: LONG_TEAM, tag: "LRAN", description: "Wir spielen jeden Donnerstag.", is_public: true, is_member: true, member_count: 8,
  squad_count: 1, leader: people[0], leader_id: "p1", co_leader_ids: ["p2"], member_ids: ids, can_manage: true, my_role: "leader",
  members: people, squads: [squad],
};
const news = {
  id: "x1", slug: "x1", title: "Rückblick auf die Herbst-LAN mit einer sehr langen Überschrift", excerpt: "So war das Wochenende in der Halle.",
  content: "Text", category: "Verein", published_at: "2026-10-01T10:00:00+02:00",
};
const album = { id: "x1", slug: "x1", title: "Herbst-LAN 2026 · Fotos aus der großen Halle", photo_count: 0, photos: [] };
export const notifications = [
  { id: "n1", kind: "tournament_reminder", title: "Dein Match im FC 26 Cup der langen Namen beginnt gleich", body: "Station 3 · Switch 2", read: false, created_at: "2026-10-08T09:00:00+02:00" },
  { id: "n2", kind: "team_invite", title: `Einladung ins Team ${LONG_TEAM}`, body: "Von NeonFalke aus dem Mühlviertel", read: true, created_at: "2026-10-07T18:30:00+02:00" },
];
const prizes = [
  { id: "z1", status: "ready", place: 1, place_label: "1. Platz", prize_label: "Gutschein für das Vereinsheim mit langem Namen", tournament_title: tournament.title, source_type: "tournament" },
  { id: "z2", status: "picked_up", place: 2, place_label: "2. Platz", prize_label: "Controller", fastlap_challenge_title: challenge.title, source_type: "fastlap" },
  { id: "z3", status: "open", place: 3, place_label: "3. Platz", prize_label: "Vereinsschal", tournament_title: tournament.title, source_type: "tournament" },
];
const chats = {
  items: [
    { key: "team:x1", kind: "team", target_id: "x1", title: LONG_TEAM, subtitle: "Team-Chat", tag: "LRAN", unread_count: 2, last_message: { text: "Bis Donnerstag!", author: NAMES[1] } },
    { key: "direct:p3", kind: "direct", target_id: "p3", title: NAMES[2], subtitle: "Direktnachricht", username: "spieler3", unread_count: 0, last_message: { text: "GG", author: NAMES[2] } },
  ],
  unread_total: 2,
};
const publicList = people.map((person) => ({ ...person, favorite_games: ["EA SPORTS FC 26", "Rocket League"], achievement_level: { title: "Rudelführer", level: 12 } }));
const leaders = people.map((person, index) => ({ ...person, rank: index + 1, points: 900 - index * 70, level: 20 - index, title: "Rudelführer" }));
const publicProfile = { id: "p1", username: "spieler1", display_name: NAMES[0], role: "player", bio: "Spielt am liebsten FC 26.", awards: [], honours: [] };
const dashboard = {
  me: { tournaments: [tournament], events: [event], matches: [], staff_matches: [], actions: [] },
  public: { tournaments: [tournament], events: [event] },
  news: [news],
  streams: [],
  season: null,
  stats: { my_tournaments: 1, my_events: 1, open_matches: 0, staff_matches: 0, open_actions: 0, news: 1, public_tournaments: 1, public_events: 1, live_streams: 0 },
};

const FIXTURES: Array<[RegExp, unknown]> = [
  [/^\/mobile\/dashboard$/, dashboard],
  [/^\/tournaments$/, [tournament, { ...tournament, id: "x2", slug: "x2", status: "running" }]],
  [/^\/events$/, [event]],
  [/^\/f1\/challenges$/, [challenge]],
  [/^\/f1\/challenges\/[^/]+\/leaderboard$/, leaderboard],
  [/^\/teams(\/my)?$/, [team]],
  [/^\/teams\/[^/]+\/squads$/, [squad]],
  [/^\/teams\/[^/]+\/overview$/, { upcoming: [], recent: [] }],
  [/^\/teams\/[^/]+\/level$/, { level: 3 }],
  [/^\/news$/, [news]],
  [/^\/gallery$/, [album]],
  [/^\/mobile\/notifications$/, notifications],
  [/^\/prizes\/me$/, prizes],
  [/^\/users\/public-list$/, publicList],
  [/^\/chats$/, chats],
  [/^\/achievements\/leaderboard$/, leaders],
  [/^\/me\/awards$/, { awards: [] }],
  [/^\/mobile\/profile\/references$/, { items: [], stats: { total: 0, tournaments: 0, fastlaps: 0, wins: 0, podiums: 0 } }],
  [/^\/achievements\/me$/, { groups: [] }],
  [/^\/tournaments\/[^/]+$/, tournament],
  [/^\/events\/[^/]+$/, event],
  [/^\/f1\/challenges\/[^/]+$/, challenge],
  [/^\/teams\/[^/]+$/, team],
  [/^\/news\/[^/]+$/, news],
  [/^\/gallery\/[^/]+$/, album],
  [/^\/users\/public\/[^/]+$/, publicProfile],
];

/** Die Testantwort für eine Adresse - unbekannte Listen bleiben leer. */
export function fixtureFor(url: string): unknown {
  const path = url.split("?")[0];
  const hit = FIXTURES.find(([pattern]) => pattern.test(path));
  return hit ? hit[1] : [];
}
