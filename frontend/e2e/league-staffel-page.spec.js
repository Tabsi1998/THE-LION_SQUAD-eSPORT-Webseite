const { test, expect } = require("@playwright/test");

// Staffel-Seite der Liga-Verwaltung (#2262, Pakete A und B) im echten Browser, Server nachgestellt: Kopf mit Brotkrumen, Reiter Überblick
// und Teilnehmer, Co-Team zuteilen, Austritt, Rechte ohne Knöpfe; Spielplan, Spiele und Ergebnisse, Tabelle samt Gleichstand. Bei 390
// und 1440 px ohne seitliches Scrollen, Tippflächen ab 44 px. Mit E2E_SCREENS_DIR legt der Test die Bilder je Reiter ab. Nur erfundene Namen.
const path = require("node:path");

const LEAD = { id: "lead-1", username: "ligaleitung", display_name: "Ligaleitung", role: "user", areas: ["leagues"], mfa_enabled: true, auth_mfa_verified: true };
const ALL = ["applications", "manage", "matches", "results", "roster", "sanctions", "season"];
const STAFFEL = {
  id: "t1", slug: "probe-liga-season-1-liga-1-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A", status: "draft",
  format: "league", team_mode: "team", team_size: 4, min_participants: 2, max_participants: 8, best_of: 3, game_id: "g1",
  league_context: { league_id: "l1", season_id: "s1", division_id: "d1", staffel: "A" },
  league_links: { league_name: "Probe-Liga", season_name: "Season 1", division_label: "Liga 1", staffel: "A",
    season_admin_path: "/admin/leagues/seasons/s1", public_path: "/liga/probe-liga/season-1", staffel_admin_path: "/admin/leagues/staffeln/t1" },
  league_capabilities: ALL, can_edit_staffel: true, can_manage_participants: true, can_manage_structure: true, can_use_staff_tools: true,
};
const REGS = [
  { id: "r1", status: "approved", display_name: "Nebelwölfe · Rudel", team_id: "tm1", squad_id: "sq1" },
  { id: "r2", status: "approved", display_name: "Sturmfalken · Horst", team_id: "tm2", squad_id: "sq2", late_entry: { state: "done", from_week: 3 } },
];
const CANDIDATES = {
  min_squad_size: 4, seats_taken: 2, max_participants: 8, id_label: "Spiel-ID",
  teams: [{ id: "tm3", name: "Bergdohlen", tag: "BD", in_staffel: false, squads: [
    { id: "sq3", display_name: "Bergdohlen · Schwarm", member_count: 5, problems: [], players: [], captain: null, vice_captain: null },
  ] }],
};

