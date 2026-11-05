const zlib = require("node:zlib");
const { test, expect } = require("@playwright/test");

// Unterkategorien der Ausrüstung (#2287) im echten Browser, Server nachgestellt: Bibliothek gruppiert und einklappbar, Blatt
// „Unterkategorien“, Einträge verschieben, Sperrliste der Season mit „Ganze Klasse sperren“, öffentliche Ligaseite und Regelwerk mit
// Karten je Unterkategorie. Bei 390 und 1440 px ohne seitliches Scrollen. Nur erfundene Namen.

const CONSENT = () => window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
  essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
  saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
}));
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const LONG = "mit einem wirklich sehr langen Namen, der nirgends hineinpasst";
const MODES = [{ mode: "stellung", label: "Stellung", status: "active" }, { mode: "suchen", label: "Suchen & Zerstören", status: "active" }];
const GAME = { id: "g1", name: "Probe Shooter", slug: "probe-shooter", kind: "standalone", match_modes: MODES, player_id_fields: [] };
const IMG = (name) => `/api/static/uploads/${name}.png`;
const SUBS = [
  { key: "sturm", label: "Sturmgewehr", icon_url: IMG("klasse-sturm") },
  { key: "schrot", label: "Schrotflinte", icon_url: IMG("klasse-schrot") },
  { key: "pistole", label: `Pistole ${LONG}`, icon_url: null },
  { key: "werfer", label: "Raketenwerfer", icon_url: null },
];
const CATEGORIES = [
  { key: "waffen", label: "Waffen", role: "weapon", count: 9, subcategories: SUBS },
  { key: "aufsaetze", label: "Aufsätze", role: "attachment", count: 3, subcategories: [{ key: "optik", label: "Optik", icon_url: null }] },
  { key: "perks", label: "Perks", role: "item", count: 2, subcategories: [] },
];
const item = (id, category, name, extra = {}) => ({ id, category, name, image_url: IMG(`bild-${id}`), status: "active", in_lists: 0, weapon_ids: [], weapon_class_ids: [], subcategory: null, ...extra });
const ITEMS = [
  item("w1", "waffen", "Blitz 9", { subcategory: "sturm", in_lists: 1 }),
  item("w2", "waffen", "Donner 4", { subcategory: "sturm" }),
  item("w3", "waffen", `Kar ${LONG}`, { subcategory: "sturm", image_url: null }),
  item("s1", "waffen", "Hagel", { subcategory: "schrot" }),
  item("s2", "waffen", "Bö", { subcategory: "schrot" }),
  item("s3", "waffen", "Sturm 12", { subcategory: "schrot" }),
  item("p1", "waffen", "Funke", { subcategory: "pistole" }),
  item("o1", "waffen", "Ohne Klasse"),
  item("o2", "waffen", "Noch eine ohne"),
  item("a1", "aufsaetze", "Rotpunkt", { subcategory: "optik", weapon_class_ids: ["sturm"] }),
  item("a2", "aufsaetze", "Griff", { weapon_ids: ["w1"] }),
  item("a3", "aufsaetze", "Kompensator"),
  item("k1", "perks", "Leise Sohlen"),
  item("k2", "perks", "Kaltblut"),
];
const LIBRARY = { game: { id: "g1", name: "Probe Shooter", slug: "probe-shooter", modes: MODES }, categories: CATEGORIES, items: ITEMS, limit: 1000,
  categories_limit: 20, subcategories_limit: 30, subcategory_counts: { sturm: 3, schrot: 3, pistole: 1, optik: 1 }, suggested_categories: [],
  suggested_subcategories: { weapon: ["Sturmgewehr", "Maschinenpistole", "Leichtes MG", "Schrotflinte", "Präzisionsgewehr", "Scharfschützengewehr", "Pistole", "Raketenwerfer", "Nahkampf"], attachment: ["Optik"], item: [] },
  attachments_without_weapon: [{ id: "a3", name: "Kompensator" }] };

