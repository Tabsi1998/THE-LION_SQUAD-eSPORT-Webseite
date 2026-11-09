// Nachgestellte Antworten des Servers für die Hilfe-Bilder (#2295). Nur erfundene Namen. Aufgebaut wie die Specs
// league-application, league-checkin, league-schedule, league-eligibility, team-verwaltung, tournament-register-sheet,
// match-report-photo, match-confirm und tournaments-round.

const CONSENT = () => window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
  essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
  saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
}));

const OBJECTS = {
  "/home/about": {}, "/chats/unread": {}, "/seasonal/active": {}, "/friends": { incoming: [], friends: [], outgoing: [] },
  "/teams/levels": { levels: {}, crowns: {} }, "/me/platform-links": { links: [], available: {}, platforms: {} },
  "/users/me/notification-preferences": {}, "/me/league-applications": { items: [] }, "/leagues": { leagues: [] },
  "/me/league-eligibility": { items: [] }, "/me/league-ids": { items: [] }, "/calendar/hint": {}, "/users/me/friends-hint": {},
};

/**
 * Ein Server für eine Seite: `state.user` ist die angemeldete Person (null = Gast), `state.routes` je Pfad (ohne /api)
 * eine Antwort oder eine Funktion ({ request, url, body }) → Antwort; „POST /pfad“ für andere Methoden. Was fehlt,
 * bekommt eine leere Liste bzw. ein leeres Objekt.
 */
async function serve(page, state) {
  await page.addInitScript(CONSENT);
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.startsWith("/changes") || path.startsWith("/spam-guard")) return route.abort();
    if (path === "/auth/me") return state.user ? json(state.user) : json({ detail: "nicht angemeldet" }, 401);
    if (path === "/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at", registration_enabled: true });
    let body = null;
    try { body = request.postDataJSON(); } catch { body = null; }
    for (const key of [`${request.method()} ${path}`, request.method() === "GET" ? path : null]) {
      if (!key || !(key in state.routes)) continue;
      const answer = state.routes[key];
      const value = typeof answer === "function" ? await answer({ request, url, body }) : answer;
      if (value !== undefined) return json(value);
    }
    if (request.method() !== "GET") return json({ ok: true });
    return json(path in OBJECTS ? OBJECTS[path] : []);
  });
}

const inMinutes = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString();

// ---------------------------------------------------------------- Konto und Profil

const PLAYER = {
  id: "u-neon", username: "neonfalke", display_name: "NeonFalke", role: "player", email: "neon@example.test", bio: "Spiele am liebsten am Abend.",
  city: "Probehausen", country: "AT", privacy_public_profile: true, consent_required: false, birth_date: "", main_platforms: ["PC"],
  game_ids: { "probe-hauptspiel": { activision_id: "NeonFalke#1234567", platform: "PC" } }, updated_at: "2026-10-01T10:00:00.000000+00:00",
};
const GAMES = [{
  id: "g1", slug: "probe-shooter", name: "Probe Shooter", identity_game_slug: "probe-hauptspiel", identity_game_name: "Probe Shooter",
  effective_player_id_fields: [
    { key: "activision_id", label: "Activision-ID", required: true, format_hint: "Name#1234567" },
    { key: "platform", label: "Plattform", options: ["PC", "PlayStation", "Xbox"], required: true },
  ],
}];
const ELIGIBILITY = { items: [{ season_id: "s1", squad_id: "sq1", title: "Probe-Liga · Season 1", state: "age_missing", min_age: 16, ok: false }] };

// ---------------------------------------------------------------- Team und Co-Team

