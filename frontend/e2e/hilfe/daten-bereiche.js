// Nachgestellte Antworten für die FAQ-Bereiche aus Paket 3 (#2448): Verein, Events und Kalender, Turniertag vor Ort,
// Gewinne und Trophäen, Datenschutz. Nur erfundene Namen. Aufgebaut wie die Specs verein-pages, public (Antrag),
// event-waitlist, calendar-view, live-queue, tournament-tables-schedule, tournament-notice, trophies,
// profile-achievements-reload und nutzer-luecken.

const FIXTURE = require("../fixtures/tableScheduleGenerated.json").onsite;

const inMinutes = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString();
const inDays = (days, hour = 18) => {
  const day = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  day.setUTCHours(hour, 0, 0, 0);
  return day.toISOString();
};

const NEON = { id: "u-neon", username: "neonfalke", display_name: "Neon Falke", role: "player", email: "neon@example.test", consent_required: false };

// ---------------------------------------------------------------- Verein und Mitgliedschaft

const FEES = [
  { id: 2, label: "Ordentliches Mitglied", description: "Mit Stimmrecht", amount: 60, currency: "EUR", period_label: "je Jahr", subscription_required: true, admission_fee: 0 },
  { id: 3, label: "Ermäßigt", description: "Schüler, Lehrlinge, Studierende", amount: 30, currency: "EUR", period_label: "je Jahr", subscription_required: true, admission_fee: 0 },
];
const JOIN_FEES = { available: true, stale: false, as_of: "2036-10-07T08:00:00Z", purpose: "", fees: FEES };
// Antrag über die Mitgliederverwaltung (Dolibarr), wie im Handbuch (docs/handbuch/verein.md): Mitgliedsart, Angaben,
// Haken bei Statuten und Datenschutz, freiwillige Einwilligung.
const APPLY_FORM = {
  coupled: true, available: true, fees: FEES, form: { required: ["firstname", "lastname", "birth"], fields: [] },
  consents: [{ code: "news", version: 1, label: "Vereinsnews", text: "Ich möchte Neuigkeiten aus dem Verein per E-Mail bekommen." }],
  account: { display_name: "Neon Falke", email: NEON.email },
};
const APPLICATION = { id: "antrag-1", status: "pending", coupled: true, created_at: "2036-10-12T10:00:00Z", decision_note: null, dolibarr: null };

// ---------------------------------------------------------------- Events und Kalender

