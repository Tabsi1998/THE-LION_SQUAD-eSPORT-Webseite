// Worst-Case-Daten für „Nichts Wichtiges mehr mit … abschneiden“ (#1314): lange, aber echte Namen, Titel, Orte und
// Rollen (alle innerhalb der max_length im Backend) - gemischt mit kurzen Werten, damit Zeilen nebeneinander
// unterschiedlich lang sind. Die API ist komplett nachgestellt (page.route), es geht nie ins Netz.
// Genutzt von e2e/no-ellipsis.spec.js (kein Titel, Name oder Datum mit „…“, kein seitliches Scrollen).

const NOW = "2026-11-20T09:00:00+00:00";

const LONG = {
  personA: "Aleksandra Wiśniewska-Kowalczyk",
  personAUser: "aleksandra_wisniewska_kowalczyk",
  personB: "Bartholomäus Fitzgerald-Hinterberger",
  personBUser: "bartholomaeus_fitzgerald",
  gamer: "xX_Nebelwolf_Xx.Rudel",
  role: "Stellvertretung Obmann und Jugendreferent",
  roleShort: "Kassier",
  eventLong: "Herbst-LAN 2026 im Kulturhaus Großweikersdorf – das große Vereinswochenende",
  eventMeeting: "Generalversammlung mit Neuwahl des Vorstands und Rückblick auf die Saison",
  tournamentLong: "Herbst-LAN 2026 • Mario Kart 8 Deluxe • Kleines Turnier | Samstag",
  tournamentLong2: "Herbst-LAN 2026 • Super Smash Bros. Ultimate • Doppel-K.-o. für Einsteiger | Sonntag",
  fastlapLong: "Fast Lap Challenge November • Gran Turismo 7 • Nürburgring Nordschleife 24h-Layout",
  location: "Kulturhaus Großweikersdorf, Saal 2 (Eingang Hintertür)",
  newsLong: "Rückblick: Unser erstes Mario-Kart-Turnier mit 48 Fahrerinnen und Fahrern aus ganz Tirol und Vorarlberg",
  newsLong2: "Neue Vereinsräume ab Dezember – alles zum Umzug, zur Schlüsselübergabe und zu den neuen Öffnungszeiten",
  newsLong3: "Generalversammlung 2026: Einladung, Tagesordnung und alle Anträge zur Statutenänderung im Überblick",
  albumLong: "Herbst-LAN 2026 – Siegerehrung, Turnierfinale und die schönsten Momente vom Samstagabend",
  referenceLong: "Österreichische eSports-Staatsmeisterschaft 2026 • Rocket League 3v3 • Landesqualifikation West",
  winner: "Bartholomäus Fitzgerald-Hinterberger",
  notifLong: "Dein Team „Die unaufhaltsamen Nebelwölfe aus Großweikersdorf“ wurde für das Turnier Herbst-LAN 2026 • Mario Kart 8 Deluxe • Kleines Turnier | Samstag bestätigt",
  notifLong2: "Erinnerung: Check-in für Herbst-LAN 2026 • Super Smash Bros. Ultimate • Doppel-K.-o. für Einsteiger | Sonntag öffnet in 30 Minuten",
  search: "herbst",
};

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const PLAYER = {
  id: "u-aleks", username: LONG.personAUser, display_name: LONG.personA, role: "player", roles: ["player"], areas: [],
  email: "aleksandra.wisniewska-kowalczyk@example.test", email_verified: true, is_club_member: true,
};
const ADMIN = {
  id: "u-orga", username: LONG.personBUser, display_name: LONG.personB, role: "club_admin", roles: ["club_admin"],
  areas: ["tournaments", "content", "club", "finance", "system", "moderation"], email_verified: true, mfa_enabled: true, auth_mfa_verified: true,
  is_tournament_staff: true,
};

const phase = (state, label) => ({ state, label, target_at: null, countdown_kind: null });

// --- Events, Turniere, Fast Laps -------------------------------------------------------------------------------------

