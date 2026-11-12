const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Unterkategorien und erlaubte Ausrüstung (#2287, docs/LIGA.md „C.4 Ausrüstung“, Fabian Nr. 99) gegen den echten Server. Stand aus
// scripts/seed_abnahme_liga.py (ABNAHME_STATE auf dessen Stand-Datei): Spiel „Call of Duty“, Season der Liga-Anmeldung mit Regelwerk.
// 1. Bibliothek: Unterkategorien „Sturmgewehr“ und „Schrotflinte“ im Blatt anlegen, zwei Waffen per Auswahl nach „Sturmgewehr“
//    verschieben, eine Schrotflinte und einen Aufsatz für die ganze Klasse Sturmgewehr anlegen.
// 2. Season: die ganze Klasse „Schrotflinte“ sperren, eine Waffe nur in einem Modus, den Aufsatz an einer Waffe.
// 3. Regelwerk mit Baustein „Erlaubte Ausrüstung“ veröffentlichen: Web und PDF zeigen, was erlaubt ist.
// 4. Neue Schrotflinte anlegen: Das Regelwerk meldet „muss freigegeben werden“ und schlägt die neue Fassung vor.
// 5. Gast bei 390 und 1440 px: Ligaseite und Regelwerk.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const stamp = Date.now().toString(36);
const game = state?.game;
const anmeldung = state?.anmeldung;
const RIFLE_A = `Probe Sturm A ${stamp}`;
const RIFLE_B = `Probe Sturm B ${stamp}`;
const SHOTGUN = `Probe Flinte ${stamp}`;
const SHOTGUN_NEW = `Probe Flinte neu ${stamp}`;
const SIGHT = `Probe Visier ${stamp}`;

async function shot(page, name, locator = null) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  if (locator) await locator.screenshot({ path: path.join(SHOTS, name) });
  else await page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function csrfHeaders(page) {
  const cookie = (await page.context().cookies()).find((row) => row.name === "csrf_token");
  return cookie ? { "X-CSRF-Token": decodeURIComponent(cookie.value) } : {};
}

async function ok(page, method, url, data) {
  const response = await page.request.fetch(url, { method, data, headers: await csrfHeaders(page) });
  const body = await response.json().catch(() => null);
  expect(response.status(), `${method} ${url}: ${JSON.stringify(body)}`).toBe(200);
  return body;
}

/** Ein erfundenes Bild als echtes PNG: zwei Farbflächen. */
function syntheticPng(color, width = 160, height = 90) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) row.set(x < width * 0.55 ? color : [24, 24, 28], 1 + x * 3);
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
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

async function upload(page, name, color) {
  const response = await page.request.post("/api/uploads/image?media_scope=admin", {
    headers: await csrfHeaders(page), multipart: { file: { name: `${name}-${stamp}.png`, mimeType: "image/png", buffer: syntheticPng(color) } } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).url;
}

function viennaToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Vienna" }).format(new Date());
}

async function publishWithBlock(page, seasonId, reason) {
  const scope = `/api/admin/league-rules/league_season/${seasonId}`;
  const view = await ok(page, "GET", scope);
  const draft = view.draft || await ok(page, "POST", `${scope}/draft/from-version`, {});
  const annexes = (draft.annexes || []).map(({ title, body_md }) => ({ title, body_md }));
  if (!annexes.some((row) => row.body_md.includes("[[baustein:loadout_bans]]"))) annexes.unshift({ title: "Erlaubte Ausrüstung", body_md: "[[baustein:loadout_bans]]" });
  const saved = await ok(page, "PUT", `${scope}/draft`, { title: draft.title || "Regelwerk", body_md: draft.body_md || "# Fairplay\nFair spielen.", annexes, revision: draft.revision });
  return ok(page, "POST", `${scope}/publish`, { revision: saved.revision, valid_from: viennaToday(), change_reason: reason, requires_consent: false, confirm_empty: true });
}