const EVENT_BASE = {
  id: "e1", slug: "probe-lan", name: "Probe-LAN", status: "registration_open", visibility: "public", event_type: "lan_party", show_participants: false,
  start_date: inDays(20, 9), end_date: inDays(20, 21), location: "Vereinsheim Probehausen", has_registration: true,
  max_participants: 40, allow_companions: true, max_companions_per_registration: 2,
  offer: { enabled: true, currency: "EUR", version: 1, positions: [{ key: "ticket", label: "Eintritt", amount_cents: 1000, basis: "per_person", optional: false }] },
  public_phase: { state: "registration_open", label: "Anmeldung offen" },
  registration_summary: { registered_count: 18, reserved_seats: 22, companion_count: 4, waitlist_count: 0, spots_left: 18 },
  registrations: [], waitlist_registrations: [], own_registration: null, sponsors: [], albums: [], news: [], f1_challenges: [], partners: [], tournaments: [],
  bring_along: ["Eigener Controller"],
};
const EVENT_FULL = {
  ...EVENT_BASE, max_participants: 24,
  registration_summary: { registered_count: 20, reserved_seats: 24, companion_count: 4, waitlist_count: 2, spots_left: 0 },
};
const EVENT_MINE = {
  ...EVENT_BASE,
  own_registration: { id: "r-neon", status: "registered", seat_count: 2, companion_count: 1, note: "Wir kommen etwas später.", can_cancel: true, can_edit: true },
};
const EVENT_CUP = (id, title, hour, extra = {}) => ({
  id, slug: id, title, start_date: inDays(20, hour), status: "registration_open", team_mode: "solo", format: "single_elim", game_name: "Probe Kart",
  public_phase: { state: "registration_open", label: "Anmeldung offen" }, ...extra,
});
const EVENT_PROGRAM = {
  ...EVENT_MINE,
  tournaments: [
    EVENT_CUP("kart-cup", "Probe-Kart-Cup", 10, { my_status: { label: "Du bist dabei" } }),
    EVENT_CUP("duo-cup", "Duo-Cup", 14, { team_mode: "team", game_name: "Probe Shooter" }),
  ],
  f1_challenges: [{ id: "fl-1", slug: "runde-am-ring", title: "Runde am Ring", start_date: inDays(20, 12), status: "registration_open", public_phase: { state: "registration_open", label: "Offen" } }],
};
const EVENT_LIST = [
  { ...EVENT_BASE, registration_summary: EVENT_BASE.registration_summary },
  { ...EVENT_BASE, id: "e2", slug: "spieleabend", name: "Spieleabend im Vereinsheim", event_type: "meetup", start_date: inDays(9, 17), end_date: inDays(9, 21),
    has_registration: false, offer: null, max_participants: null },
  { ...EVENT_BASE, id: "e3", slug: "sommerfest", name: "Sommerfest", event_type: "community", start_date: inDays(45, 12), end_date: inDays(45, 20), max_participants: 80,
    registration_summary: { registered_count: 31, reserved_seats: 37, companion_count: 6, waitlist_count: 0, spots_left: 43 } },
];
const EVENTS_META = { types: [{ k: "lan_party", l: "LAN-Party" }, { k: "meetup", l: "Treffen" }, { k: "community", l: "Community" }], statuses: [] };
const CAL_ITEMS = [
  { id: "e1", kind: "event", slug: "probe-lan", title: "Probe-LAN", start: inDays(20, 9), end: inDays(20, 21), status: "registration_open",
    phase: { label: "Anmeldung offen", state: "registration_open" }, location: "Vereinsheim Probehausen", path: "/events/probe-lan", visibility: "public",
    mine: true, marker: null, own: { state: "registered", label: "Du bist dabei", team_name: null } },
  { id: "t-kart", kind: "tournament", slug: "kart-cup", title: "Probe-Kart-Cup", start: inDays(20, 10), end: null, status: "registration_open",
    phase: { label: "Anmeldung offen", state: "registration_open" }, location: "Probe Kart", path: "/tournaments/kart-cup", visibility: "public",
    mine: true, marker: null, own: { state: "approved", label: "Du bist dabei", team_name: null } },
  { id: "t-duo", kind: "tournament", slug: "duo-cup", title: "Duo-Cup", start: inDays(4, 18), end: null, status: "check_in",
    phase: { label: "Check-in", state: "check_in" }, location: "Probe Shooter", path: "/tournaments/duo-cup", visibility: "public",
    mine: true, marker: null, own: { state: "approved", label: "Du bist dabei", team_name: "Rudel Alpha" } },
];
const PERSONAL_FEED = { active: true, path: "/api/calendar/personal/probe-adresse-nur-zum-zeigen.ics", created_at: new Date().toISOString(), last_used_at: null };

// ---------------------------------------------------------------- Turniertag vor Ort