const LEAD = { id: "u-1", username: "mila", display_name: "Mila Mustermann", role: "player", areas: [] };
const MATE = { id: "u-2", username: "tom", display_name: "Tom Beispiel" };
const MATE2 = { id: "u-3", username: "ida", display_name: "Ida Probe" };
const MATE3 = { id: "u-4", username: "ben", display_name: "Ben Test" };
const MEMBERS = [LEAD, MATE, MATE2, MATE3].map(({ id, username, display_name }) => ({ id, username, display_name }));
const TEAM = {
  id: "t-1", name: "Loewen Probe", tag: "LPR", leader_id: LEAD.id, co_leader_ids: [], member_ids: MEMBERS.map((m) => m.id), is_public: true, is_member: true, my_role: "leader",
  members: MEMBERS, can_manage: true, can_remove_members: true, can_dissolve: true, can_change_roles: true, can_edit_team: true, join_code: "Pr0beCode", awards: [], member_count: 4,
};
const SQUAD = { id: "s-1", team_id: "t-1", name: "Rudel Alpha", status: "active", member_ids: MEMBERS.map((m) => m.id), members: MEMBERS, game_id: "g-1", game: "Probe Shooter", captain_id: MATE.id, vice_captain_id: MATE2.id };
const TEAM_GAMES = [{ id: "g-1", name: "Probe Shooter" }, { id: "g-2", name: "Probe Kart" }];

// ---------------------------------------------------------------- Liga

const CAPTAIN = { id: "u1", username: "mila", display_name: "Mila Mustermann", role: "player", consent_required: false };
const BLOCK = { state: "open", opens_at: "2026-11-01T17:00:00+00:00", closes_at: "2036-11-20T19:00:00+00:00", slots: 8, slots_free: 3, waitlist: true, waitlist_full: false, entry_policy: "all" };
const SEASON_VIEW = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" } },
  season: { id: "s1", name: "Season 1", slug: "season-1", start_date: "2036-11-09T23:00:00+00:00", end_date: "2037-01-18T22:59:59+00:00", matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", best_of: 3, team_size: 4, match_points: { win: 3, draw: 1, loss: 0 }, blocked_periods: [], registration_deadline: "2036-11-06" },
  look: {}, prizes: [], map_pool: null, divisions: [], rules: null, application: BLOCK,
};
const OWN_SQUAD = { squad_id: "sq1", squad_name: "Rudel Alpha", team_id: "t1", team_name: "Loewen Probe", display_name: "Loewen Probe · Rudel Alpha", member_count: 5, can_apply: true, state: "open", application: null, problems: [], warnings: ["Tom Beispiel: Die Spiel-ID fehlt im Profil."], can_submit: true };
const RULES_INFO = { version_id: "v1", version: 2, label: "Version 2", title: "Regelwerk der Probe-Liga", valid_from: "2026-11-01", url: "/liga/probe-liga/season-1/regeln", pdf_url: "/api/league-rules/seasons/probe-liga/season-1/versions/v1/pdf" };
const MINE = {
  application: BLOCK, season_problems: [], hint: null, squads: [OWN_SQUAD], rules: RULES_INFO,
  privacy: { text: "Für die Anmeldung speichert der Verein die Angaben deines Co-Teams.", url: "/privacy" },
};
const MINE_SUBMITTED = {
  ...MINE,
  squads: [{
    ...OWN_SQUAD, state: "submitted", can_submit: false, application: { id: "a1", status: "submitted", can_withdraw: true },
    shortfall: "Nur 3 von 5 Spielern sind spielberechtigt, die Season verlangt mindestens 4.",
    warnings: ["Tom Beispiel: Die Spiel-ID fehlt im Profil.", "Ida Probe: Geburtsdatum fehlt. Die Person trägt es im eigenen Profil ein."],
  }],
};