const SCHEDULE = {
  multi_day: true, count: 3, label: "3 Tage · Fr 27.11. – So 29.11.", range_label: "Fr 27.11. – So 29.11.", next_at: "2026-11-27T16:00:00+00:00",
  days: [
    { index: 1, date: "2026-11-27", label: "Fr 27.11.", time_label: "18:00–23:00", start: "18:00", end: "23:00", door: "17:00", title: "Aufbau, Warm-up und Kennenlernen", location_key: null, location_name: null, start_at: "2026-11-27T17:00:00+00:00", end_at: "2026-11-27T22:00:00+00:00", door_at: "2026-11-27T16:00:00+00:00", ends_next_day: false, state: "next" },
    { index: 2, date: "2026-11-28", label: "Sa 28.11.", time_label: "10:00–02:00", start: "10:00", end: "02:00", door: null, title: null, location_key: null, location_name: LONG.location, start_at: "2026-11-28T09:00:00+00:00", end_at: "2026-11-29T01:00:00+00:00", door_at: null, ends_next_day: true, state: "upcoming" },
    { index: 3, date: "2026-11-29", label: "So 29.11.", time_label: "10:00–16:00", start: "10:00", end: "16:00", door: null, title: "Finaltag mit Siegerehrung", location_key: null, location_name: null, start_at: "2026-11-29T09:00:00+00:00", end_at: "2026-11-29T15:00:00+00:00", door_at: null, ends_next_day: false, state: "upcoming" },
  ],
  now: { state: "before", day_index: null, text: "" },
};

const GAME_MK = { id: "g-mk", name: "Mario Kart 8 Deluxe", short_name: "MK8", slug: "mario-kart-8-deluxe" };
const GAME_SSB = { id: "g-ssb", name: "Super Smash Bros. Ultimate", short_name: "SSBU", slug: "super-smash-bros-ultimate" };

const T_MK = {
  id: "t-mk", slug: "herbst-lan-mk", title: LONG.tournamentLong, status: "registration_open", event_id: "e-lan",
  start_date: "2026-11-28T13:00:00+00:00", public_phase: phase("registration_open", "Anmeldung offen"), team_mode: "solo", game: GAME_MK, format: "single_elimination",
  event_day: { index: 2, count: 3, label: "Sa 28.11.", date: "2026-11-28" },
};
const T_SSB = {
  id: "t-ssb", slug: "herbst-lan-ssb", title: LONG.tournamentLong2, status: "registration_open", event_id: "e-lan",
  start_date: "2026-11-29T09:30:00+00:00", public_phase: phase("registration_open", "Anmeldung offen"), team_mode: "duo", game: GAME_SSB, format: "double_elimination",
  event_day: { index: 3, count: 3, label: "So 29.11.", date: "2026-11-29" },
};
const T_CUP = {
  id: "t-cup", slug: "winter-cup", title: "Winter-Cup", status: "scheduled", event_id: null,
  start_date: "2026-12-05T18:00:00+00:00", public_phase: phase("announced", "Angekündigt"), team_mode: "solo", game: GAME_MK,
};
// Gehört zum abgesagten Event, läuft aber trotzdem - steht deshalb einzeln mit „gehört zu …“ (#2127).
const T_ORPHAN = {
  id: "t-orphan", slug: "vereinsabend-fifa", title: "EA Sports FC 26 • Vereinsabend-Turnier • 2 gegen 2 mit Zufallspartner", status: "registration_open", event_id: "e-cancelled",
  start_date: "2026-12-11T18:00:00+00:00", public_phase: phase("registration_open", "Anmeldung offen"), team_mode: "duo", game_name: "EA Sports FC 26",
};
const F_LAP = {
  id: "f-gt7", slug: "fastlap-november", title: LONG.fastlapLong, status: "live", event_id: "e-lan",
  start_date: "2026-11-27T18:00:00+00:00", end_date: "2026-11-29T14:00:00+00:00", public_phase: phase("upcoming", "Startet bald"),
};