// Spielplan vor Ort aus dem echten Planer (fixtures/tableScheduleGenerated.json, Satz „onsite“). Für die FAQ: Zeiten auf
// heute verschoben, schlichte Namen statt der Grenzfälle, und das laufende Spiel an der ersten Station - dort stehen
// „Jetzt“ mit der Uhr und „Als Nächstes“ (aufgerufen) zusammen im Bild.
const NAMES = ["NeonFalke", "KartKönigin", "Probepanda", "PixelPaula", "Sturmfuchs", "Testkobold", "Nachteule", "Musterwolf"];
function prepareOnsite() {
  const delta = Date.now() - Date.parse(FIXTURE.tournament.public_phase.now);
  const shifted = JSON.parse(JSON.stringify(FIXTURE), (key, value) => (typeof value === "string" && /^20\d\d-\d\d-\d\dT/.test(value)
    ? new Date(Date.parse(value) + delta).toISOString() : value));
  shifted.bracket.registrations.forEach((row, index) => {
    row.display_name = NAMES[index] || row.display_name;
    row.ingame_name = row.display_name;
  });
  const matches = shifted.bracket.matches_v2;
  const first = matches.find((match) => match.station_id);
  const running = matches.find((match) => match.status === "in_progress");
  for (const key of ["station", "station_id", "station_label", "station_name", "station_text"]) running[key] = first[key];
  return shifted;
}
const onsite = prepareOnsite();
const ONSITE = onsite.tournament;
const ONSITE_MATCHES = onsite.bracket.matches_v2;
const RUNNING = ONSITE_MATCHES.find((match) => match.status === "in_progress");
const WAITING = ONSITE_MATCHES.filter((match) => match.status !== "in_progress" && match.status !== "completed");
const nameOf = (registrationId) => onsite.bracket.registrations.find((row) => row.id === registrationId)?.display_name || "";
const namesOf = (match) => match.slots.map((slot) => nameOf(slot.registration_id)).filter(Boolean);
function queueEntry(match, extra = {}) {
  return {
    match_id: match.id, match_key: match.match_key, label: match.round_label || match.round_name, stage_name: "Turnierbaum", names: namesOf(match),
    station_id: match.station_id, station_text: match.station_text, duration_minutes: 30, delay_minutes: 0, forecast: false, forecast_at: inMinutes(15),
    planned_at: inMinutes(10), called_at: null, report_by: null, started_at: null, paused_at: null, paused_seconds: 0, ready: true, open_slots: 0,
    position: 1, state: "queued", status: match.status, ...extra,
  };
}
// Je Station „Jetzt“ mit Spielzeit-Uhr und „Als Nächstes“ - eine Station aufgerufen, eine mit Verzug.
function onsiteQueue() {
  const stations = [...new Map(ONSITE_MATCHES.filter((match) => match.station_id).map((match) => [match.station_id, match.station_text])).entries()];
  const rows = stations.map(([id, text], index) => {
    const running = RUNNING.station_id === id ? queueEntry(RUNNING, { state: "running", started_at: inMinutes(-25), position: 0 }) : null;
    const nextMatch = WAITING.find((match) => match.station_id === id);
    const next = nextMatch ? queueEntry(nextMatch, index === 0
      ? { state: "called", called_at: inMinutes(-1), report_by: inMinutes(4), position: 0 }
      : { forecast_at: inMinutes(12), forecast: true, delay_minutes: 8 }) : null;
    return { id, name: text.split(" · ")[0], station_text: text, status: running ? "busy" : "free", running, next, after: null, waiting: [] };
  });
  return { applies: true, reason: null, now: new Date().toISOString(), unplaced: [], stations: rows, matches: {}, summary: { delay_minutes: 8, last: { label: "Finale", forecast_at: inMinutes(95) } } };
}
const ONSITE_REG = { id: "reg-neon", user_id: NEON.id, display_name: "Neon Falke", status: "checked_in", is_mine: true };
const ONSITE_CUP = {
  id: "cup-vor-ort", slug: "probe-lan-cup", title: "Probe-LAN-Cup", status: "live", registration_enabled: false, participant_count: 8, max_participants: 8,
  team_mode: "solo", event_mode: "local", format: "single_elim", platform: "Switch", start_date: inMinutes(-60),
  game: { id: "game-1", slug: "probe-kart", name: "Probe Kart", player_id_fields: [] }, public_phase: { state: "live", label: "Läuft" }, my_registration: { id: ONSITE_REG.id },
};
const MY_QUEUE = {
  applies: true, now: new Date().toISOString(), reason: null, summary: null,
  entries: [{ match_id: "m-vor-ort", state: "queued", station_text: "Station 2 · Switch", forecast_at: inMinutes(14), forecast: true, delay_minutes: 8, position: 1, report_by: null }],
};
const NOTICES = { items: [{ id: "h1", text: "Kurze Pause: In 15 Minuten geht es an allen Stationen weiter.", created_at: inMinutes(-3), expires_at: inMinutes(17), target: "tournament", tv: false }] };
const CALLED_MATCH = {
  tournament: { id: ONSITE_CUP.id, slug: ONSITE_CUP.slug, title: ONSITE_CUP.title },
  match: { id: "m-vor-ort", match_key: "VF-B", status: "scheduled", round_name: "Viertelfinale", station_text: "Station 2 · Switch",
    slots: [{ slot: 1, registration_id: "reg-neon" }, { slot: 2, registration_id: "reg-pixel" }] },
  participants: [{ slot: 1, status: "filled", registration_id: "reg-neon", display_name: "Neon Falke" }, { slot: 2, status: "filled", registration_id: "reg-pixel", display_name: "PixelPanther" }],
  matchday_label: "Viertelfinale", schedule_proposals: [], collection: "matches_v2", can_act: true, can_report_score: false, can_player_report_result: false,
  can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false, can_forfeit: false,
  allows_draw: false, event_mode: "local", result_entry_mode: "staff_only", schedule_mode: "fixed_by_staff", acting_registration_id: "reg-neon", in_dispute: false,
  call: { called_at: inMinutes(-1), report_by: inMinutes(4), station_text: "Station 2 · Switch" },
};