const SIDES = [{ registration_id: "a", name: "Loewen Probe · Rudel Alpha" }, { registration_id: "b", name: "Falken Test · Horst" }];
const POOL = { modes: [{ mode: "stellung", label: "Stellung", maps: [{ map_id: "hafen", name: "Hafenkante" }, { map_id: "turm", name: "Turm" }] }] };
const ROSTER = [
  { id: "u1", name: "Mila Mustermann" }, { id: "u2", name: "Tom Beispiel" }, { id: "u3", name: "Ida Probe" }, { id: "u4", name: "Ben Test" }, { id: "u5", name: "Pia Probe" },
  { id: "u6", name: "Noa Test", lineup_blocked: "Geburtsdatum fehlt. Die Person trägt es im eigenen Profil ein." },
];
const LEAGUE = {
  lineup_mode: "series", lineup_min_players: 3, participants: {}, own_lineup: [], lineup_overdue: false, scores_required: true,
  best_of: 1, needed: 1, team_size: 4, mode_order: [], pool: POOL, sides: SIDES, own_registration_id: "a", roster: ROSTER, rosters: {},
  games: [], lineups_missing: [], own_games: [], proposal_games: [], can_amend_lineup: false, id_label: null, lobby_ids: [], map_repeat: "always",
};
const MATCH_BASE = {
  tournament: { id: "t1", slug: "probe-liga-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A" },
  participants: SIDES.map((side, index) => ({ slot: index + 1, status: "filled", registration_id: side.registration_id, display_name: side.name })),
  matchday_label: "Spieltag 2", collection: "matches_v2", can_act: true, can_report_score: false, can_player_report_result: false,
  can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false,
  can_forfeit: false, allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal",
  acting_registration_id: "a", report_state: null, schedule_proposals: [], schedule_block: null,
  match: { id: "m1", match_key: "L2", status: "scheduled", schedule_status: "proposed", slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
};
const MATCH_PROPOSALS = {
  ...MATCH_BASE, can_propose_schedule: true, can_manage_schedule: true,
  schedule_proposals: [
    { id: "p-theirs", status: "pending", kind: "proposal", actor_registration_id: "b", actor_user_id: "f1", scheduled_at: "2036-11-16T19:00:00+00:00", note: "Sonntag passt uns gut.", actor: { display_name: "Falke Eins" } },
  ],
};
const SCHEDULE_RULES = { home_rule: true, home_rule_hours: 72, reschedule_notice_hours: 24, reschedule_max: 2, reschedule_same_week: true, result_reminder_hours: 24, result_overdue_hours: 48 };
const FIXED_AT = "2036-11-14T19:00:00+00:00";
const MATCH_FIXED = {
  ...MATCH_BASE,
  match: { ...MATCH_BASE.match, schedule_status: "accepted", schedule_source: "accepted", scheduled_at: FIXED_AT },
  schedule_block: {
    rules: SCHEDULE_RULES, fixed: true, source: "accepted", scheduled_at: FIXED_AT, window: { start: "2036-11-11T23:00:00+00:00", end: "2036-11-18T23:00:00+00:00" },
    count: 0, remaining: 2, request_until: "2036-11-13T19:00:00+00:00", can_request: true, request_hint: null, requests: [],
    history: [{ id: "h1", kind: "agreement", to: FIXED_AT, by_name: "Falke Eins", side_name: SIDES[1].name, at: "2036-11-09T10:00:00+00:00" }],
    home_rule_at: null, own_registration_id: "a", can_lead_set: false,
  },
};
const CHECKIN_RULES = { opens_minutes_before: 15, closes_minutes_after: 15, min_present: 3, remind_minutes_before_close: 5 };
const CHECKIN_ROSTER = [
  { id: "u1", name: "Mila Mustermann", blocked: null }, { id: "u2", name: "Tom Beispiel", blocked: null }, { id: "u3", name: "Ida Probe", blocked: null },
  { id: "u4", name: "Ben Test", blocked: null }, { id: "u6", name: "Noa Test", blocked: "Geburtsdatum fehlt. Die Person trägt es im eigenen Profil ein." },
];
const OTHER_SIDE = { registration_id: "b", name: SIDES[1].name, own: false, checked_in: true, at: inMinutes(-3), present: [{ id: "f1", name: "Falke Eins" }, { id: "f2", name: "Falke Zwei" }, { id: "f3", name: "Falke Drei" }], present_count: 3, consent_open: false };
function checkinPage() {
  return {
    ...MATCH_BASE,
    match: { ...MATCH_BASE.match, schedule_status: "accepted", schedule_source: "accepted", scheduled_at: inMinutes(5) },
    checkin: {
      rules: CHECKIN_RULES, state: "open", scheduled_at: inMinutes(5), window: { opens_at: inMinutes(-10), closes_at: inMinutes(20) }, ready_at: null, started_at: null,
      sides: [{ registration_id: "a", name: SIDES[0].name, own: true, checked_in: false, present: [], present_count: 0, consent_open: false }, OTHER_SIDE],
      own_registration_id: "a", can_checkin: true, checkin_hint: null, roster: CHECKIN_ROSTER, min_present: 3, can_start: false,
      start_hint: "Starten geht erst, wenn beide Seiten eingecheckt sind.", proposal: null, lead: null,
    },
  };
}
function readyPage() {
  const page = checkinPage();
  const present = CHECKIN_ROSTER.slice(0, 4).map(({ id, name }) => ({ id, name }));
  return {
    ...page,
    checkin: {
      ...page.checkin, state: "ready", ready_at: inMinutes(-1), can_start: true, start_hint: null,
      sides: [{ ...page.checkin.sides[0], checked_in: true, at: inMinutes(-1), present, present_count: present.length }, OTHER_SIDE],
    },
  };
}
const REPORT_PAGE = {
  ...MATCH_BASE, matchday_label: "Spieltag 1", can_report_score: true, can_player_report_result: true,
  match: { ...MATCH_BASE.match, status: "in_progress", schedule_status: "accepted" }, report_state: { status: "open" }, league: LEAGUE,
};
const PLAYED = [{ position: 1, mode: "stellung", mode_label: "Stellung", map_id: "hafen", map_name: "Hafenkante", winner_registration_id: "b", scores: { a: 180, b: 250 }, lineups: {} }];
const CONFIRM_PAGE = {
  ...REPORT_PAGE, can_dispute: true, dispute_until: "2036-11-16T20:00:00+00:00",
  report_state: { status: "confirm", proposal_by: "Falke Eins", proposal_at: "2036-11-14T20:10:00+00:00" }, league: { ...LEAGUE, proposal_games: PLAYED },
};

// ---------------------------------------------------------------- Turniere

const SPIELER = { id: "user-1", username: "probe", display_name: "Probe Spieler", role: "player", user_type: "community_user" };
const CUP = {
  id: "tournament-1", slug: "probe-cup", title: "Probe Cup", status: "registration_open", registration_enabled: true, participant_count: 5, max_participants: 16,
  team_mode: "solo", event_mode: "online", format: "single_elim", platform: "PC",
  start_date: "2036-10-04T18:00:00+00:00", check_in_from: "2036-10-04T17:00:00+00:00", check_in_until: "2036-10-04T17:45:00+00:00",
  rules: "Fair Play gilt immer. Ergebnisse melden beide Seiten auf der Matchseite. Wer zu spät kommt, verliert kampflos.",
  game: { id: "game-1", slug: "probe-game", name: "Probespiel", player_id_fields: [] },
  public_phase: { state: "registration_open", label: "Anmeldung" },
};
const CUP_CHECKIN = { ...CUP, status: "check_in", public_phase: { state: "check_in", label: "Check-in" }, check_in_from: inMinutes(-20), check_in_until: inMinutes(25), start_date: inMinutes(40) };
const MY_REG = { id: "registration-1", user_id: SPIELER.id, display_name: SPIELER.display_name, status: "approved", is_mine: true };
const DUEL_ENTRY = {
  id: "m1", kind: "duel", best_of: 1, ranking_mode: "higher_score", allows_draw: false, label: "Halbfinale A",
  participants: [{ registration_id: "r1", name: "NeonFalke" }, { registration_id: "r2", name: "PixelPanther" }], advance: {},
};
const DUEL_BASE = {
  tournament: { id: "t1", slug: "probe-cup", title: "Probe Cup" },
  match: { id: "m1", match_key: "HF-A", status: "in_progress", round_name: "Halbfinale A", slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }] },
  participants: [{ slot: 1, status: "filled", registration_id: "r1", display_name: "NeonFalke" }, { slot: 2, status: "filled", registration_id: "r2", display_name: "PixelPanther" }],
  matchday_label: "Halbfinale A", schedule_proposals: [], collection: "matches_v2", can_act: true, can_report_score: true, can_player_report_result: true,
  can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: true, can_forfeit: false,
  allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal", acting_registration_id: "r1",
};
const DUEL_REPORT = { ...DUEL_BASE, report_entry: DUEL_ENTRY, report_state: { status: "open", own_summary: null, proposal: null, proposal_summary: null } };
const DUEL_CONFIRM = {
  ...DUEL_BASE, report_entry: DUEL_ENTRY,
  report_state: { status: "confirm", proposal: [{ registration_id: "r1", rank: 1, score: 2 }, { registration_id: "r2", rank: 2, score: 1 }], proposal_summary: "NeonFalke gewinnt 2:1.",
    proposal_text: "PixelPanther meldet 2:1 für dich.", proposal_by: "PixelPanther", proposal_at: "2036-10-04T19:39:00+00:00", can_confirm: true },
};
const PLAYERS = ["NeonFalke", "PixelPanther", "Frostbiss", "Nachteule", "Kometa", "Blitzhase", "Sturmfuchs", "Glutkern"];
const REGS = PLAYERS.map((name, index) => ({ id: `r${index + 1}`, display_name: name, user: {} }));
const duel = (id, round, order, a, b, extra = {}) => ({
  id, stage_id: "s1", section: "WB", round, order, match_key: id.toUpperCase(), match_type: "duel", status: "completed",
  slots: [{ slot: 1, registration_id: a, status: a ? "filled" : "empty" }, { slot: 2, registration_id: b, status: b ? "filled" : "empty" }],
  results: a && b ? [{ registration_id: a, rank: 1, score: 2 }, { registration_id: b, rank: 2, score: 0 }] : [], scheduled_at: "2036-06-21T13:00:00+02:00", ...extra,
});
const BRACKET = {
  stages: [{ id: "s1", name: "Turnierbaum", number: 1 }],
  registrations: REGS,
  matches_v2: [
    duel("vf1", 1, 0, "r1", "r8"), duel("vf2", 1, 1, "r4", "r5"), duel("vf3", 1, 2, "r3", "r6"), duel("vf4", 1, 3, "r7", "r2", { results: [{ registration_id: "r2", rank: 1, score: 2 }, { registration_id: "r7", rank: 2, score: 1 }] }),
    duel("hf1", 2, 0, "r1", "r4", { status: "in_progress", results: [] }), duel("hf2", 2, 1, "r3", "r2", { status: "scheduled", results: [] }),
    duel("f", 3, 0, null, null, { status: "scheduled", results: [] }),
  ],
};
const BRACKET_CUP = { id: "t9", slug: "probe-cup", title: "Probe Cup", status: "live", format: "single_elim", my_registration: { id: "r1" } };

module.exports = {
  BLOCK, BRACKET, BRACKET_CUP, CAPTAIN, CONFIRM_PAGE, CUP, CUP_CHECKIN, DUEL_CONFIRM, DUEL_REPORT, ELIGIBILITY, GAMES, LEAD, MATCH_FIXED, MATCH_PROPOSALS,
  MATE, MATE2, MEMBERS, MINE, MINE_SUBMITTED, MY_REG, PLAYER, REPORT_PAGE, SEASON_VIEW, SPIELER, SQUAD, TEAM, TEAM_GAMES, checkinPage, readyPage, serve,
};
