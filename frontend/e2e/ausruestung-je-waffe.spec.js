const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { test, expect } = require("@playwright/test");

// Aufsätze je Waffe (#2299) und „nur in …“ (#2298) im echten Browser, Server nachgestellt: Ligaseite mit aufklappbarer Waffe, Regelwerk
// im Web mit dem Satz zu den Aufsätzen, Sperrliste der Season mit den passenden Aufsätzen je Slot, Modi je Aufsatz und „Für alle …
// übernehmen“. Bei 390 und 1440 px ohne seitliches Scrollen, per Tastatur. Daten aus fixtures/allowed-je-waffe.json - so rechnet der
// Server. Nur erfundene Namen. `SHOTS_DIR` legt die Bilder zusätzlich dort ab.

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "allowed-je-waffe.json"), "utf8"));
const CONSENT = () => window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
  essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
  saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
}));
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const LONG = "mit einem wirklich sehr langen Namen, der nirgends hineinpasst";
const MODES = [{ mode: "stellung", label: "Stellung", status: "active" }, { mode: "suchen", label: "Suchen & Zerstören", status: "active" },
  { mode: "kapern", label: "Kapern", status: "active" }];
const IMG = (name) => `/api/static/uploads/${name}.png`;
const CATEGORIES = [
  { key: "waffen", label: "Waffen", role: "weapon", subcategories: [{ key: "sturm", label: "Sturmgewehr", icon_url: IMG("klasse-sturm") },
    { key: "schrot", label: "Schrotflinte", icon_url: IMG("klasse-schrot") }, { key: "pistole", label: `Pistole ${LONG}`, icon_url: null }] },
  { key: "aufsaetze", label: "Aufsätze", role: "attachment", subcategories: [{ key: "muendung", label: "Mündung", icon_url: IMG("klasse-muendung") },
    { key: "optik", label: "Optik", icon_url: IMG("klasse-optik") }] },
  { key: "perks", label: "Perks", role: "item", subcategories: [] },
];
const item = (id, category, name, extra = {}) => ({ id, category, name, image_url: IMG(`bild-${id}`), status: "active", weapon_ids: [], weapon_class_ids: [],
  subcategory: null, ...extra });
const LIBRARY = [
  item("w1", "waffen", "Blitz 9", { subcategory: "sturm" }), item("w2", "waffen", "Donner 4", { subcategory: "sturm" }),
  item("w3", "waffen", `Kar ${LONG}`, { subcategory: "sturm", image_url: null }),
  item("s1", "waffen", "Hagel", { subcategory: "schrot" }), item("s2", "waffen", "Bö", { subcategory: "schrot" }),
  item("p1", "waffen", "Funke", { subcategory: "pistole" }), item("o1", "waffen", "Ohne Klasse"),
  item("a1", "aufsaetze", "Rotpunkt", { subcategory: "optik", weapon_class_ids: ["sturm"] }),
  item("a4", "aufsaetze", "Holo", { subcategory: "optik", weapon_class_ids: ["sturm"] }),
  item("a5", "aufsaetze", "Schalldämpfer", { subcategory: "muendung", weapon_class_ids: ["sturm"], weapon_ids: ["p1"] }),
  item("a6", "aufsaetze", "Kompensator", { subcategory: "muendung", weapon_class_ids: ["sturm"] }),
  item("a2", "aufsaetze", "Griff", { weapon_ids: ["w1"] }),
  item("k1", "perks", "Leise Sohlen"), item("k2", "perks", "Kaltblut"),
];
const byId = (id) => LIBRARY.find((row) => row.id === id);
const label = (key) => MODES.find((mode) => mode.mode === key).label;
const snap = (id, modes = [], extra = {}) => ({ kind: "item", item_id: id, name: byId(id).name, category: byId(id).category, image_url: byId(id).image_url,
  subcategory: byId(id).subcategory, modes, mode_labels: modes.map(label), attachments: [], ...extra });