const REGISTRATIONS = [
  { id: "r1", display_name: LONG.personA, status: "registered", seats: 1, companion_count: 0 },
  { id: "r2", display_name: "Leo", status: "registered", seats: 1, companion_count: 0 },
  { id: "r3", display_name: LONG.personB, status: "registered", seats: 3, companion_count: 2 },
  { id: "r4", display_name: LONG.gamer, status: "checked_in", seats: 1, companion_count: 0 },
  { id: "r5", display_name: "Johanna-Theresa Oberhollenzer-Pfeifhofer", status: "registered", seats: 2, companion_count: 1 },
  { id: "r6", display_name: "Mira M.", status: "registered", seats: 1, companion_count: 0 },
  { id: "r7", display_name: "Konstantinos Papadopoulos-Steinwender", status: "waitlist", seats: 1, companion_count: 0 },
];

const EVENT_LAN = {
  id: "e-lan", slug: "herbst-lan-2026", name: LONG.eventLong, status: "registration_open", visibility: "public", event_type: "lan",
  start_date: "2026-11-27T17:00:00+00:00", end_date: "2026-11-29T15:00:00+00:00", door_time: "2026-11-27T16:00:00+00:00",
  location: LONG.location, address: "Hauptplatz 12", postal_code: "3701", city: "Großweikersdorf",
  description: "Drei Tage zocken, Turniere spielen und gemeinsam essen. Bring deinen Controller mit - Bildschirme und Strom stellen wir.",
  public_phase: phase("registration_open", "Anmeldung offen"), schedule: SCHEDULE,
  days: SCHEDULE.days.map(({ date, start, end, door, title, location_key, start_at, end_at, door_at }) => ({ date, start, end, door, title, location_key, start_at, end_at, door_at })),
  has_registration: true, max_participants: 60,
  registration_summary: { reserved_seats: 11, registered_count: 6, companion_count: 3, waitlist_count: 1, spots_left: 49 },
  registrations: REGISTRATIONS,
  highlights: [{ icon: "gamepad", text: "Freies Spielen an zwölf Stationen mit Konsolen und PCs" }, { icon: "food", text: "Essen" }, { icon: "trophy", text: "Drei Turniere mit Sachpreisen" }],
  bring_along: ["Controller (Switch Pro oder Joy-Con-Paar)", "Headset", "Gute Laune"],
  sponsors: [], partners: [], albums: [], news: [], tournaments: [T_MK, T_SSB], f1_challenges: [F_LAP],
};
const EVENT_GV = {
  id: "e-gv", slug: "generalversammlung-2026", name: LONG.eventMeeting, status: "scheduled", visibility: "members", event_type: "meeting",
  start_date: "2026-12-05T17:00:00+00:00", end_date: "2026-12-05T20:00:00+00:00", location: "Vereinsheim", city: "Telfs",
  public_phase: phase("announced", "Angekündigt"), description: "Tagesordnung und Anträge folgen per Mail.", tournaments: [], f1_challenges: [],
};
const EVENT_SHORT = {
  id: "e-short", slug: "spieleabend", name: "Spieleabend", status: "scheduled", visibility: "public", event_type: "club_evening",
  start_date: "2026-12-02T18:00:00+00:00", end_date: "2026-12-02T22:00:00+00:00", location: "Vereinsheim", city: "Telfs",
  public_phase: phase("announced", "Angekündigt"), tournaments: [], f1_challenges: [],
};
const EVENT_CANCELLED = {
  id: "e-cancelled", slug: "vereinsabend-dezember", name: "Vereinsabend Dezember mit Weihnachtsfeier und Wichteln für alle Mitglieder", status: "cancelled", visibility: "public", event_type: "club_evening",
  start_date: "2026-12-11T17:00:00+00:00", end_date: "2026-12-11T22:00:00+00:00", location: "Gasthof Zum Goldenen Löwen, Extrastüberl im ersten Stock", city: "Innsbruck",
  public_phase: phase("cancelled", "Abgesagt"), tournaments: [], f1_challenges: [],
};
const EVENTS = [EVENT_LAN, EVENT_SHORT, EVENT_GV, EVENT_CANCELLED];
const TOURNAMENTS = [T_MK, T_SSB, T_CUP, T_ORPHAN];
const FASTLAPS = [F_LAP];