// ---------------------------------------------------------------- Gewinne und Trophäen

const PRIZES = [
  { id: "p-ready", status: "ready", place: 1, prize_label: "Gutschein für den Vereinsshop", prize_value: "25 €", tournament_title: "Probe-Kart-Cup", tournament_slug: "kart-cup",
    pickup_deadline: inDays(60), picked_up_at: null },
  { id: "p-pending", status: "pending", place: 2, prize_label: "Controller-Halterung", prize_value: "", tournament_title: "Herbst-Cup", tournament_slug: "herbst-cup",
    pickup_deadline: null, picked_up_at: null },
  { id: "p-done", status: "picked_up", place: 3, prize_label: "Vereinsschal", prize_value: "", tournament_title: "Sommer-Cup", tournament_slug: "sommer-cup",
    pickup_deadline: null, picked_up_at: "2036-07-14T18:00:00Z" },
];
const CERTIFICATES = [{ id: "c1", title: "Probe-Kart-Cup", rank: 1, label: "1. Platz", category: "tournament", download_url: "/api/prizes/me/certificates/c1/pdf" }];
const reward = (id, kind, name, place, metal) => ({
  id, kind, rank: Number(place[0]) || 5, rank_label: place, participants: 8, matches: { played: 7, won: 5 }, record: "5 Siege · 2 Niederlagen",
  tournament: { id: "s-a", slug: "probe-a", title: "Probe-Liga · Season 1" }, game: { name: "Probe Shooter" }, season: { id: "s1", name: "Season 1" },
  team: { id: "team-1", name: "Nordlicht" }, league: { title: name, season_id: "s1", division_label: "Liga 1", staffel: "A", display_name: "Nordlicht · Nordlicht A" },
  image_url: null, date: "2036-11-09", updated_at: "2036-11-12T19:30:00+00:00",
  reward: { id, kind, kind_label: { medal: "Medaille", banner: "Banner", emblem: "Emblem", title: "Titel" }[kind], name, description: "", place_label: place,
    recipients_label: "Team", image_url: null, prize: null, art: { league: "Probe-Liga", season: "Season 1", division: "Liga 1", place, metal } },
});
const CUP_AWARD = (id, title, rank, kind = "trophy") => ({
  id, kind, rank, rank_label: `${rank}. Platz`, participants: 16, matches: { played: 4, won: 4 - rank + 1 }, record: "", tournament: { id: `t-${id}`, slug: id, title },
  game: { name: "Probe Kart" }, season: { id: "y36", name: "Saison 2036" }, team: null, league: null, image_url: null, date: "2036-04-12", reward: null,
});
const AWARDS = [
  reward("w-gold", "medal", "Meister-Medaille", "1. Platz", "gold"),
  reward("w-emblem", "emblem", "Aufsteiger-Emblem", "1. Platz", "gold"),
  reward("w-title", "title", "Kämpferherz", "4. Platz", "lion"),
  reward("w-banner", "banner", "Season-Banner", "Alle Teilnehmer", "lion"),
  CUP_AWARD("fruehjahrs-cup", "Frühjahrs-Cup", 1),
  CUP_AWARD("sommer-cup", "Sommer-Cup", 3),
];
const TIER = (code, name, earned, earnedAt = null) => ({ code, rank: 1, level: 3, name, material: "gold", material_name: "Gold", material_color: "#FFD700", points: 50, earned, earned_at: earnedAt });
const ME_ACHIEVEMENTS = {
  level: { level: 9, title: "Jäger", prestige: 0, points: 900, next_level_points: 1000, progress: 40 },
  groups: [
    { code: "sieg", name: "Siege", category: "match", icon: "trophy", art: "trophy", tiers: [TIER("sieg-1", "Erster Sieg", true, "2026-10-01T10:00:00Z"), TIER("sieg-2", "Fünf Siege", true, "2026-10-13T10:00:00Z"), TIER("sieg-3", "Zehn Siege", false)] },
    { code: "turnier", name: "Turniere", category: "tournament", icon: "medal", art: "crossed-swords", tiers: [TIER("turnier-1", "Erstes Turnier", true, "2026-09-20T10:00:00Z"), TIER("turnier-2", "Fünf Turniere", false)] },
  ],
  awards: [{ code: "sieg-1", award_id: "a1", name: "Erster Sieg" }, { code: "sieg-2", award_id: "a2", name: "Fünf Siege" }, { code: "turnier-1", award_id: "a3", name: "Erstes Turnier" }],
  pinned_codes: ["sieg-2"], pinned: [{ code: "sieg-2", name: "Fünf Siege" }], next_up: [],
};
const PROFILE = {
  ...NEON, privacy_public_profile: true, privacy_public_achievements: true, country: "AT", created_at: "2035-03-01T10:00:00Z",
  stats: { points: 900, wins: 5, top3: 3, tournaments: 6, fast_laps: 0 }, achievement_level: { level: 9, points: 900, next_level_points: 1000, progress: 40 },
  teams: [], awards: AWARDS, honours: [], tournaments: [], f1_bests: [], references: { items: [], stats: {} }, relationship: { status: "self" },
  featured_award: null, featured_title: AWARDS[2], featured_emblems: [AWARDS[0]], league_history: [],
};
const SHARE_AWARD = {
  name: "Fünf Siege", material: "gold", material_name: "Gold", material_color: "#FFD700", rank: 2, icon: "trophy", art: "trophy", group_name: "Siege", points: 50, holders: 42, percent: 12.5,
  description: "Gewinne fünf Spiele in Turnieren.", image_path: "/api/static/achievements/a2.png", path: "/achievements/a/a2", club_name: "THE LION SQUAD",
  earned_at: "2026-10-13T10:00:00Z", user: { display_name: "Neon Falke", username: "neonfalke", avatar_url: null },
};

