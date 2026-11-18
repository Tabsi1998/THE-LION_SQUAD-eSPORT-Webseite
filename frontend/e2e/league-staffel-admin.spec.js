const { test, expect } = require("@playwright/test");
const path = require("node:path");

// Alte Adressen einer Staffel (#2262, Paket D, Nr. 192) im echten Browser, Server nachgestellt: `/admin/tournaments/<id>` leitet eine
// Staffel auf ihre Staffel-Seite der Liga-Verwaltung - alte Lesezeichen, Glocken-Einträge und Mail-Links gehen weiter, `?tab=` landet
// am passenden Reiter. Auch die reine Liga-Leitung (Bereich Ligen, ohne Turniere) kommt so an, ohne 403 in der Konsole. Ein
// gewöhnliches Turnier bleibt in der Turnierverwaltung. Bei 390 und 1440 px ohne seitliches Scrollen. Mit E2E_SCREENS_DIR legt der
// Test das Bild der Weiterleitung ab. Nur erfundene Namen.

const LEAGUE_LEAD = { id: "lead-1", username: "ligaleitung", display_name: "Ligaleitung", role: "user", areas: ["leagues"], mfa_enabled: true, auth_mfa_verified: true };
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const ALL = ["applications", "manage", "matches", "results", "roster", "sanctions", "season"];
const STAFFEL = {
  id: "t1", slug: "probe-liga-season-1-liga-1-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A", status: "draft",
  format: "league", team_mode: "team", team_size: 4, min_participants: 2, max_participants: 8, best_of: 3, game_id: "g1",
  start_date: "2026-11-09T23:00:00+00:00", matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00",
  match_schedule_response_hours: 72, result_confirm_hours_league: 48, rules: "## Regeln\nFair spielen.",
  league_context: { league_id: "l1", season_id: "s1", division_id: "d1", staffel: "A" },
  league_links: { league_name: "Probe-Liga", season_name: "Season 1", division_label: "Liga 1", staffel: "A", league_id: "l1",
    season_admin_path: "/admin/leagues/seasons/s1", public_path: "/liga/probe-liga/season-1", staffel_admin_path: "/admin/leagues/staffeln/t1" },
  league_capabilities: ALL, can_edit_staffel: true, can_manage_participants: true, can_manage_structure: true, can_use_staff_tools: true,
};
const CUP = {
  id: "t2", slug: "winter-cup", title: "Winter-Cup", status: "registration_open", format: "single_elim", team_mode: "solo",
  can_manage_structure: true, can_manage_participants: true, can_use_staff_tools: true,
};
const REGS = [
  { id: "r1", status: "approved", display_name: "Nebelwölfe · Rudel", team_id: "tm1", squad_id: "sq1" },
  { id: "r2", status: "approved", display_name: "Sturmfalken · Horst", team_id: "tm2", squad_id: "sq2" },
];

async function mockServer(page, user) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  const requested = [];
  page.on("request", (request) => { if (request.url().includes("/api/")) requested.push(new URL(request.url()).pathname); });
  await page.route("**/api/**", json({}));
  for (const route of ["sponsors**", "notifications/me", "games", "partners", "events**", "stations**", "admin/choices/teams**",
    "tournaments/t2/staff", "tournaments/t2/stages", "tournaments/t2/matches-v2", "tournaments/t2/registrations", "access-links**"]) {
    await page.route(`**/api/${route}`, json([]));
  }
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(user));
  await page.route("**/api/admin/my-leagues**", json({ leagues: [{ id: "l1", capabilities: ALL }] }));
  await page.route("**/api/tournaments/t1/registrations", json(REGS));
  await page.route("**/api/tournaments/t1/matches-v2", json([]));
  await page.route("**/api/team-day/t1/lineups", json({}));
  await page.route("**/api/admin/leagues/seasons/s1/sanctions", json({ items: [] }));
  await page.route("**/api/tournaments/t2/bracket", json({ rounds: [], matches_v2: [], stages: [], registrations: [] }));
  await page.route(/\/api\/tournaments\/t1(\?.*)?$/, json(STAFFEL));
  await page.route(/\/api\/tournaments\/t2(\?.*)?$/, json(CUP));
  return requested;
}

function watchConsole(page) {
  const problems = [];
  // Der nachgestellte Ereignisstrom antwortet mit JSON - diese eine Meldung kommt vom Mock, nicht von der Seite.
  page.on("console", (message) => { if (message.type() === "error" && !message.text().startsWith("EventSource")) problems.push(message.text()); });
  page.on("response", (response) => { if (response.status() === 403) problems.push(`403 ${response.url()}`); });
  return problems;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(page, name) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, name), fullPage: false });
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Alte Adresse einer Staffel (${width} px): die reine Liga-Leitung landet auf der Staffel-Seite, ohne 403`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const problems = watchConsole(page);
    const requested = await mockServer(page, LEAGUE_LEAD);
    await page.goto("/admin/tournaments/t1?tab=participants");
    await expect(page).toHaveURL(/\/admin\/leagues\/staffeln\/t1#teilnehmer$/);
    await expect(page.getByTestId("staffel-title")).toContainText("Liga 1 · Staffel A");
    await expect(page.getByTestId("staffel-tab-teilnehmer")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Nebelwölfe · Rudel").filter({ visible: true }).first()).toBeVisible();
    // Von der alten Ansicht wird nichts geladen - kein Helfer-, Team- oder Stationsabruf der Turnierverwaltung.
    expect(requested.filter((url) => /\/api\/(tournaments\/t1\/(staff|stages|bracket)|stations|admin\/choices\/teams)/.test(url))).toEqual([]);
    await noSideScroll(page);
    await shot(page, `weiterleitung-${width}.png`);
    expect(problems).toEqual([]);
  });

  test(`Alte Reiter (${width} px): ?tab=matchplan, ?tab=maps und ?tab=edit landen an ihrer Stelle`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page, ADMIN);
    await page.goto("/admin/tournaments/t1?tab=matchplan");
    await expect(page).toHaveURL(/\/admin\/leagues\/staffeln\/t1#spielplan$/);
    await expect(page.getByTestId("staffel-tab-spielplan")).toHaveAttribute("aria-selected", "true");
    await page.goto("/admin/tournaments/t1?tab=maps");
    await expect(page).toHaveURL(/\/admin\/leagues\/staffeln\/t1#vorgaben$/);
    await expect(page.getByTestId("tr-edit-season-values")).toContainText("Aus der Season");
    await expect(page.getByTestId("tr-edit-season-response")).toHaveText("72 Std.");
    await page.goto("/admin/tournaments/t1?tab=edit");
    await expect(page).toHaveURL(/\/admin\/leagues\/staffeln\/t1#einstellungen$/);
    await expect(page.getByTestId("staffel-tab-einstellungen")).toHaveAttribute("aria-selected", "true");
    await noSideScroll(page);
  });

  test(`Ein gewöhnliches Turnier (${width} px) bleibt in der Turnierverwaltung`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page, ADMIN);
    await page.goto("/admin/tournaments/t2");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Winter-Cup");
    await expect(page).toHaveURL(/\/admin\/tournaments\/t2$/);
    await expect(page.getByTestId("staffel-header")).toHaveCount(0);
    await noSideScroll(page);
  });
}