const snap = (row, extra = {}) => ({ kind: "item", item_id: row.id, name: row.name, category: row.category, category_label: CATEGORIES.find((c) => c.key === row.category).label,
  role: "weapon", image_url: row.image_url, subcategory: row.subcategory, subcategory_label: SUBS.find((s) => s.key === row.subcategory)?.label || null,
  subcategory_icon_url: SUBS.find((s) => s.key === row.subcategory)?.icon_url || null, modes: [], mode_labels: [], attachments: [], ...extra });
const byId = (id) => ITEMS.find((row) => row.id === id);
const LIST = {
  id: "v3", version: 3, saved_at: "2026-11-04T10:00:00+00:00", stale: false, outdated_item_ids: [], origin: "league_season",
  class_new_items: [{ subcategory: "schrot", label: "Schrotflinte", names: ["Sturm 12"] }],
  entries: [
    snap(byId("o1"), { mode_labels: ["Suchen & Zerstören"], modes: ["suchen"] }),
    { kind: "class", item_id: null, name: "Schrotflinte", category: "waffen", category_label: "Waffen", role: "weapon", subcategory: "schrot", subcategory_label: "Schrotflinte",
      subcategory_icon_url: null, image_url: IMG("klasse-schrot"), modes: [], mode_labels: [], attachments: [],
      items: ["s2", "s1", "s3"].map((id) => ({ item_id: id, name: byId(id).name, image_url: byId(id).image_url })) },
    snap(byId("w1")),
    snap(byId("w3"), { modes: ["suchen"], mode_labels: ["Suchen & Zerstören"] }),
    { ...snap(byId("w2")), kind: "attachments", attachments: [{ item_id: "a1", name: "Rotpunkt", image_url: null }] },
  ],
};
const BANS = {
  capabilities: ["season"], game: LIBRARY.game, categories: CATEGORIES.map(({ count, ...row }) => row),
  library: ITEMS.map(({ id, category, subcategory, name, image_url, weapon_ids, weapon_class_ids, status }) => ({ id, category, subcategory, name, image_url, weapon_ids, weapon_class_ids, status })),
  list: LIST, versions: [{ id: "v3", version: 3, entries: 5, cleared: false, saved_at: "2026-11-04T10:00:00+00:00" }],
  rules: { uses_block: true, outdated: false, version: 2, admin_url: "/admin/leagues/rules/league_season/s1" }, staffeln: 1,
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
};
// Erlaubte Ausrüstung (Fabian Nr. 99): so liefert der Server sie für Liga- und Matchseite (`allowed_equipment`) und als Baustein im
// Regelwerk (loadout_bans.render_block): Kategorie fett, je Unterkategorie eine Zeile, Karten darunter, ganz gesperrte Klasse als Zeile.
const entry = (id, extra = {}) => ({ name: byId(id).name, image_url: byId(id).image_url, not_in: [], not_at: [], ...extra });
const ALLOWED = { list: true, layout: 3, categories: [
  { label: "Waffen", sections: [
    { label: null, state: "some", not_in: [], banned: [], entries: [entry("o2"), entry("o1", { not_in: ["Suchen & Zerstören"] })] },
    { label: "Sturmgewehr", icon_url: IMG("klasse-sturm"), state: "some", not_in: [], banned: [], entries: [entry("w1"), entry("w2"),
      entry("w3", { not_in: ["Suchen & Zerstören"] })] },
    { label: "Schrotflinte", state: "banned", not_in: [], banned: ["Bö", "Hagel", "Sturm 12"], entries: [] },
    { label: `Pistole ${LONG}`, state: "all", not_in: [], banned: [], entries: [entry("p1")] },
  ] },
  { label: "Aufsätze", sections: [
    { label: null, state: "all", not_in: [], banned: [], entries: [entry("a2"), entry("a3")] },
    { label: "Optik", state: "some", not_in: [], banned: [], entries: [entry("a1", { not_at: [{ name: "Donner 4", modes: [] }] })] },
  ] },
  { label: "Perks", sections: [{ label: null, state: "all", not_in: [], banned: [], entries: [entry("k2"), entry("k1")] }] },
] };
PUBLIC_SEASON.allowed_equipment = ALLOWED;
const card = (id, note = "", image = true) => `- ${image ? `![Ausrüstung](${byId(id).image_url}) ` : ""}++${byId(id).name}++${note ? ` *${note}*` : ""}`;
const BLOCK = [
  "*Erlaubt ist die Ausrüstung, die hier steht – Einschränkungen stehen beim Eintrag.*", "", "**Waffen**", "",
  card("o2"), card("o1", "nicht in Suchen & Zerstören"), "",
  `![Klassen-Symbol](${IMG("klasse-sturm")}) *Sturmgewehr*`, card("w1"), card("w2"), `- ++Kar ${LONG}++ *nicht in Suchen & Zerstören*`, "",
  `![Klassen-Symbol](${IMG("klasse-schrot")}) *Schrotflinte* · **nicht erlaubt** (Bö, Hagel, Sturm 12)`, "",
  `*Pistole ${LONG}* · alle erlaubt`, card("p1"), "",
  "**Aufsätze**", "", card("a2", "", false), card("a3", "", false), "", "*Optik*", card("a1", "nicht an Donner 4", false), "",
  "**Perks**", "", card("k2"), card("k1"),
].join("\n");
const V1 = { id: "r1", scope: "league_season", version: 1, label: "Version 1", title: "Regelwerk", valid_from: "2026-11-04", published_at: "2026-11-04T10:00:00+00:00",
  change_reason: "Erste Fassung", is_current: true, pdf_url: "/api/league-rules/seasons/probe-liga/season-1/versions/r1/pdf" };