async function mockServer(page, { staffel = {}, registrations = REGS, matches = [] } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  const calls = [];
  await page.route("**/api/**", json({}));
  for (const path of ["sponsors**", "notifications/me", "games", "partners", "events**"]) await page.route(`**/api/${path}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(LEAD));
  await page.route("**/api/admin/my-leagues**", json({ leagues: [{ id: "l1", capabilities: ALL }] }));
  await page.route("**/api/tournaments/t1/registrations", json(registrations));
  await page.route("**/api/tournaments/t1/matches-v2", json(matches));
  // Aufstellung je Co-Team: der Server verlangt in der Staffel „Spiele betreuen“ - ohne das Recht antwortet er mit 403.
  await page.route("**/api/team-day/t1/lineups", (route) => {
    calls.push({ url: route.request().url(), body: null });
    const allowed = (staffel.league_capabilities || ALL).includes("matches");
    return route.fulfill({ status: allowed ? 200 : 403, contentType: "application/json", body: JSON.stringify(allowed ? {} : { detail: "Nur für die Turnierleitung." }) });
  });
  await page.route("**/api/tournaments/t1/squad-candidates", json(CANDIDATES));
  await page.route("**/api/admin/leagues/seasons/s1/sanctions", json({ items: [
    { id: "x1", status: "active", kind_label: "Spielsperre", target_type: "squad", registration_id: "r1", squad_id: "sq1", tournament_id: "t1" },
  ] }));
  await page.route("**/api/admin/leagues/seasons/s1/roster", json({ squads: [] }));
  await page.route("**/api/tournaments/t1/squad-registrations", (route) => {
    calls.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, ids_missing: [] }) });
  });
  await page.route("**/api/tournaments/t1/registrations/r1/removal", (route) => {
    const body = route.request().postDataJSON();
    calls.push({ url: route.request().url(), body });
    const plan = { id: "plan-1", ops: [{ kind: "forfeit", text: "Woche 3: Sturmfalken gewinnen kampflos." }], summary: "1 Spiel betroffen." };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body.plan_id ? { ok: true } : { ok: true, plan }) });
  });
  await page.route(/\/api\/tournaments\/t1(\?.*)?$/, json({ ...STAFFEL, ...staffel }));
  return calls;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Alle sichtbaren Knöpfe und Links im Inhalt der Staffel sind mindestens 44 px hoch (Tippflächen). */
async function touchTargets(page, testId) {
  const small = await page.getByTestId(testId).evaluate((root) => [...root.querySelectorAll("button, a, select")]
    .filter((node) => node.offsetParent !== null)
    .map((node) => ({ text: (node.textContent || node.getAttribute("aria-label") || "").trim().slice(0, 40), height: Math.round(node.getBoundingClientRect().height) }))
    .filter((row) => row.height < 44));
  expect(small).toEqual([]);
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Staffel-Seite (${width} px): Kopf, Überblick und Teilnehmer`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/admin/leagues/staffeln/t1");
    await expect(page.getByTestId("staffel-title")).toHaveText("Liga 1 · Staffel A");
    await expect(page.getByTestId("staffel-crumb-season")).toHaveAttribute("href", "/admin/leagues/seasons/s1");
    await expect(page.getByTestId("staffel-tabs").getByRole("tab")).toHaveText(["Überblick", "Teilnehmer", "Spielplan", "Spiele und Ergebnisse", "Tabelle"]);
    await expect(page.getByTestId("tournament-flow-stepper")).toContainText("Co-Teams zuteilen");
    await expect(page.getByTestId("staffel-primary-action")).toContainText("Liga starten");
    await expect(page.getByTestId("staffel-numbers-teams")).toContainText("2 von 8");
    await expect(page.getByTestId("staffel-desk-link")).toHaveAttribute("href", "/admin/leagues/seasons/s1#leitstand");
    await noSideScroll(page);
    await touchTargets(page, "staffel-panel-ueberblick");

    await page.getByTestId("staffel-tab-teilnehmer").click();
    await expect(page).toHaveURL(/#teilnehmer$/);
    const list = page.getByTestId("staffel-reg-list");
    await expect(list.locator(width < 768 ? '[data-testid="staffel-reg-card-r1"]' : '[data-testid="staffel-reg-row-r1"]')).toBeVisible();
    await expect(list.locator('[data-testid="staffel-reg-late-r2"]:visible')).toHaveText("Nachgemeldet ab Woche 3");
    await expect(list.locator('[data-testid="staffel-reg-sanction-x1"]:visible')).toHaveAttribute("href", "/admin/leagues/seasons/s1#strafen");
    await expect(page.getByTestId("staffel-entry-link")).toHaveAttribute("href", "/admin/leagues/seasons/s1#anmeldungen");
    await noSideScroll(page);
    await touchTargets(page, "staffel-panel-teilnehmer");
  });

  test(`Staffel-Seite (${width} px): Co-Team zuteilen`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await mockServer(page);
    await page.goto("/admin/leagues/staffeln/t1#zuteilen");
    await page.getByTestId("squad-assign-open").click();
    const dialog = page.getByTestId("squad-assign-dialog");
    await expect(dialog).toContainText("Co-Team zuteilen");
    await dialog.getByTestId("squad-assign-team-tm3").click();
    await dialog.getByTestId("squad-assign-squad-sq3").check();
    await noSideScroll(page);
    await dialog.getByTestId("squad-assign-confirm").click();
    await expect.poll(() => calls.find((row) => row.url.endsWith("/squad-registrations"))?.body).toEqual({ team_id: "tm3", squad_id: "sq3" });
  });

  test(`Staffel-Seite (${width} px): Austritt im laufenden Betrieb`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await mockServer(page, { staffel: { status: "live" }, matches: [{ id: "m1", status: "scheduled", slots: [{ registration_id: "r1" }, { registration_id: "r2" }] }] });
    await page.goto("/admin/leagues/staffeln/t1#austritt");
    await expect(page.locator('[data-testid="staffel-reg-remove-r1"]')).toHaveCount(0);
    await page.locator('[data-testid="admin-reg-withdraw-r1"]:visible').click();
    const dialog = page.getByTestId("admin-reg-removal-dialog");
    await expect(dialog).toContainText("Austritt von Nebelwölfe · Rudel eintragen?");
    await expect(dialog).toContainText("Sturmfalken gewinnen kampflos");
    await dialog.getByTestId("admin-reg-removal-confirm").click();
    await expect.poll(() => calls.filter((row) => row.url.endsWith("/removal")).map((row) => row.body.plan_id || null)).toEqual([null, "plan-1"]);
  });

  test(`Staffel-Seite (${width} px): ohne Rechte keine Knöpfe`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page, { staffel: { status: "live", league_capabilities: ["season"], can_edit_staffel: false, can_manage_participants: false } });
    await page.goto("/admin/leagues/staffeln/t1");
    // Der Stand steht einmal im Abzeichen oben, die Kachel sagt nur, wer ihn ändert.
    await expect(page.getByTestId("staffel-stand")).toContainText("Spielbetrieb");
    await expect(page.getByTestId("staffel-status-readonly")).not.toContainText("Spielbetrieb");
    await expect(page.getByTestId("staffel-primary-action")).toHaveCount(0);
    await expect(page.getByTestId("staffel-status-select")).toHaveCount(0);
    await page.getByTestId("staffel-tab-teilnehmer").click();
    await expect(page.getByTestId("staffel-teams-count")).toBeVisible();
    await expect(page.getByTestId("squad-assign-open")).toHaveCount(0);
    await expect(page.locator('[data-testid^="admin-reg-withdraw-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="admin-reg-disqualify-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="staffel-reg-remove-"]')).toHaveCount(0);
    await noSideScroll(page);
  });
}

