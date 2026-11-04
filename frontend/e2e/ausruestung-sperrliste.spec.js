const { test, expect } = require("@playwright/test");

// Ausrüstung und Sperrliste (#2218) im echten Browser, Server nachgestellt: Bibliothek eines Spiels mit vielen Einträgen und langen
// Namen, Sperrliste der Season (je Modus, Aufsätze an einer Waffe, neue Version), öffentliche Ligaseite. Bei 390 und 1440 px ohne
// seitliches Scrollen. Nur erfundene Namen.

const CONSENT = () => window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
  essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
  saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
}));
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const LONG = "mit einem wirklich sehr langen Namen, der nirgends hineinpasst";
const MODES = [{ mode: "stellung", label: "Stellung", status: "active" }, { mode: "suchen", label: "Suchen & Zerstören", status: "active" }];
const GAME = { id: "g1", name: "Probe Shooter", slug: "probe-shooter", kind: "standalone", match_modes: MODES, player_id_fields: [] };
const CATEGORIES = [
  { key: "waffen", label: "Waffen", role: "weapon", count: 24 },
  { key: "aufsaetze", label: "Aufsätze", role: "attachment", count: 30 },
  { key: "perks", label: "Perks und Ausrüstung mit langem Kategorienamen", role: "item", count: 12 },
];
const WEAPONS = Array.from({ length: 24 }, (_, index) => ({
  id: `w${index}`, category: "waffen", name: index === 3 ? `Blitz ${LONG}` : `Waffe ${index + 1}`, image_url: null,
  status: index === 5 ? "inactive" : "active", in_lists: index < 2 ? 1 : 0, weapon_ids: [],
}));
const ATTACHMENTS = Array.from({ length: 30 }, (_, index) => ({
  id: `a${index}`, category: "aufsaetze", name: index === 0 ? `Rotpunkt ${LONG}` : `Aufsatz ${index + 1}`, image_url: null,
  // Ohne Waffe passt ein Aufsatz zu keiner (Obmann, 03.11.) - der letzte steht dafür im Hinweis.
  status: "active", in_lists: 0, weapon_ids: index === 29 ? [] : [...new Set([`w${index % 4}`, "w1"])],
}));
const PERKS = Array.from({ length: 12 }, (_, index) => ({
  id: `p${index}`, category: "perks", name: `Perk ${index + 1}`, image_url: null, status: index === 11 ? "archived" : "active", in_lists: 0, weapon_ids: [],
}));
const ITEMS = [...WEAPONS, ...ATTACHMENTS, ...PERKS];
const LIBRARY = { game: { id: "g1", name: "Probe Shooter", slug: "probe-shooter", modes: MODES }, categories: CATEGORIES, items: ITEMS, limit: 1000,
  categories_limit: 20, suggested_categories: [], attachments_without_weapon: [{ id: "a29", name: "Aufsatz 30" }] };

const LIST = {
  id: "v1", version: 1, saved_at: "2026-11-01T10:00:00+00:00", stale: false, outdated_item_ids: [], origin: "league_season",
  entries: [
    { kind: "item", item_id: "w3", name: `Blitz ${LONG}`, category: "waffen", category_label: "Waffen", role: "weapon", image_url: null, modes: [], mode_labels: [], attachments: [] },
    { kind: "item", item_id: "p0", name: "Perk 1", category: "perks", category_label: CATEGORIES[2].label, role: "item", image_url: null, modes: ["suchen"], mode_labels: ["Suchen & Zerstören"], attachments: [] },
    { kind: "attachments", item_id: "w1", name: "Waffe 2", category: "waffen", category_label: "Waffen", role: "weapon", image_url: null, modes: [], mode_labels: [],
      attachments: [{ item_id: "a0", name: `Rotpunkt ${LONG}`, image_url: null }, { item_id: "a3", name: "Aufsatz 4", image_url: null }] },
  ],
};
const BANS = {
  capabilities: ["season"], game: LIBRARY.game, categories: CATEGORIES,
  library: ITEMS.filter((item) => item.status !== "archived").map(({ id, category, name, image_url, weapon_ids, status }) => ({ id, category, name, image_url, weapon_ids, status })),
  list: LIST, versions: [{ id: "v1", version: 1, entries: 3, cleared: false, saved_at: "2026-11-01T10:00:00+00:00" }],
  rules: { uses_block: true, outdated: true, version: 2, admin_url: "/admin/leagues/rules/league_season/s1" }, staffeln: 2,
};
const SEASON = {
  id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10,
  matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3,
  team_size: 4, min_squad_size: 3, game_mode_order: [], scoring_rules: { match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: [] },
  result_confirm_hours: 48, lineup_amend_hours: 48, rules_text: "", visibility: "members", status: "active", blocked_periods: [],
};
const SEASON_PAGE = {
  capabilities: ["manage", "season", "rules"], league: { id: "l1", name: "Probe-Liga", slug: "probe-liga" }, season: SEASON, game: LIBRARY.game,
  calendar: { weeks: [], blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 8, rounds_needed: 7, end_date: "2027-01-18T22:59:59+00:00" },
  library: [], map_pool: null, divisions: [],
};
const PUBLIC_SEASON = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" } },
  season: { id: "s1", name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", end_date: "2027-01-18T22:59:59+00:00", matchday_days: 7,
    default_match_weekday: 6, default_match_time: "20:00", best_of: 3, team_size: 4, match_points: { win: 3, draw: 1, loss: 0 }, blocked_periods: [] },
  look: {}, prizes: [], map_pool: null, divisions: [], rules: null, application: null, loadout_bans: LIST,
  // Erlaubte Ausrüstung (#2287, Nr. 99), wie der Server sie aus Bibliothek und Liste rechnet - hier gekürzt.
  allowed_equipment: { list: true, layout: 3, categories: [
    { label: "Waffen", sections: [{ label: null, state: "some", not_in: [], banned: [], entries: [
      { name: "Waffe 1", image_url: null, not_in: [], not_at: [] }, { name: "Waffe 2", image_url: null, not_in: [], not_at: [] }] }] },
    { label: CATEGORIES[1].label, sections: [{ label: null, state: "some", not_in: [], banned: [], entries: [
      { name: `Rotpunkt ${LONG}`, image_url: null, not_in: [], not_at: [{ name: "Waffe 2", modes: [] }] },
      { name: "Aufsatz 5", image_url: null, not_in: ["Suchen & Zerstören"], not_at: [] }] }] },
  ] },
};