// --- News ------------------------------------------------------------------------------------------------------------

const newsItem = (id, slug, title, extra = {}) => ({
  id, slug, title, category: "verein", visibility: "public", published_at: "2026-11-18T10:00:00+00:00", created_at: "2026-11-18T10:00:00+00:00",
  excerpt: "", banner_url: "", author_name: "Orga-Team", ...extra,
});
const NEWS = [
  newsItem("n1", "rueckblick-mario-kart", LONG.newsLong, { category: "turnier", pinned: true, excerpt: "Ein langer Abend mit vielen knappen Rennen, einem Fotofinish im Halbfinale und einer Siegerehrung um halb zwei in der Früh." }),
  newsItem("n2", "sieger-herbst-lan", "Sieger beim Kleinen Turnier", { category: "turnier", result: { winner: LONG.winner, tournament: LONG.tournamentLong }, published_at: "2026-11-17T10:00:00+00:00" }),
  newsItem("n3", "neue-vereinsraeume", LONG.newsLong2, { published_at: "2026-11-15T10:00:00+00:00", excerpt: "Ab 1. Dezember treffen wir uns in der Bahnhofstraße 7 – mehr Platz, mehr Stationen und endlich eine eigene Küche für die LAN-Wochenenden." }),
  newsItem("n4", "danke", "Danke!", { published_at: "2026-11-12T10:00:00+00:00", excerpt: "Kurz und herzlich." }),
  newsItem("n5", "generalversammlung-2026", LONG.newsLong3, { category: "verein", published_at: "2026-11-10T10:00:00+00:00" }),
];
const NEWS_DETAIL = {
  ...NEWS[0],
  content: "Was für ein Abend! 48 Fahrerinnen und Fahrer, zwölf Stationen und ein Finale, das erst im letzten Rennen entschieden wurde.\n\nDanke an alle, die mitgeholfen haben.",
  linked_events: [{ id: "e-lan", slug: EVENT_LAN.slug, name: LONG.eventLong, start_date: EVENT_LAN.start_date }],
  linked_tournaments: [{ id: "t-mk", slug: T_MK.slug, title: LONG.tournamentLong }],
  linked_teams: [{ id: "team-1", name: "Die unaufhaltsamen Nebelwölfe" }],
  mentioned_users: [
    { id: "u-aleks", username: LONG.personAUser, display_name: LONG.personA },
    { id: "u-gamer", username: "nebelwolf", display_name: LONG.gamer },
    { id: "u-leo", username: "leo", display_name: "Leo" },
  ],
};

// --- Startseite ------------------------------------------------------------------------------------------------------

const HOME = {
  has_live: false, live: {}, today: {},
  soon: { events: [EVENT_LAN], tournaments: [T_MK, T_SSB], challenges: [F_LAP] },
  upcoming: { events: [EVENT_SHORT, EVENT_GV], tournaments: [T_CUP], challenges: [] },
  news: NEWS, featured_news: [NEWS[0]], stats: {},
  club_numbers: { members: 42, tournaments_completed: 14, prizes: 25, years_active: 3 },
};

const BOARD = [
  { id: "p-obmann", title_male: "Obmann", display_title: "Obmann", is_active: true, user: { id: "cp-1", display_name: LONG.personB, gamertag: "Barthl", profile_url: "/members/barthl" } },
  { id: "p-stv", title_male: LONG.role, display_title: LONG.role, is_active: true, user: { id: "cp-2", display_name: LONG.personA, gamertag: "Aleks", profile_url: "/members/aleks" } },
  { id: "p-kassier", title_male: "Kassier", display_title: LONG.roleShort, is_active: true, user: { id: "cp-3", display_name: "Leo", gamertag: "LeoLöwe", profile_url: "/members/leo" } },
  { id: "p-schrift", title_male: "Schriftführer", display_title: "Schriftführerin und Beauftragte für Datenschutz", is_active: true, user: { id: "cp-4", display_name: "Mira Muster", profile_url: "/members/mira" } },
];