// ---------------------------------------------------------------- Datenschutz und Konto

const ERASE_OK = { can_erase: true, blockers: [], message: "", closing: null };
const ERASE_BLOCKED = {
  can_erase: false, message: "", closing: "Danach kannst du dein Konto anonymisieren.",
  blockers: [
    { team_id: "t-1", team: "Loewen Probe", squad_id: null, squad: null, role: "leader", role_label: "Teamleitung",
      way: "Gib die Teamleitung an jemanden aus dem Team ab.", link: "/teams/t-1" },
    { team_id: "t-1", team: "Loewen Probe", squad_id: "sq1", squad: "Rudel Alpha", role: "captain", role_label: "Captain",
      way: "Trag im Co-Team einen neuen Captain ein.", link: "/teams?team=t-1" },
  ],
};

module.exports = {
  APPLICATION, APPLY_FORM, AWARDS, CALLED_MATCH, CAL_ITEMS, CERTIFICATES, ERASE_BLOCKED, ERASE_OK, EVENTS_META, EVENT_BASE, EVENT_FULL, EVENT_LIST,
  EVENT_MINE, EVENT_PROGRAM, JOIN_FEES, ME_ACHIEVEMENTS, MY_QUEUE, NEON, NOTICES, ONSITE, ONSITE_CUP, ONSITE_REG, PERSONAL_FEED, PRIZES, PROFILE, RUNNING,
  SHARE_AWARD, onsite, onsiteQueue,
};