test.describe("Abnahme: Unterkategorien und erlaubte Ausrüstung gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !(game && anmeldung), `Kein Liga-Stand in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 300_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  test("Unterkategorien, Klasse sperren, Regelwerk, neue Schrotflinte verlangt Freigabe", async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 1440, height: 900 }, locale: "de-AT", timezoneId: "Europe/Vienna" });
    const page = await context.newPage();
    await signIn(page, "admin");
    const problems = watch(page);
    const seasonId = anmeldung.season.id;
    const base = `/api/games/${game.id}/equipment`;
    let library = await ok(page, "GET", base);
    if (!library.categories.length) await ok(page, "PUT", `${base}/categories`, { categories: library.suggested_categories });
    library = await ok(page, "GET", base);
    const weapons = library.categories.find((row) => row.role === "weapon");
    const attachments = library.categories.find((row) => row.role === "attachment");

    // 1. Unterkategorien im Blatt: Vorschlag einfügen, nur Sturmgewehr und Schrotflinte behalten, Symbol für Sturmgewehr.
    await page.goto(`/admin/games/${game.id}#ausruestung`);
    await page.getByTestId(`equipment-subcategories-${weapons.key}`).click();
    const sheet = page.getByTestId("equipment-subcategories-sheet");
    const existing = (weapons.subcategories || []).map((row) => row.label);
    for (const label of ["Sturmgewehr", "Schrotflinte"]) {
      if (existing.includes(label)) continue;
      await sheet.getByTestId("equipment-subcategory-add").click();
      await sheet.getByLabel(/^Name der Unterkategorie/).last().fill(label);
    }
    await shot(page, "unterkategorien-1440.png");
    await sheet.getByTestId("equipment-subcategories-save").click();
    await expect(sheet).toHaveCount(0);
    library = await ok(page, "GET", base);
    const subs = Object.fromEntries(library.categories.find((row) => row.key === weapons.key).subcategories.map((row) => [row.label, row.key]));
    expect(Object.keys(subs)).toEqual(expect.arrayContaining(["Sturmgewehr", "Schrotflinte"]));

    // Waffen mit Bild: zwei ohne Unterkategorie (werden verschoben), eine Schrotflinte; ein Aufsatz für die ganze Klasse Sturmgewehr.
    const rifleA = await ok(page, "POST", base, { category: weapons.key, name: RIFLE_A, image_url: await upload(page, "sturm-a", [41, 182, 232]) });
    const rifleB = await ok(page, "POST", base, { category: weapons.key, name: RIFLE_B, image_url: await upload(page, "sturm-b", [0, 210, 106]) });
    await ok(page, "POST", base, { category: weapons.key, subcategory: subs.Schrotflinte, name: SHOTGUN, image_url: await upload(page, "flinte", [255, 159, 10]) });
    const sight = await ok(page, "POST", base, { category: attachments.key, name: SIGHT, weapon_class_ids: [subs.Sturmgewehr] });

    // Auswählen und nach „Sturmgewehr“ verschieben.
    await page.reload();
    await page.getByTestId("equipment-search").fill(stamp);
    await page.getByTestId("equipment-select-mode").click();
    await page.getByTestId(`equipment-select-${rifleA.id}`).check();
    await page.getByTestId(`equipment-select-${rifleB.id}`).check();
    await page.getByTestId("equipment-move-target").selectOption(subs.Sturmgewehr);
    await page.getByTestId("equipment-move").click();
    await expect(page.getByTestId(`equipment-sub-${subs.Sturmgewehr}`).getByTestId(`equipment-row-${rifleA.id}`)).toBeVisible();
    await page.getByTestId("equipment-move-cancel").click();
    await page.getByTestId("equipment-search").fill("");
    await expect(page.getByTestId(`equipment-row-${sight.id}`)).toContainText("passt zu Sturmgewehr (Klasse)");
    await page.getByTestId(`equipment-group-${weapons.key}`).scrollIntoViewIfNeeded();
    await noSideScroll(page);
    await shot(page, "bibliothek-gruppiert-1440.png");

    // 2. Season: ganze Klasse Schrotflinte sperren, Sturm B nur in einem Modus, den Aufsatz an Sturm A.
    await page.goto(`/admin/leagues/seasons/${seasonId}#sperrliste`);
    const panel = page.getByTestId("season-bans");
    await panel.getByTestId(`season-bans-class-${subs.Schrotflinte}-toggle`).check();
    await panel.getByTestId("season-bans-search").fill(stamp);
    await expect(panel.getByTestId(`season-bans-item-${rifleB.id}`)).toBeVisible();
    await panel.getByTestId(`season-bans-toggle-${rifleB.id}`).check();
    await panel.getByTestId(`season-bans-item-${rifleB.id}`).getByRole("checkbox", { name: "Stellung" }).first().check();
    await panel.getByTestId(`season-bans-open-${rifleA.id}`).click();
    await panel.getByTestId(`season-bans-attachments-${rifleA.id}`).getByRole("checkbox", { name: SIGHT }).check();
    await panel.getByTestId("season-bans-save").click();
    await expect(panel.getByTestId("season-bans-head")).toContainText(/Version \d+/);
    await panel.getByTestId("season-bans-search").fill("");
    await panel.getByTestId(`season-bans-class-${subs.Schrotflinte}`).scrollIntoViewIfNeeded();
    await noSideScroll(page);
    await shot(page, "season-sperrliste-1440.png");
    const listView = await ok(page, "GET", `/api/admin/leagues/seasons/${seasonId}/loadout-bans`);
    expect(listView.list.entries.some((row) => row.kind === "class" && row.subcategory === subs.Schrotflinte)).toBe(true);

    // 3. Regelwerk veröffentlichen: erlaubt ist Sturm A (ohne den Aufsatz), Sturm B außer in Stellung; Schrotflinte nicht erlaubt.
    const first = await publishWithBlock(page, seasonId, `Erlaubte Ausrüstung ${stamp}`);
    const data = first.frozen[seasonId].loadout_bans.data;
    expect(data.layout).toBe(3);
    const sections = Object.fromEntries(data.categories.find((row) => row.label === weapons.label).sections.map((row) => [row.label, row]));
    expect(sections.Schrotflinte.state).toBe("banned");
    expect(sections.Schrotflinte.banned).toContain(SHOTGUN);
    expect(sections.Sturmgewehr.entries.find((row) => row.name === RIFLE_B).not_in).toEqual(["Stellung"]);

    // 4. Neue Schrotflinte: mitgesperrt - das Regelwerk will freigegeben werden, der Vorschlag nennt sie.
    await ok(page, "POST", base, { category: weapons.key, subcategory: subs.Schrotflinte, name: SHOTGUN_NEW });
    await page.goto(`/admin/leagues/rules/league_season/${seasonId}`);
    const changes = page.getByTestId("rules-data-changes");
    await expect(changes).toContainText(SHOTGUN_NEW);
    await shot(page, "regelwerk-vorschlag-1440.png");
    const admin = await ok(page, "GET", `/api/admin/league-rules/league_season/${seasonId}`);
    expect(admin.proposal?.fingerprint).toBeTruthy();
    await ok(page, "POST", `/api/admin/league-rules/league_season/${seasonId}/proposal/publish`, {
      base_version_id: first.id, fingerprint: admin.proposal.fingerprint, valid_from: viennaToday(), change_reason: `Neue Schrotflinte ${stamp}`,
      requires_consent: false, confirm_empty: true });
    expect(problems).toEqual([]);
    await context.close();
  });

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Gast: Ligaseite und Regelwerk zeigen die erlaubte Ausrüstung (${width} px)`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width, height }, locale: "de-AT", timezoneId: "Europe/Vienna" });
      const page = await context.newPage();
      await signIn(page, "anon");
      const problems = watch(page);
      const { league, season } = anmeldung;
      await page.goto(`/liga/${league.slug}/${season.slug}`);
      const block = page.getByTestId("league-allowed-equipment");
      await expect(block.getByTestId("allowed-entry").filter({ hasText: RIFLE_B })).toContainText("nicht in Stellung");
      await expect(block.getByTestId("allowed-entry").filter({ hasText: SIGHT })).toContainText(`nicht an ${RIFLE_A}`);
      await expect(block.getByTestId("allowed-banned-names").first()).toContainText(SHOTGUN_NEW);
      await expect(block.getByTestId("allowed-entry").filter({ hasText: SHOTGUN })).toHaveCount(0);
      await block.getByTestId("allowed-entry").filter({ hasText: RIFLE_A }).first().scrollIntoViewIfNeeded();
      await noSideScroll(page);
      await shot(page, `ligaseite-erlaubt-${width}.png`);

      await page.goto(`/liga/${league.slug}/${season.slug}/regeln`);
      const annex = page.locator("[id^='anlage-']").filter({ hasText: RIFLE_A }).first();
      await expect(annex).toContainText("nicht erlaubt");
      await expect(annex.locator("img[alt='Ausrüstung']").first()).toBeVisible();
      await annex.getByText(RIFLE_A).first().scrollIntoViewIfNeeded();
      await noSideScroll(page);
      await shot(page, `regelwerk-web-${width}.png`);
      if (SHOTS && width === 1440) {
        const href = await page.getByTestId("rules-pdf").getAttribute("href");
        const pdf = await page.request.get(href);
        expect(pdf.headers()["content-type"]).toContain("application/pdf");
        fs.writeFileSync(path.join(SHOTS, "regelwerk.pdf"), await pdf.body());
      }
      expect(problems).toEqual([]);
      await context.close();
    });
  }
});