// --- Kalender --------------------------------------------------------------------------------------------------------

const CAL = [
  ...[27, 28, 29].map((day, index) => ({
    id: `e-lan-tag-${index + 1}`, kind: "event", slug: EVENT_LAN.slug, title: `${LONG.eventLong} – Tag ${index + 1}/3`, start: `2026-11-${day}T10:00:00+01:00`, end: `2026-11-${day}T22:00:00+01:00`,
    status: "registration_open", phase: phase("registration_open", "Anmeldung offen"), location: LONG.location, path: `/events/${EVENT_LAN.slug}`, visibility: "public", mine: false, marker: "event_day", event_id: "e-lan", event_name: LONG.eventLong,
  })),
  { id: "t-mk", kind: "tournament", slug: T_MK.slug, title: LONG.tournamentLong, start: "2026-11-28T14:00:00+01:00", end: null, status: "registration_open", phase: phase("registration_open", "Anmeldung offen"), location: "Mario Kart 8 Deluxe", path: `/tournaments/${T_MK.slug}`, visibility: "public", mine: false, marker: null },
  { id: "e-gv", kind: "event", slug: EVENT_GV.slug, title: LONG.eventMeeting, start: "2026-11-24T18:00:00+01:00", end: "2026-11-24T21:00:00+01:00", status: "scheduled", phase: phase("announced", "Angekündigt"), location: "Vereinsheim", path: `/events/${EVENT_GV.slug}`, visibility: "public", mine: false, marker: null },
  { id: "e-short", kind: "event", slug: EVENT_SHORT.slug, title: "Spieleabend", start: "2026-11-18T19:00:00+01:00", end: "2026-11-18T23:00:00+01:00", status: "completed", phase: null, location: "Vereinsheim", path: `/events/${EVENT_SHORT.slug}`, visibility: "public", mine: false, marker: null },
  { id: "f-gt7", kind: "fastlap", slug: F_LAP.slug, title: LONG.fastlapLong, start: "2026-11-21T00:00:00+01:00", end: "2026-11-23T23:59:00+01:00", status: "live", phase: phase("live", "Läuft"), location: "Gran Turismo 7", path: `/fastlap/${F_LAP.slug}`, visibility: "public", mine: false, marker: null },
];

// --- Galerie, Referenzen ---------------------------------------------------------------------------------------------

const ALBUMS = [
  { id: "a1", slug: "herbst-lan-2026", title: LONG.albumLong, photo_count: 128, video_count: 3, taken_at: "2026-11-28T10:00:00+00:00", description: "Alle Fotos vom Wochenende – Turnierfinale, Siegerehrung, Pizza um Mitternacht und das Gruppenfoto auf der Bühne.", visibility: "public", cover_url: "" },
  { id: "a2", slug: "grillfest", title: "Grillfest", photo_count: 24, taken_at: "2026-08-15T10:00:00+00:00", visibility: "public", cover_url: "" },
  { id: "a3", slug: "staatsmeisterschaft", title: "Staatsmeisterschaft Rocket League – Landesqualifikation West in der Olympiaworld", photo_count: 56, section_count: 4, taken_at: "2026-10-03T10:00:00+00:00", visibility: "members", cover_url: "" },
];
const REFERENCES = {
  summary: { total: 3, podiums: 2, games: 2, gold: 1, silver: 1, bronze: 0, seasons: ["2026"] },
  items: [
    { id: "ref1", title: LONG.referenceLong, tournament_name: LONG.referenceLong, placement: 1, best_placement: 1, start_date: "2026-10-03", season: "2026", game: { id: "g-rl", name: "Rocket League", short_name: "RL" }, entries: [] },
    { id: "ref2", title: "LAN-Cup Telfs", tournament_name: "LAN-Cup Telfs", placement: 2, best_placement: 2, start_date: "2026-09-12", season: "2026", game: GAME_MK, entries: [] },
    { id: "ref3", title: "Tiroler Landesmeisterschaft Mario Kart 8 Deluxe • Einzelwertung der Jugendklasse U18", tournament_name: "Tiroler Landesmeisterschaft", placement: 4, best_placement: 4, start_date: "2026-06-01", season: "2026", game: GAME_MK, entries: [] },
  ],
};