test("ohne „Spiele betreuen“ fragt die Seite keine Aufstellung ab - keine 403 in der Konsole", async ({ page }) => {
  const problems = [];
  // Nur 403 zählt hier - der nachgestellte Server beantwortet auch den Live-Strom mit JSON, das meldet der Browser gesondert.
  page.on("console", (message) => { if (message.type() === "error" && message.text().includes("403")) problems.push(message.text()); });
  page.on("response", (response) => { if (response.status() === 403) problems.push(`403 ${response.url()}`); });
  const calls = await mockServer(page, { staffel: { league_capabilities: ["applications", "manage", "season"] } });
  await page.goto("/admin/leagues/staffeln/t1#teilnehmer");
  await expect(page.getByTestId("staffel-teams-count")).toBeVisible();
  await page.waitForTimeout(500);
  expect(calls.filter((row) => row.url.includes("/team-day/"))).toEqual([]);
  expect(problems).toEqual([]);
});

test("Ladefehler der Co-Teams: Hinweis mit „Nochmal versuchen“ statt falscher Zahlen", async ({ page }) => {
  await mockServer(page);
  let fail = true;
  await page.route("**/api/tournaments/t1/registrations", (route) => (fail
    ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Serverfehler" }) })
    : route.fulfill({ contentType: "application/json", body: JSON.stringify(REGS) })));
  await page.goto("/admin/leagues/staffeln/t1");
  await expect(page.getByTestId("staffel-load-error")).toContainText("ließen sich nicht laden");
  await expect(page.getByTestId("staffel-numbers-teams")).toHaveCount(0);
  fail = false;
  await page.getByTestId("staffel-retry").click();
  await expect(page.getByTestId("staffel-numbers-teams")).toContainText("2 von 8");
  await expect(page.getByTestId("staffel-load-error")).toHaveCount(0);
});

// ---------------------------------------------------------------- Paket B: Spielplan, Spiele und Ergebnisse, Tabelle