async function mock(page) {
  await page.addInitScript(CONSENT);
  const calls = { put: [], post: [], patch: [] };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.startsWith("/changes")) return route.abort();
    if (path === "/auth/me") return json(ADMIN);
    const method = request.method();
    if (method !== "GET") calls[method.toLowerCase()]?.push([path, request.postDataJSON?.() ?? null]);
    if (path === "/games/g1/equipment" && method === "GET") return json(LIBRARY);
    // Spielseite (#2249): das Spiel selbst, die Liste der Spiele und die Verwendung.
    if (path === "/games/g1" && method === "GET") return json(GAME);
    if (path === "/games" && method === "GET") return json([GAME]);
    if (path === "/games/g1/usage") return json({ total: 0, text: "", counts: {}, modes: {} });
    if (path === "/admin/leagues/seasons/s1") return json(SEASON_PAGE);
    if (path === "/admin/leagues/seasons/s1/loadout-bans" && method === "PUT") return json({ ...LIST, version: 2, staffeln_to_sync: 2 });
    if (path === "/admin/leagues/seasons/s1/loadout-bans") return json(BANS);
    if (path === "/leagues/probe-liga/season-1") return json(PUBLIC_SEASON);
    if (method !== "GET") return json({ ok: true });
    const objects = ["/settings/public", "/home/about", "/chats/unread", "/seasonal/active", "/friends"];
    return json(objects.includes(path) ? {} : []);
  });
  return calls;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test.describe(`Ausrüstung (${width} px)`, () => {
    test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

    test("Bibliothek: viele Einträge, lange Namen, neuer Aufsatz mit Waffe", async ({ page }) => {
      await page.setViewportSize({ width, height });
      const calls = await mock(page);
      // Die alte Adresse führt auf den Reiter „Ausrüstung“ der Spielseite.
      await page.goto("/admin/games/g1/equipment");
      await expect(page).toHaveURL(/\/admin\/games\/g1#ausruestung$/);
      await expect(page.getByTestId("game-page-title")).toHaveText("Probe Shooter");
      await expect(page.getByTestId("game-tab-ausruestung")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("equipment-group-waffen").getByRole("listitem")).toHaveCount(24);
      await expect(page.getByTestId("equipment-row-w0")).toContainText("auf 1 Sperrliste");
      await expect(page.getByTestId("equipment-delete-w0")).toBeDisabled();
      await expect(page.getByTestId("equipment-without-weapon")).toContainText("Aufsatz 30");
      await expect(page.getByTestId("equipment-row-a29")).toContainText("passt zu keiner");
      await expect(page.getByTestId("equipment-row-p11")).toHaveCount(0);
      await noSideScroll(page);
      // Lange Namen brechen um, die Knöpfe bleiben in der Zeile.
      const row = await page.getByTestId("equipment-row-w3").boundingBox();
      const button = await page.getByTestId("equipment-delete-w3").boundingBox();
      expect(button.x + button.width).toBeLessThanOrEqual(row.x + row.width + 1);
      await page.screenshot({ path: test.info().outputPath(`bibliothek-${width}.png`) });

      await page.getByTestId("equipment-search").fill("rotpunkt");
      await expect(page.getByTestId("equipment-row-a0")).toBeVisible();
      await expect(page.getByTestId("equipment-row-w0")).toHaveCount(0);
      await page.getByTestId("equipment-search").fill("");

      await page.getByTestId("equipment-add-aufsaetze").click();
      const sheet = page.getByTestId("equipment-sheet");
      await sheet.getByTestId("equipment-name").fill("Laservisier");
      await sheet.getByPlaceholder("Waffe suchen").fill("Waffe 2");
      await sheet.getByRole("checkbox", { name: "Waffe 2", exact: true }).check();
      await noSideScroll(page);
      await sheet.getByTestId("equipment-save").click();
      await expect.poll(() => calls.post.length).toBe(1);
      expect(calls.post[0]).toEqual(["/games/g1/equipment", { category: "aufsaetze", subcategory: null, name: "Laservisier", image_url: null, note: null,
        weapon_ids: ["w1"], weapon_class_ids: [] }]);
      // Die Bibliothek speichert sofort: kein Punkt am Reiter, und Verlassen der Seite fragt nicht nach.
      await expect(page.getByTestId("game-tab-dirty-ausruestung")).toHaveCount(0);
      await page.getByTestId("game-page-back").click();
      await expect(page).toHaveURL(/\/admin\/games$/);
      await expect(page.getByTestId("confirm-dialog-confirm")).toHaveCount(0);
    });

    test("Season: Sperrliste je Modus und Aufsätze an einer Waffe, neue Version", async ({ page }) => {
      await page.setViewportSize({ width, height });
      const calls = await mock(page);
      // Reiter „Regelwerk und Sperrliste“ (#2267), angesteuert über den Abschnitt.
      await page.goto("/admin/leagues/seasons/s1#sperrliste");
      await expect(page.getByTestId("season-tab-regelwerk")).toHaveAttribute("aria-selected", "true");
      const panel = page.getByTestId("season-bans");
      await expect(panel.getByTestId("season-bans-head")).toContainText("Version 1 · 3 Zeilen");
      await expect(panel.getByTestId("season-bans-rules-outdated")).toContainText("Version 2");
      await panel.getByTestId("season-bans-head").evaluate((node) => node.scrollIntoView({ block: "start" }));
      await noSideScroll(page);
      await page.screenshot({ path: test.info().outputPath(`season-sperrliste-${width}.png`) });

      // Waffe 1 nur in „Stellung“ sperren, an Waffe 2 einen weiteren Aufsatz.
      await panel.getByTestId("season-bans-toggle-w0").check();
      await panel.getByTestId("season-bans-item-w0").getByRole("checkbox", { name: "Stellung" }).check();
      const second = panel.getByTestId("season-bans-attachments-w1");
      await expect(second).toBeVisible();
      await second.getByRole("checkbox", { name: "Aufsatz 2", exact: true }).check();
      await noSideScroll(page);
      await panel.getByTestId("season-bans-save").click();
      await expect.poll(() => calls.put.length).toBe(1);
      const [path, body] = calls.put[0];
      expect(path).toBe("/admin/leagues/seasons/s1/loadout-bans");
      expect(body.expected_version).toBe(1);
      expect(body.entries).toEqual([
        { item_id: "w0", kind: "item", modes: ["stellung"], attachment_ids: [] },
        { item_id: "w3", kind: "item", modes: [], attachment_ids: [] },
        { item_id: "p0", kind: "item", modes: ["suchen"], attachment_ids: [] },
        { item_id: "w1", kind: "attachments", modes: [], attachment_ids: ["a0", "a3", "a1"] },
      ]);
      await expect(page.getByTestId("season-sync-hint")).toContainText("2 bestehenden Staffeln");
    });

    test("Ligaseite: erlaubte Ausrüstung nach Kategorien mit Hinweisen (#2287, Nr. 99)", async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mock(page);
      await page.goto("/liga/probe-liga/season-1");
      const block = page.getByTestId("league-allowed-equipment");
      await expect(block.getByRole("heading", { level: 2 })).toHaveText("Erlaubte Ausrüstung");
      await expect(block.getByTestId("allowed-group")).toHaveCount(2);
      await expect(block.getByTestId("allowed-note").filter({ hasText: "nicht an" })).toHaveText("nicht an Waffe 2");
      await expect(block.getByTestId("allowed-note").filter({ hasText: "nicht in" })).toHaveText("nicht in Suchen & Zerstören");
      await block.scrollIntoViewIfNeeded();
      await noSideScroll(page);
      await block.screenshot({ path: test.info().outputPath(`ligaseite-sperrliste-${width}.png`) });
    });
  });
}