// --- Konto: Benachrichtigungen, Suche --------------------------------------------------------------------------------

const NOTIFS = [
  { id: "n-1", title: LONG.notifLong, body: `${LONG.personB} hat euch bestätigt. Check-in am Samstag ab 12:30 im ${LONG.location}.`, url: `/tournaments/${T_MK.slug}`, kind: "general", meta: {}, read: false, created_at: "2026-11-20T08:40:00Z" },
  { id: "n-2", title: LONG.notifLong2, body: "", url: `/tournaments/${T_SSB.slug}`, kind: "general", meta: {}, read: false, created_at: "2026-11-20T08:10:00Z" },
  { id: "n-3", title: "Neue News", body: LONG.newsLong2, url: "/news/neue-vereinsraeume", kind: "general", meta: {}, read: true, created_at: "2026-11-19T18:00:00Z" },
  { id: "n-4", title: `Neue Nachricht von ${LONG.gamer}`, body: "Hast du am Samstag noch einen Platz im Auto frei? Ich würde sonst mit dem Zug fahren.", url: "/profile?tab=inbox&to=u-gamer", kind: "direct_message", meta: { thread_user_id: "u-gamer", message_id: "m-1" }, read: false, created_at: "2026-11-19T17:00:00Z" },
  { id: "n-5", title: "Willkommen!", body: "", url: "", kind: "general", meta: {}, read: true, created_at: "2026-11-10T10:00:00Z" },
];
const SEARCH = [
  { kind: "event", title: LONG.eventLong, subtitle: LONG.location, url: `/events/${EVENT_LAN.slug}`, date: EVENT_LAN.start_date },
  { kind: "tournament", title: LONG.tournamentLong, subtitle: "Mario Kart 8 Deluxe · Einzel", url: `/tournaments/${T_MK.slug}`, date: T_MK.start_date },
  { kind: "tournament", title: LONG.tournamentLong2, subtitle: "Super Smash Bros. Ultimate · Team", url: `/tournaments/${T_SSB.slug}`, date: T_SSB.start_date },
  { kind: "news", title: LONG.newsLong, subtitle: "Turnier", url: "/news/rueckblick-mario-kart", date: "2026-11-18T10:00:00+00:00" },
  { kind: "player", title: LONG.personA, subtitle: `@${LONG.personAUser}`, url: `/u/${LONG.personAUser}` },
];

// --- Verwaltung ------------------------------------------------------------------------------------------------------