// Härtefall (break-ui): 16 Co-Teams mit langen Namen, 15 Spielwochen je 8 Partien, offene Verfahren, Kampflos, beide nicht erschienen,
// Gleichstand. Woche 7 läuft gerade.
const LONG = ["Wolkenkratzer-Sturmfalken Ostalpen · Zweite Mannschaft Reserve", "Nebelwölfe · Rudel", "Bergdohlen · Schwarm", "Eisbären Nord · Eisbären B",
  "Wüstenfüchse · Füchse A", "Steinböcke · Steinböcke 2", "Nordlicht · Nordlicht A", "Gipfelstürmer Hochkönig Allstars · Gipfel", "Sturmfalken · Horst",
  "Murmeltiere · Bau", "Adlerhorst · Adler 1", "Waldkäuze · Käuze", "Talwind · Böe", "Felsenspringer · Gämsen", "Donnergroll · Blitz", "Silberpfeile · Pfeil B"];
const WEEKS = 15;
const CURRENT = 7;

function bigWorld({ teams = 16 } = {}) {
  const regs = LONG.slice(0, teams).map((name, index) => ({ id: `r${index + 1}`, status: "approved", display_name: name, team_id: `tm${index + 1}`, squad_id: `sq${index + 1}` }));
  const ids = regs.map((row) => row.id);
  const circle = ids.length % 2 ? [...ids, null] : [...ids];
  const matches = [];
  const matchdays = [];
  const rounds = circle.length > 1 ? Math.min(WEEKS, circle.length - 1) : 0;
  for (let week = 1; week <= rounds; week += 1) {
    const start = new Date(Date.UTC(2026, 8, 7 + (week - 1) * 7));
    const end = new Date(start.getTime() + 7 * 86400000 - 60000);
    const entries = [];
    // Kreisverfahren: der erste bleibt, die übrigen drehen sich je Woche weiter.
    const order = [circle[0], ...circle.slice(1).map((_, index, rest) => rest[(index + week - 1) % rest.length])];
    for (let pair = 0; pair < order.length / 2; pair += 1) {
      const home = order[pair];
      const away = order[order.length - 1 - pair];
      if (!home || !away) continue;
      const id = `m${week}-${pair + 1}`;
      const at = new Date(start.getTime() + 5 * 86400000 + 19 * 3600000).toISOString();
      const match = { id, tournament_id: "t1", match_key: `W${week}-${pair + 1}`, matchday_number: week, status: "scheduled", scheduled_at: at,
        slots: [{ slot: 1, status: "filled", registration_id: home }, { slot: 2, status: "filled", registration_id: away }],
        league_marks: { checkin: "none", checked_in: 0, veto: null, incidents: 0, procedures: 0 } };
      if (week < CURRENT) {
        Object.assign(match, { status: "completed", results: [{ registration_id: home, score: 2, rank: 1 }, { registration_id: away, score: pair % 2, rank: 2 }] });
        if (week === 2 && pair === 1) Object.assign(match, { status: "forfeit", results: [{ registration_id: home, score: 0, rank: 2, forfeit: true }, { registration_id: away, score: 2, rank: 1 }] });
        if (week === 3 && pair === 2) Object.assign(match, { status: "forfeit", double_forfeit: true, results: [] });
        if (week === 5 && pair === 0) match.league_marks = { checkin: "finished", checked_in: 2, veto: "done", incidents: 0, procedures: 1 };
      } else if (week === CURRENT) {
        const marks = [
          { status: "in_progress", started_at: at, league_marks: { checkin: "running", checked_in: 2, veto: "running", incidents: 2, procedures: 0 } },
          { league_marks: { checkin: "open", checked_in: 1, veto: null, incidents: 0, procedures: 0 } },
          { league_marks: { checkin: "closed", checked_in: 1, veto: null, incidents: 0, procedures: 1 } },
          { league_marks: { checkin: "veto", checked_in: 2, veto: null, incidents: 0, procedures: 0 } },
          { status: "disputed", league_marks: { checkin: "finished", checked_in: 2, veto: "done", incidents: 1, procedures: 2 } },
        ][pair];
        if (marks) Object.assign(match, marks);
      }
      matches.push(match);
      entries.push({ match_id: id, scheduled_at: at, schedule_source: ["accepted", "home", "default", "manual"][pair % 4] });
    }
    matchdays.push({ number: week, starts_at: start.toISOString(), ends_at: end.toISOString(), matches: entries });
  }
  const standings = regs.map((row, index) => ({ registration_id: row.id, display_name: row.display_name, rank: index + 1, played: 6, won: 6 - Math.min(index, 6),
    drawn: 0, lost: Math.min(index, 6), score_for: 12 - index, score_against: index, score_diff: 12 - 2 * index, points: 18 - 3 * Math.min(index, 6),
    form: ["W", "L", "W", "W", "L"], previous_rank: null, forfeit_won: index === 2 ? 1 : 0, forfeit_lost: index === 9 ? 1 : 0, deducted_points: 0, exit: null, tiebreak: null, lead_decision: null,
    zone: index < 2 ? "promotion" : index >= regs.length - 2 && regs.length > 4 ? "relegation" : null }));
  // Gleichstand auf Platz 5: zwei Teams nach allen Kriterien gleich.
  if (standings.length > 6) standings[5] = { ...standings[5], rank: 5, points: standings[4].points, score_diff: standings[4].score_diff, score_for: standings[4].score_for };
  const table = {
    can_decide: true, superadmin: false, rules: { tiebreakers: ["head_to_head", "score_diff", "score_for", "lead_decision"] }, standings,
    methods: { playoff: "Entscheidungsspiel", lot: "Los", lead: "Entscheid der Leitung" },
    ties: standings.length > 6 ? [{ rank: 5, registration_ids: [standings[4].registration_id, standings[5].registration_id], names: [standings[4].display_name, standings[5].display_name], points: standings[4].points, own_team: false }] : [],
    decisions: [],
  };
  return { regs, matches, matchdays: { applies: true, current: matchdays.length >= CURRENT ? CURRENT : null, matchdays }, table };
}