// Dieselbe Liste wie in fixtures/allowed-je-waffe.json (scratch: gen_v4) - Kompensator an allen Waffen, an Donner 4 Rotpunkt ganz und Holo
// in Stellung und Kapern.
const LIST = {
  id: "v2", version: 2, saved_at: "2026-11-04T10:00:00+00:00", stale: false, outdated_item_ids: [], origin: "league_season", class_new_items: [],
  entries: [
    { kind: "class", item_id: null, name: "Schrotflinte", category: "waffen", subcategory: "schrot", subcategory_label: "Schrotflinte", image_url: IMG("klasse-schrot"),
      modes: [], mode_labels: [], attachments: [], items: [{ item_id: "s2", name: "Bö", image_url: null }, { item_id: "s1", name: "Hagel", image_url: null }] },
    snap("w3", ["stellung", "kapern"]), snap("o1", ["suchen"]), snap("a6"),
    snap("w2", [], { kind: "attachments", attachments: [{ item_id: "a1", name: "Rotpunkt", image_url: null },
      { item_id: "a4", name: "Holo", image_url: null, modes: ["stellung", "kapern"], mode_labels: ["Stellung", "Kapern"] }] }),
  ],
};
const GAME = { id: "g1", name: "Probe Shooter", slug: "probe-shooter", modes: MODES };
const BANS = {
  capabilities: ["season"], game: GAME, categories: CATEGORIES, library: LIBRARY, list: LIST,
  versions: [{ id: "v2", version: 2, entries: 5, cleared: false, saved_at: "2026-11-04T10:00:00+00:00" }],
  rules: { uses_block: true, outdated: false, version: 2, admin_url: "/admin/leagues/rules/league_season/s1" }, staffeln: 1,
};
const SEASON = {
  id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10,
  matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3,
  team_size: 4, min_squad_size: 3, game_mode_order: [], scoring_rules: { match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: [] },
  result_confirm_hours: 48, lineup_amend_hours: 48, rules_text: "", visibility: "members", status: "active", blocked_periods: [],
};
const SEASON_PAGE = {
  capabilities: ["manage", "season", "rules"], league: { id: "l1", name: "Probe-Liga", slug: "probe-liga" }, season: SEASON, game: GAME,
  calendar: { weeks: [], blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 8, rounds_needed: 7, end_date: "2027-01-18T22:59:59+00:00" },
  library: [], map_pool: null, divisions: [],
};
const PUBLIC_SEASON = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" } },
  season: { id: "s1", name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", end_date: "2027-01-18T22:59:59+00:00", matchday_days: 7,
    default_match_weekday: 6, default_match_time: "20:00", best_of: 3, team_size: 4, match_points: { win: 3, draw: 1, loss: 0 }, blocked_periods: [] },
  look: {}, prizes: [], map_pool: null, divisions: [], rules: null, application: null, loadout_bans: LIST, allowed_equipment: FIXTURE.allowed,
};
const V2 = { id: "r2", scope: "league_season", version: 2, label: "Version 2", title: "Regelwerk", valid_from: "2026-11-04", published_at: "2026-11-04T10:00:00+00:00",
  change_reason: "Aufsätze je Waffe", is_current: true, pdf_url: "/api/league-rules/seasons/probe-liga/season-1/versions/r2/pdf" };
const RULES_PAGE = {
  league: { slug: "probe-liga", name: "Probe-Liga" }, season: { id: "s1", slug: "season-1", name: "Season 1", number: 1, status: "active" }, look: {}, public: true,
  source: "rules", version: V2, versions: [V2], upcoming: null, seasons: [], fallback_text: null, consent: null, changes: null,
  sections: [
    { anchor: "einleitung", title: null, level: 0, kind: "main", body_md: "Vorwort der Probe-Liga.", mark: null },
    { anchor: "anlage-a", title: "Anlage A: Erlaubte Ausrüstung", level: 1, kind: "annex", body_md: FIXTURE.block_md, mark: null },
  ],
};

/** Ein erfundenes Bild als echtes PNG (zwei Farbflächen). */
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
const SMALL = png(160, 90, [126, 226, 168]);
const ICON = png(32, 32, [255, 159, 10]);