const RULES_PAGE = {
  league: { slug: "probe-liga", name: "Probe-Liga" }, season: { id: "s1", slug: "season-1", name: "Season 1", number: 1, status: "active" }, look: {}, public: true,
  source: "rules", version: V1, versions: [V1], upcoming: null, seasons: [], fallback_text: null, consent: null, changes: null,
  sections: [
    { anchor: "einleitung", title: null, level: 0, kind: "main", body_md: "Vorwort der Probe-Liga.", mark: null },
    { anchor: "anlage-a", title: "Anlage A: Erlaubte Ausrüstung", level: 1, kind: "annex", body_md: BLOCK, mark: null },
  ],
};

/** Ein erfundenes Bild als echtes PNG (zwei Farbflächen) - damit Karten und Symbole etwas zeigen. */
function png(width, height, color) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) row.set(x < width * 0.6 ? color : [24, 24, 28], 1 + x * 3);
    rows.push(row);
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
const PICTURE = png(160, 90, [41, 182, 232]);
const ICON = png(32, 32, [255, 159, 10]);

async function mock(page) {
  await page.addInitScript(CONSENT);
  const calls = { put: [], post: [], patch: [] };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.startsWith("/static/uploads/")) return route.fulfill({ status: 200, contentType: "image/png", body: path.includes("klasse") ? ICON : PICTURE });
    if (path.startsWith("/changes")) return route.abort();
    if (path === "/auth/me") return json(ADMIN);
    const method = request.method();
    if (method !== "GET") calls[method.toLowerCase()]?.push([path, request.postDataJSON?.() ?? null]);
    if (path === "/games/g1/equipment" && method === "GET") return json(LIBRARY);
    if (path === "/games/g1" && method === "GET") return json(GAME);
    if (path === "/games" && method === "GET") return json([GAME]);
    if (path === "/games/g1/usage") return json({ total: 0, text: "", counts: {}, modes: {} });
    if (path === "/games/g1/equipment/move") return json({ updated: 2 });
    if (path === "/admin/leagues/seasons/s1") return json(SEASON_PAGE);
    if (path === "/admin/leagues/seasons/s1/loadout-bans" && method === "PUT") return json({ ...LIST, version: 4, staffeln_to_sync: 1 });
    if (path === "/admin/leagues/seasons/s1/loadout-bans") return json(BANS);
    if (path === "/leagues/probe-liga/season-1") return json(PUBLIC_SEASON);
    if (path.startsWith("/league-rules/seasons/probe-liga/season-1")) return json(RULES_PAGE);
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
  test.describe(`Unterkategorien (${width} px)`, () => {
    test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

    test("Bibliothek gruppiert, Blatt Unterkategorien, Einträge verschieben", async ({ page }) => {
      await page.setViewportSize({ width, height });
      const calls = await mock(page);
      await page.goto("/admin/games/g1#ausruestung");
      const weapons = page.getByTestId("equipment-group-waffen");
      // Einklappen (#2306): anfangs zu - „Alle aufklappen“ zeigt die Gruppen. Mit „Bewegung reduzieren“ ohne Animation.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(weapons.getByTestId("equipment-sub-ohne")).toHaveCount(0);
      await page.getByTestId("equipment-open-all").click();
      const duration = await page.locator("[id='equipment-body-waffen']").evaluate((node) => parseFloat(getComputedStyle(node).animationDuration));
      expect(duration).toBeLessThan(0.001);
      await expect(weapons.getByTestId("equipment-sub-ohne")).toContainText("Ohne Unterkategorie");
      await expect(weapons.getByTestId("equipment-sub-sturm").getByTestId("equipment-sub-count")).toHaveText("3");
      await expect(weapons.getByTestId("equipment-sub-werfer")).toContainText("Noch kein Eintrag");
      await expect(page.getByTestId("equipment-row-a1")).toContainText("passt zu Sturmgewehr (Klasse)");
      await noSideScroll(page);
      await page.screenshot({ path: test.info().outputPath(`bibliothek-gruppiert-${width}.png`) });
      // Einklappen: der Zähler bleibt, die Einträge gehen.
      await weapons.getByTestId("equipment-sub-toggle-schrot").click();
      await expect(page.getByTestId("equipment-row-s1")).toHaveCount(0);

      await page.getByTestId("equipment-subcategories-waffen").click();
      const sheet = page.getByTestId("equipment-subcategories-sheet");
      await expect(sheet.getByLabel("Sturmgewehr entfernen")).toBeDisabled();
      await expect(sheet.getByTestId("equipment-subcategories-suggestion")).toContainText("Maschinenpistole");
      await noSideScroll(page);
      await page.screenshot({ path: test.info().outputPath(`unterkategorien-${width}.png`) });
      await sheet.getByRole("button", { name: "Abbrechen" }).click();

      await page.getByTestId("equipment-select-mode").click();
      await page.getByTestId("equipment-select-o1").check();
      await page.getByTestId("equipment-select-o2").check();
      const bar = page.getByTestId("equipment-move-bar");
      await bar.getByTestId("equipment-move-target").selectOption("pistole");
      await noSideScroll(page);
      await bar.getByTestId("equipment-move").click();
      await expect.poll(() => calls.post.length).toBe(1);
      expect(calls.post[0]).toEqual(["/games/g1/equipment/move", { item_ids: ["o1", "o2"], subcategory: "pistole" }]);
    });

    test("Season: ganze Klasse sperren je Modus, Einträge der Klasse mitgesperrt", async ({ page }) => {
      await page.setViewportSize({ width, height });
      const calls = await mock(page);
      await page.goto("/admin/leagues/seasons/s1#sperrliste");
      const panel = page.getByTestId("season-bans");
      // Einklappen (#2306): mit Sperren ist alles zu; die Kopfzeile der Klasse sagt, wie viel gesperrt ist. Ohne Bewegung für das Bild.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await panel.getByTestId("season-bans-fold-waffen").click();
      await expect(panel.getByTestId("season-bans-class-schrot-count")).toContainText("gesperrt");
      await panel.getByTestId("season-bans-open-all").click();
      await expect(panel.getByTestId("season-bans-class-schrot-toggle")).toBeChecked();
      await expect(panel.getByTestId("season-bans-via-class-s1")).toHaveText("Mit der ganzen Klasse gesperrt");
      await expect(panel.getByTestId("season-bans-class-new")).toContainText("Sturm 12");
      await panel.getByTestId("season-bans-group-waffen").evaluate((node) => node.scrollIntoView({ block: "start" }));
      await noSideScroll(page);
      await page.screenshot({ path: test.info().outputPath(`season-klassen-${width}.png`) });
      // Raketenwerfer (noch leer) nur in „Stellung“ sperren.
      await panel.getByTestId("season-bans-class-werfer-toggle").check();
      await panel.getByTestId("season-bans-class-werfer").getByRole("checkbox", { name: "Stellung" }).check();
      await panel.getByTestId("season-bans-save").click();
      await expect.poll(() => calls.put.length).toBe(1);
      const [, body] = calls.put[0];
      expect(body.entries.filter((row) => row.kind === "class")).toEqual([
        { kind: "class", subcategory: "schrot", modes: [], attachment_ids: [] },
        { kind: "class", subcategory: "werfer", modes: ["stellung"], attachment_ids: [] },
      ]);
    });

    test("Ligaseite und Regelwerk: erlaubte Ausrüstung gruppiert mit Karten", async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mock(page);
      await page.goto("/liga/probe-liga/season-1");
      const block = page.getByTestId("league-allowed-equipment");
      await expect(block.getByRole("heading", { level: 2 })).toHaveText("Erlaubte Ausrüstung");
      await expect(block.getByTestId("allowed-banned")).toHaveText("Nicht erlaubt");
      await expect(block.getByTestId("allowed-banned-names")).toHaveText("Bö, Hagel, Sturm 12");
      await expect(block.getByTestId("allowed-all")).toHaveCount(1);
      await expect(block.getByText("nicht an Donner 4")).toBeVisible();
      await block.scrollIntoViewIfNeeded();
      await noSideScroll(page);
      await block.screenshot({ path: test.info().outputPath(`ligaseite-gruppiert-${width}.png`) });

      await page.goto("/liga/probe-liga/season-1/regeln");
      const annex = page.locator("[id='anlage-a']");
      const cards = annex.locator("ul").filter({ has: page.locator("img[alt='Ausrüstung']") }).first();
      await expect(cards).toBeVisible();
      expect(await cards.evaluate((node) => getComputedStyle(node).display)).toBe("grid");
      await expect(annex.locator("img[alt='Klassen-Symbol']").first()).toBeVisible();
      await expect(annex.getByText("nicht erlaubt")).toBeVisible();
      // Codex Runde 1: Alle Kategorien gleich - jede Kartenliste im Raster (auch Aufsätze ohne Bilder), gleiche Überschriften.
      const lists = annex.locator("ul").filter({ has: page.locator("u") });
      expect(await lists.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).display))).toEqual(Array(6).fill("grid"));
      const heads = await annex.locator("p > strong:only-child").evaluateAll((nodes) => nodes.map((node) => [node.textContent, getComputedStyle(node).fontSize, getComputedStyle(node).textTransform]));
      expect(heads.map((row) => row[0])).toEqual(["Waffen", "Aufsätze", "Perks"]);
      expect(new Set(heads.map((row) => `${row[1]} ${row[2]}`)).size).toBe(1);
      await annex.scrollIntoViewIfNeeded();
      await noSideScroll(page);
      await annex.screenshot({ path: test.info().outputPath(`regelwerk-gruppiert-${width}.png`) });
    });
  });
}