const entryFor = (match, names) => ({
  id: match.id, kind: "duel", best_of: 3, ranking_mode: "higher_score", allows_draw: false, has_result: false, result: [], label: `Spielwoche ${match.matchday_number}`,
  participants: match.slots.map((slot) => ({ registration_id: slot.registration_id, name: names.get(slot.registration_id) })),
});

async function mockLeague(page, world, { staffel = {} } = {}) {
  // Ohne Hochzählen - die Bilder zeigen den Endstand.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const calls = await mockServer(page, { staffel: { status: "live", can_plan_matches: true, can_manage_all_results: true, ...staffel }, registrations: world.regs, matches: world.matches });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  const names = new Map(world.regs.map((row) => [row.id, row.display_name]));
  await page.route("**/api/tournaments/t1/matchdays", json(world.matchdays));
  await page.route("**/api/tournaments/t1/stages", json([{ id: "st1", stage_type: "league", tournament_id: "t1" }]));
  await page.route("**/api/admin/leagues/staffeln/t1/table", json(world.table));
  await page.route("**/api/admin/leagues/staffeln/t1/table-decision", (route) => {
    calls.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "d1" }) });
  });
  await page.route(/\/api\/matches\/[^/]+$/, (route) => {
    calls.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.route(/\/api\/matches\/[^/]+\/page$/, (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[3];
    const match = world.matches.find((row) => row.id === id);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ match, result_entry: entryFor(match, names) }) });
  });
  return calls;
}