async function mock(page) {
  await page.addInitScript(CONSENT);
  const calls = { put: [] };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url()).pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.startsWith("/static/uploads/")) {
      return route.fulfill({ status: 200, contentType: "image/png", body: url.includes("klasse") ? ICON : url.includes("bild-a") ? SMALL : PICTURE });
    }
    if (url.startsWith("/changes")) return route.abort();
    if (url === "/auth/me") return json(ADMIN);
    const method = request.method();
    if (method === "PUT") calls.put.push([url, request.postDataJSON?.() ?? null]);
    if (url === "/admin/leagues/seasons/s1") return json(SEASON_PAGE);
    if (url === "/admin/leagues/seasons/s1/loadout-bans" && method === "PUT") return json({ ...LIST, version: 3, staffeln_to_sync: 1 });
    if (url === "/admin/leagues/seasons/s1/loadout-bans") return json(BANS);
    if (url === "/leagues/probe-liga/season-1") return json(PUBLIC_SEASON);
    if (url.startsWith("/league-rules/seasons/probe-liga/season-1")) return json(RULES_PAGE);
    if (method !== "GET") return json({ ok: true });
    const objects = ["/settings/public", "/home/about", "/chats/unread", "/seasonal/active", "/friends"];
    return json(objects.includes(url) ? {} : []);
  });
  return calls;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(locator, name) {
  // Für die Bilder: feste Leisten (Kopf, Speicherleiste, Navigation am Handy) liegen sonst über dem Ausschnitt.
  const hide = (hidden) => locator.page().evaluate((on) => {
    for (const node of document.querySelectorAll("body *")) {
      if (["fixed", "sticky"].includes(getComputedStyle(node).position)) node.style.visibility = on ? "hidden" : "";
    }
  }, hidden);
  await hide(true);
  await locator.screenshot({ path: test.info().outputPath(name) });
  if (process.env.SHOTS_DIR) await locator.screenshot({ path: path.join(process.env.SHOTS_DIR, name) });
  await hide(false);
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test.describe(`Aufsätze je Waffe (${width} px)`, () => {
    test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

    test("Ligaseite: je Waffe „N Aufsätze · K gesperrt“, aufgeklappt die erlaubten je Slot", async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mock(page);
      await page.goto("/liga/probe-liga/season-1");
      const block = page.getByTestId("league-allowed-equipment");
      await expect(block.getByTestId("allowed-group")).toHaveCount(2);
      await expect(block.getByText("Aufsätze", { exact: true })).toHaveCount(0);
      const donner = block.getByTestId("allowed-weapon-toggle").filter({ hasText: "Donner 4" });
      await expect(donner.getByTestId("allowed-weapon-summary")).toHaveText("4 Aufsätze · 2 gesperrt");
      await expect(block.getByTestId("allowed-weapon-toggle").filter({ hasText: "Kar" }).getByTestId("allowed-note")).toHaveText("nur in Suchen & Zerstören");

      // Tastatur: Fokus auf die Karte, Enter klappt auf.
      await donner.focus();
      await page.keyboard.press("Enter");
      await expect(donner).toHaveAttribute("aria-expanded", "true");
      const panel = block.getByTestId("allowed-attachments");
      await expect(panel.getByTestId("allowed-slot")).toHaveCount(2);
      await expect(panel.getByTestId("allowed-slot").first()).toContainText("Mündung");
      await expect(panel.getByTestId("allowed-attachment").filter({ hasText: "Holo" }).getByTestId("allowed-note")).toHaveText("nur in Suchen & Zerstören");
      await expect(panel.getByTestId("allowed-attachments-banned")).toHaveText("Gesperrt: Kompensator, Rotpunkt");
      // Der Kasten steht unter der Zeile über die ganze Breite des Rasters.
      const grid = await panel.locator("xpath=..").boundingBox();
      const box = await panel.boundingBox();
      const tile = await donner.boundingBox();
      expect(box.y).toBeGreaterThan(tile.y + tile.height - 1);
      expect(Math.abs(box.width - grid.width)).toBeLessThanOrEqual(2);
      await noSideScroll(page);
      await panel.scrollIntoViewIfNeeded();
      await shot(block, `ligaseite-aufgeklappt-${width}.png`);
      await page.keyboard.press(" ");
      await expect(block.getByTestId("allowed-attachments")).toHaveCount(0);
    });

    test("Regelwerk im Web: je Waffe der Satz zu den Aufsätzen, keine eigene Aufsatz-Liste", async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mock(page);
      await page.goto("/liga/probe-liga/season-1/regeln");
      const annex = page.locator("[id='anlage-a']");
      await expect(annex.getByText("alle passenden Aufsätze erlaubt, außer: Kompensator, Rotpunkt, Holo (nur in Suchen & Zerstören)")).toBeVisible();
      await expect(annex.locator("em").filter({ hasText: "nur in Suchen & Zerstören" }).first()).toBeVisible();
      const heads = await annex.locator("p > strong:only-child").allTextContents();
      expect(heads).toEqual(["Waffen", "Perks"]);
      const lists = annex.locator("ul").filter({ has: page.locator("u") });
      expect(await lists.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).display))).toEqual(Array(4).fill("grid"));
      // Der Satz ist kleiner und leiser als der Name.
      const sizes = await annex.locator("li > u").first().evaluate((node) => [getComputedStyle(node).fontSize, getComputedStyle(node.parentElement).fontSize]);
      expect(parseFloat(sizes[0])).toBeGreaterThan(parseFloat(sizes[1]));
      await noSideScroll(page);
      await annex.scrollIntoViewIfNeeded();
      await shot(annex, `regelwerk-web-${width}.png`);
    });

    test("Verwaltung: Waffe aufklappen zeigt die passenden Aufsätze je Slot, Modi je Aufsatz, für die Klasse übernehmen", async ({ page }) => {
      await page.setViewportSize({ width, height });
      const calls = await mock(page);
      await page.goto("/admin/leagues/seasons/s1#sperrliste");
      const panel = page.getByTestId("season-bans");
      const open = panel.getByTestId("season-bans-open-w2");
      await expect(open).toHaveText("4 Aufsätze · 2 gesperrt");
      await open.click();
      const weapon = panel.getByTestId("season-bans-attachments-w2");
      await expect(weapon.getByTestId("season-bans-slot-w2")).toHaveCount(2);
      await expect(weapon.getByLabel("Griff an Donner 4 sperren")).toHaveCount(0);
      await expect(weapon.getByLabel("Kompensator an Donner 4 sperren")).toBeDisabled();
      const holo = panel.getByTestId("season-bans-attachment-w2-a4");
      await expect(holo.getByRole("checkbox", { name: "Stellung" })).toBeChecked();
      await expect(holo.getByRole("checkbox", { name: "Kapern" })).toBeChecked();
      await noSideScroll(page);
      await panel.getByTestId("season-bans-item-w2").scrollIntoViewIfNeeded();
      await shot(panel.getByTestId("season-bans-item-w2"), `verwaltung-aufgeklappt-${width}.png`);

      await weapon.getByTestId("season-bans-copy-class-w2").click();
      await expect(panel.getByTestId("season-bans-open-w1")).toHaveText("5 Aufsätze · 2 gesperrt");
      await panel.getByTestId("season-bans-save").click();
      await expect.poll(() => calls.put.length).toBe(1);
      const attached = { item_id: "", kind: "attachments", modes: [], attachment_ids: ["a1", "a4"], attachment_modes: { a4: ["stellung", "kapern"] } };
      expect(calls.put[0][1].entries).toEqual([
        { kind: "class", subcategory: "schrot", modes: [], attachment_ids: [] },
        { item_id: "w3", kind: "item", modes: ["stellung", "kapern"], attachment_ids: [] },
        { item_id: "o1", kind: "item", modes: ["suchen"], attachment_ids: [] },
        { item_id: "a6", kind: "item", modes: [], attachment_ids: [] },
        { ...attached, item_id: "w1" }, { ...attached, item_id: "w2" }, { ...attached, item_id: "w3" },
      ]);
    });
  });
}