const ADMIN_DASHBOARD = {
  player_count: 42, team_count: 7, active_tournaments: 2, registration_open: 2, today_matches: 3, active_f1: 1, total_events: 11,
  open_disputes: 1, membership_applications: { pending: 2 }, tournament_registrations: { pending: 3 }, prize_pickups: { pending: 1, ready: 0 },
  mobile_push: { active_tokens: 12, ticket_errors: 0, receipt_errors: 0 }, client_logs: { open: 0, critical_open: 0, high_open: 0 },
  today: [
    { kind: "check_in", at: "2026-11-20T11:30:00+00:00", url: `/admin/tournaments/${T_MK.id}`, title: LONG.tournamentLong, detail: "12 offen" },
    { kind: "match", at: "2026-11-20T13:00:00+00:00", url: `/admin/tournaments/${T_SSB.id}`, title: `${LONG.personB} gegen ${LONG.gamer} · ${LONG.tournamentLong2}`, detail: "Station 4" },
    { kind: "event", at: "2026-11-20T17:00:00+00:00", url: "/admin/events", title: LONG.eventMeeting, detail: "" },
    { kind: "match", at: "2026-11-20T18:00:00+00:00", url: "/admin/tournaments/t-cup", title: "Leo gegen Mira", detail: "Station 1" },
  ],
  recent_audit_logs: [
    { action: `Turnier „${LONG.tournamentLong}“ bearbeitet von ${LONG.personB}`, created_at: "2026-11-20T08:30:00Z" },
    { action: `Mitgliedsantrag von ${LONG.personA} angenommen`, created_at: "2026-11-20T08:00:00Z" },
    { action: "News veröffentlicht", created_at: "2026-11-19T18:00:00Z" },
  ],
};
const USERS = [
  { id: "u-aleks", username: LONG.personAUser, display_name: LONG.personA, email: PLAYER.email, role: "player", areas: [], is_club_member: true },
  { id: "u-orga", username: LONG.personBUser, display_name: LONG.personB, email: "bartholomaeus.fitzgerald-hinterberger@example.test", role: "club_admin", areas: ["tournaments", "content", "club", "finance", "system", "moderation"] },
  { id: "u-gamer", username: "xx_nebelwolf_xx.rudel", display_name: LONG.gamer, email: "nebelwolf@example.test", role: "player", areas: [] },
  { id: "u-leo", username: "leo", display_name: "Leo", email: "leo@example.test", role: "tournament_admin", areas: ["tournaments"] },
  { id: "u-johanna", username: "johanna_theresa_oberhollenzer", display_name: "Johanna-Theresa Oberhollenzer-Pfeifhofer", email: "j.oberhollenzer@example.test", role: "player", areas: [], is_banned: true, ban_reason: "Wiederholt unsportliches Verhalten" },
];

// --- Routen ----------------------------------------------------------------------------------------------------------

const LISTISH = /notifications|games$|nav$|site-banners|sponsors|partners|streams|twitch|clips|friends\/online|messages\/conversations|achievements|stickers|banners|duty$/;

async function mockLongApi(page, { user = null, now = NOW, log = null } = {}) {
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/\/+$/, "");
    if (request.method() !== "GET") return route.fulfill(json({ ok: true }));
    if (path.startsWith("/api/static/")) return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    switch (path) {
      case "/api/auth/me": return user ? route.fulfill(json(user)) : route.fulfill(json({ detail: "anonym" }, 401));
      case "/api/settings/public": return route.fulfill(json({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at" }));
      case "/api/settings/auth": return route.fulfill(json({ password_login_enabled: true, google_login_enabled: false, registration_enabled: true }));
      case "/api/home/state": return route.fulfill(json(HOME));
      case "/api/board": return route.fulfill(json(BOARD));
      case "/api/news-meta": return route.fulfill(json({ categories: [], in_use: ["turnier", "verein"], visibilities: [] }));
      case "/api/news": return route.fulfill(json(NEWS));
      case "/api/events/meta": return route.fulfill(json({ types: [{ k: "lan", l: "LAN-Party" }, { k: "meeting", l: "Versammlung" }, { k: "club_evening", l: "Vereinsabend" }], statuses: [] }));
      case "/api/events": return route.fulfill(json(EVENTS));
      case "/api/tournaments": return route.fulfill(json(TOURNAMENTS));
      case "/api/f1/challenges": return route.fulfill(json(FASTLAPS));
      case "/api/calendar": return route.fulfill(json({ items: CAL, signed_in: Boolean(user), feed_path: "/api/calendar/feed.ics" }));
      case "/api/calendar/me": return route.fulfill(json({ items: [], subscription: { active: false }, hint_due: false }));
      case "/api/calendar/mine": return route.fulfill(json({ events: {}, tournaments: {}, fastlaps: {} }));
      case "/api/gallery": return route.fulfill(json(ALBUMS));
      case "/api/references": return route.fulfill(json(REFERENCES));
      case "/api/search": return route.fulfill(json({ items: SEARCH }));
      case "/api/admin/notifications":
      case "/api/notifications/me": return route.fulfill(json(user ? NOTIFS : []));
      case "/api/friends": return route.fulfill(json({ incoming: [], friends: [], outgoing: [] }));
      case "/api/admin/dashboard": return route.fulfill(json(ADMIN_DASHBOARD));
      case "/api/admin/growth-stats": return route.fulfill(json({ days: [] }));
      case "/api/setup/status": return route.fulfill(json({ completed: true, health_score: 100, missing: [] }));
      case "/api/admin/system-status": return route.fulfill(json({ database: { ok: true }, smtp: { ok: true, provider: "resend" }, discord: { ok: true }, scheduler: { running: true, jobs: [] }, mail_queue: { pending: 0, failed: 0 } }));
      case "/api/users": return route.fulfill(json(USERS));
      default: break;
    }
    if (path === `/api/events/${EVENT_LAN.slug}`) return route.fulfill(json(EVENT_LAN));
    if (path === `/api/news/${NEWS_DETAIL.slug}`) return route.fulfill(json(NEWS_DETAIL));
    if (/^\/api\/events\/[^/]+\/notices$/.test(path)) return route.fulfill(json([]));
    if (log) log(path);
    return route.fulfill(json(LISTISH.test(path) ? [] : {}));
  });
}