async function shot(page, name) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(dir, `${name}.png`), animations: "disabled", style: ".tls-bottom-nav { display: none !important; }" });
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Staffel-Seite (${width} px): Spielplan mit 15 Spielwochen, Termin setzen`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const world = bigWorld();
    const calls = await mockLeague(page, world);
    await page.goto("/admin/leagues/staffeln/t1#termine");
    const weeks = page.getByTestId("mp-league");
    await expect(weeks.locator('[data-testid^="mp-week-"]')).toHaveCount(15);
    await expect(page.getByTestId(`mp-week-${CURRENT}`)).toContainText("läuft");
    await expect(page.getByTestId("mp-week-8")).toContainText("von der Liga-Leitung");
    // Ganz gespielte Wochen klappen zu, die laufende und die kommenden bleiben offen.
    await expect(page.getByTestId("mp-week-1")).toHaveAttribute("data-played", "true");
    await expect(page.getByTestId("mp-week-1").locator("details")).not.toHaveAttribute("open", "");
    await expect(page.getByTestId(`mp-week-${CURRENT}`).locator("details")).toHaveCount(0);
    await expect(page.getByTestId("staffel-csv-matchplan")).toHaveAttribute("href", /\/api\/tournaments\/t1\/match-plan\.csv$/);
    await expect(page.getByTestId("staffel-pdf-matches")).toHaveAttribute("href", /\/api\/exports\/tournaments\/t1\/matches\.pdf$/);
    await noSideScroll(page);
    await touchTargets(page, "staffel-panel-spielplan");
    await shot(page, `spielplan-${width}`);
    await page.getByTestId("mp-week-8").getByRole("button", { name: "W8-1 ändern" }).click();
    await page.getByTestId("mp-editor").getByRole("button", { name: "Speichern" }).click();
    await expect.poll(() => calls.some((row) => row.url.endsWith("/api/matches/m8-1"))).toBe(true);
    await noSideScroll(page);
  });

  test(`Staffel-Seite (${width} px): Spiele und Ergebnisse mit Chips, Ergebnis eintragen`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const world = bigWorld();
    await mockLeague(page, world);
    await page.goto("/admin/leagues/staffeln/t1#ergebnisse");
    await expect(page.getByTestId("staffel-games-count")).toContainText("gespielt");
    await expect(page.getByTestId("staffel-week-1")).not.toHaveAttribute("open", "");
    await expect(page.getByTestId(`staffel-week-${CURRENT}`)).toHaveAttribute("open", "");
    await expect(page.getByTestId(`staffel-game-chips-m${CURRENT}-1`)).toContainText("Veto läuft");
    await expect(page.getByTestId(`staffel-game-chips-m${CURRENT}-1`)).toContainText("2 Vorfälle offen");
    await expect(page.getByTestId(`staffel-game-chips-m${CURRENT}-3`)).toContainText("Check-in verpasst · 1 von 2");
    await expect(page.getByTestId(`staffel-game-state-m${CURRENT}-5`)).toContainText("In Klärung");
    // Woche 5 ist gespielt, ein Verfahren ist aber offen - sie bleibt aufgeklappt.
    await expect(page.getByTestId("staffel-week-5")).toHaveAttribute("open", "");
    await expect(page.getByTestId("staffel-week-warn-5")).toHaveText("1 Verfahren offen");
    await page.getByTestId("staffel-week-2").locator("summary").click();
    await expect(page.getByTestId("staffel-game-state-m2-2")).toContainText("Kampflos gewertet");
    await page.getByTestId("staffel-week-3").locator("summary").click();
    await expect(page.getByTestId("staffel-game-state-m3-3")).toContainText("Beide nicht erschienen");
    await page.getByTestId("staffel-week-2").locator("summary").click();
    await page.getByTestId("staffel-week-3").locator("summary").click();
    await noSideScroll(page);
    await touchTargets(page, "staffel-panel-spiele");
    await shot(page, `spiele-${width}`);
    await page.getByTestId(`staffel-game-result-m${CURRENT}-2`).click();
    await expect(page.getByTestId("result-window")).toBeVisible();
    await noSideScroll(page);
    if (width === 390) await shot(page, "ergebnis-fenster-390");
  });

  test(`Staffel-Seite (${width} px): Tabelle mit Zonen, Gleichstand entscheiden, PDF`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const world = bigWorld();
    const calls = await mockLeague(page, world);
    await page.goto("/admin/leagues/staffeln/t1#tabelle");
    const panel = page.getByTestId("staffel-table-t1");
    await expect(panel.locator('[data-testid^="standing-row-"]')).toHaveCount(16);
    await expect(panel.getByTestId("staffel-table-zones")).toBeVisible();
    await expect(panel.getByTestId("staffel-pdf-standings")).toHaveAttribute("href", /\/api\/exports\/tournaments\/t1\/standings\.pdf$/);
    await expect(panel.getByTestId("season-tie-t1-5")).toContainText("Platz 5");
    // Name und Pkt ohne Wischen (am Handy ohne Spalte „Form“), der lange Name ganz.
    const row = panel.getByTestId("standing-row-r1");
    const points = await row.locator('[data-col="points"]').boundingBox();
    expect(points.x + points.width).toBeLessThanOrEqual(width);
    await expect(row.locator(".tls-standing-name")).toHaveAttribute("title", LONG[0]);
    if (width < 640) await expect(row.locator('[data-col="form"]')).toBeHidden();
    else await expect(row.locator('[data-col="form"]')).toBeVisible();
    await noSideScroll(page);
    await touchTargets(page, "staffel-panel-tabelle");
    await shot(page, `tabelle-${width}`);
    await panel.getByTestId("season-tie-decide-5").click();
    const sheet = page.getByTestId("table-decision-sheet");
    await sheet.getByTestId("table-decision-reason").fill("Losentscheid vor beiden Captains");
    await sheet.getByTestId("table-decision-save").click();
    await expect.poll(() => calls.find((row) => row.url.endsWith("/table-decision"))?.body?.reason).toBe("Losentscheid vor beiden Captains");
  });

  test(`Staffel-Seite (${width} px): 0 und 1 Co-Team - alle Reiter ohne seitliches Scrollen`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const teams of [0, 1]) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await mockLeague(page, bigWorld({ teams }), { staffel: { status: "draft" } });
      for (const tab of ["spielplan", "spiele", "tabelle"]) {
        await page.goto(`/admin/leagues/staffeln/t1?probe=${teams}#${tab}`);
        await expect(page.getByTestId(`staffel-panel-${tab}`)).toBeVisible();
        await noSideScroll(page);
      }
      if (!teams) await expect(page.getByTestId("staffel-table-t1")).toContainText("Noch keine Ergebnisse");
      else await expect(page.getByTestId("staffel-table-t1").locator('[data-testid^="standing-row-"]')).toHaveCount(1);
    }
  });
}

test("ohne „Spiele betreuen“ und „Ergebnisse korrigieren“: kein „ändern“, kein Ergebnis, kein Entscheid - keine 403", async ({ page }) => {
  const problems = [];
  page.on("response", (response) => { if (response.status() === 403) problems.push(`403 ${response.url()}`); });
  await mockLeague(page, bigWorld(), { staffel: { league_capabilities: ["season"], can_plan_matches: false, can_manage_all_results: false } });
  await page.goto("/admin/leagues/staffeln/t1#spielplan");
  await expect(page.getByTestId("mp-week-8")).toBeVisible();
  await expect(page.getByRole("button", { name: /ändern$/ })).toHaveCount(0);
  await page.getByTestId("staffel-tab-spiele").click();
  await expect(page.getByTestId("staffel-games-count")).toBeVisible();
  await expect(page.locator('[data-testid^="staffel-game-result-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="match-double-no-show"]')).toHaveCount(0);
  await page.getByTestId("staffel-tab-tabelle").click();
  await expect(page.getByTestId("season-tie-t1-5")).toBeVisible();
  await expect(page.getByTestId("season-tie-decide-5")).toHaveCount(0);
  expect(problems).toEqual([]);
});

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Staffel-Seite (${width} px): Meister-Gleichstand nur mit Art der Entscheidung`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const world = bigWorld();
    const [first, second] = world.table.standings;
    world.table.standings[1] = { ...second, rank: 1, points: first.points };
    world.table.ties = [{ rank: 1, registration_ids: [first.registration_id, second.registration_id], names: [first.display_name, second.display_name],
      points: first.points, own_team: false, kind: "champion", method_required: true }];
    const calls = await mockLeague(page, world);
    await page.goto("/admin/leagues/staffeln/t1#gleichstand");
    const panel = page.getByTestId("staffel-table-t1");
    await expect(panel.getByTestId("season-tie-kind-t1-1")).toHaveText("Meisterplatz");
    await panel.getByTestId("season-tie-decide-1").click();
    const sheet = page.getByTestId("table-decision-sheet");
    await sheet.getByTestId("table-decision-reason").fill("Entscheidungsspiel 2:1 gewonnen");
    await sheet.getByTestId("table-decision-save").click();
    // Ohne Art geht nichts hinaus - das Pflichtfeld hält das Absenden auf.
    await expect(sheet).toBeVisible();
    expect(calls.filter((row) => row.url.endsWith("/table-decision"))).toEqual([]);
    await sheet.getByTestId("table-decision-method").selectOption("playoff");
    await noSideScroll(page);
    await sheet.getByTestId("table-decision-save").click();
    await expect.poll(() => calls.find((row) => row.url.endsWith("/table-decision"))?.body).toEqual({
      registration_ids: [first.registration_id, second.registration_id], reason: "Entscheidungsspiel 2:1 gewonnen", method: "playoff" });
  });
}