// --- Seiten ----------------------------------------------------------------------------------------------------------

/** Öffnet das Nutzermenü: am PC über den Namen oben rechts, am Handy über das Menü. */
async function openUserMenu(page) {
  const desktop = page.getByTestId("nav-user");
  if (await desktop.isVisible().catch(() => false)) {
    await desktop.click();
    await page.getByTestId("nav-user-menu").waitFor({ state: "visible" });
  } else {
    await page.getByTestId("nav-mobile-toggle").click();
    await page.getByTestId("nav-profile-mobile").waitFor({ state: "visible" });
  }
}

const PAGES = [
  { key: "home", path: "/", user: null, ready: "home-next-up" },
  { key: "news", path: "/news", user: null, ready: "news-card-sieger-herbst-lan" },
  { key: "news-detail", path: `/news/${NEWS_DETAIL.slug}`, user: null, ready: "news-more" },
  {
    key: "events", path: "/events", user: null, ready: "events-list",
    // Die Turniere der LAN aufklappen, damit ihre Zeilen (Titel, Tag, Spielart) mit drauf sind.
    prepare: async (page) => { await page.getByTestId(`event-card-toggle-${EVENT_LAN.slug}`).click(); },
  },
  { key: "event-detail", path: `/events/${EVENT_LAN.slug}`, user: null, ready: "event-whatson" },
  { key: "calendar", path: "/calendar", user: null, ready: null },
  { key: "verein", path: "/verein", user: null, ready: "verein-reference-ref1" },
  { key: "gallery", path: "/galerie", user: null, ready: "album-card-herbst-lan-2026" },
  { key: "faq", path: "/faq?q=anmelden", user: null, ready: null },
  { key: "notifications", path: "/notifications", user: PLAYER, ready: null },
  {
    key: "bell", path: "/", user: PLAYER, ready: "home-next-up", fullPage: false,
    prepare: async (page) => {
      await page.getByTestId("notification-bell").click();
      await page.getByTestId("notification-panel").waitFor({ state: "visible" });
    },
  },
  { key: "usermenu", path: "/", user: PLAYER, ready: "home-next-up", fullPage: false, prepare: openUserMenu },
  {
    key: "search", path: "/", user: null, ready: "home-next-up", fullPage: false,
    prepare: async (page) => {
      await page.getByTestId("global-search-open").first().click();
      await page.getByTestId("global-search-input").fill(LONG.search);
      await page.getByText(LONG.tournamentLong).first().waitFor({ state: "visible" });
    },
  },
  { key: "admin", path: "/admin", user: ADMIN, ready: "dashboard-today" },
  { key: "admin-users", path: "/admin/users", user: ADMIN, ready: null },
];

module.exports = { mockLongApi, LONG, PAGES, PLAYER, ADMIN, NOW };
