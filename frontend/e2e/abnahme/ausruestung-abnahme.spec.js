const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Ausrüstung und Sperrliste (#2218, docs/LIGA.md „C.4 Ausrüstung“) gegen den echten Server, ohne nachgestellte API. Stand aus
// scripts/seed_abnahme_liga.py (ABNAHME_STATE auf dessen Stand-Datei): Spiel „Call of Duty“ und die öffentliche Season der
// Liga-Anmeldung mit Regelwerk und Staffel A.
// 1. Bibliothek: eine Waffe mit synthetischem Bild, zwei Aufsätze dazu - einer ohne Waffe (Hinweis, Zuordnung in einem Schritt), einer im
//    Browser angelegt.
// 2. Season: Sperrliste im Browser setzen (Waffe nur in einem Modus, ein Aufsatz an der Waffe), auf die Staffel übertragen.
// 3. Regelwerk mit Baustein „Sperrliste“ in Anlage A veröffentlichen; danach die Liste ändern - der Abschnitt meldet „alte Liste“,
//    das Regelwerk schlägt eine neue Version mit markierten Unterschieden vor, sie wird mit neuer Zustimmung veröffentlicht.
// 4. Gast bei 390 und 1440 px: Ligaseite und Regelwerk zeigen die Liste mit Bild, das PDF ohne Bild-Markdown.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const stamp = Date.now().toString(36);
const game = state?.game;
const anmeldung = state?.anmeldung;
const WEAPON = `Probewaffe ${stamp}`;
const SCOPE = `Probevisier ${stamp}`;
const GRIP = `Probegriff ${stamp}`;
const PERK = `Probeperk ${stamp}`;

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
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

/** Ein erfundenes Bild: 160 x 90 Pixel, zwei Farbflächen - als echtes PNG. */
function syntheticPng() {
  const width = 160;
  const height = 90;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const left = x < width / 2;
      row.set(left ? [41, 182, 232] : [24, 24, 28], 1 + x * 3);
    }
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

function viennaToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Vienna" }).format(new Date());
}

async function publishWithBlock(page, seasonId, reason, consent) {
  const scope = `/api/admin/league-rules/league_season/${seasonId}`;
  const view = await ok(page, "GET", scope);
  const draft = view.draft || await ok(page, "POST", `${scope}/draft/from-version`, {});
  const annexes = (draft.annexes || []).map(({ title, body_md }) => ({ title, body_md }));
  if (!annexes.some((row) => row.body_md.includes("[[baustein:loadout_bans]]"))) annexes.unshift({ title: "Sperrliste", body_md: "[[baustein:loadout_bans]]" });
  const saved = await ok(page, "PUT", `${scope}/draft`, { title: draft.title || "Regelwerk", body_md: draft.body_md || "# Fairplay\nFair spielen.", annexes, revision: draft.revision });
  return ok(page, "POST", `${scope}/publish`, { revision: saved.revision, valid_from: viennaToday(), change_reason: reason, requires_consent: consent });
}

test.describe("Abnahme: Ausrüstung und Sperrliste gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !(game && anmeldung), `Kein Liga-Stand in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py laufen lassen und ABNAHME_STATE auf dessen Stand-Datei setzen`);
  test.describe.configure({ mode: "serial", timeout: 300_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  test("Bibliothek, Sperrliste der Season, Regelwerk mit neuer Version (1440 px)", async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 1440, height: 900 }, locale: "de-AT", timezoneId: "Europe/Vienna" });
    const page = await context.newPage();
    await signIn(page, "admin");
    const problems = watch(page);
    const seasonId = anmeldung.season.id;
    const base = `/api/games/${game.id}/equipment`;

    // 1. Kategorien (Vorschlag, wenn es noch keine gibt), Waffe mit Bild, ein Aufsatz und ein Perk über die API.
    let library = await ok(page, "GET", base);
    if (!library.categories.length) await ok(page, "PUT", `${base}/categories`, { categories: library.suggested_categories });
    library = await ok(page, "GET", base);
    const role = (name) => library.categories.find((row) => row.role === name);
    const upload = await page.request.post("/api/uploads/image?media_scope=admin", {
      headers: await csrfHeaders(page), multipart: { file: { name: `probewaffe-${stamp}.png`, mimeType: "image/png", buffer: syntheticPng() } } });
    expect(upload.status(), await upload.text()).toBe(200);
    const imageUrl = (await upload.json()).url;
    const weapon = await ok(page, "POST", base, { category: role("weapon").key, name: WEAPON, image_url: imageUrl });
    await ok(page, "POST", base, { category: role("attachment").key, name: GRIP, weapon_ids: [] });
    const perk = await ok(page, "POST", base, { category: role("item").key, name: PERK });

    // Der zweite Aufsatz im Browser: Seitenblatt, Waffe suchen und wählen.
    // Einstieg über die Spielseite: Reiter „Ausrüstung“ (#2249); die alte Adresse leitet dorthin.
    await page.goto(`/admin/games/${game.id}`);
    await page.getByTestId("game-tab-ausruestung").click();
    await expect(page).toHaveURL(/#ausruestung$/);
    // Ohne Waffe passt der Griff zu keiner (Obmann, 03.11.): Der Hinweis nennt ihn, ein Schritt ordnet ihn der Waffe zu.
    const notice = page.getByTestId("equipment-without-weapon");
    await expect(notice).toContainText(GRIP);
    await notice.getByTestId(`equipment-assign-${weapon.id}`).check();
    await notice.getByTestId("equipment-assign").click();
    await expect(notice).toHaveCount(0);
    await page.getByTestId(`equipment-add-${role("attachment").key}`).click();
    const sheet = page.getByTestId("equipment-sheet");
    await sheet.getByTestId("equipment-name").fill(SCOPE);
    const search = sheet.getByPlaceholder("Waffe suchen");
    if (await search.count()) await search.fill(WEAPON);
    await sheet.getByRole("checkbox", { name: WEAPON }).check();
    await sheet.getByTestId("equipment-save").click();
    await page.getByTestId("equipment-search").fill(stamp);
    await expect(page.getByText(`passt zu ${WEAPON}`)).toHaveCount(2);
    await expect(page.getByTestId(`equipment-row-${weapon.id}`).locator("img")).toHaveAttribute("src", /uploads/);
    await noSideScroll(page);
    await shot(page, "ausruestung-bibliothek-abnahme.png");

    // 2. Sperrliste der Season im Browser: Waffe nur in „Stellung“, an ihr der neue Aufsatz; speichern und übertragen.
    await page.goto(`/admin/leagues/seasons/${seasonId}`);
    const panel = page.getByTestId("season-bans");
    await panel.getByTestId("season-bans-search").fill(stamp);
    await panel.getByTestId(`season-bans-toggle-${weapon.id}`).check();
    await panel.getByTestId(`season-bans-item-${weapon.id}`).getByRole("checkbox", { name: "Stellung" }).first().check();
    await panel.getByTestId(`season-bans-open-${weapon.id}`).click();
    await panel.getByTestId(`season-bans-attachments-${weapon.id}`).getByRole("checkbox", { name: SCOPE }).check();
    await panel.getByTestId("season-bans-save").click();
    await expect(panel.getByTestId("season-bans-head")).toContainText(/Version \d+/);
    await page.getByTestId("season-sync-now").click();
    await expect(page.getByTestId("sync-results")).toContainText("Sperrliste");
    const listView = await ok(page, "GET", `/api/admin/leagues/seasons/${seasonId}/loadout-bans`);
    const saved = listView.list.entries.filter((row) => row.item_id === weapon.id);
    expect(saved.map((row) => [row.kind, row.mode_labels.length, row.attachments.map((item) => item.name)]))
      .toEqual([["item", 1, []], ["attachments", 0, [SCOPE]]]);

    // 3. Regelwerk mit Baustein, dann die Liste ändern: Hinweis und Vorschlag einer neuen Version mit markierten Unterschieden.
    const first = await publishWithBlock(page, seasonId, `Sperrliste ${stamp} aufgenommen`, false);
    expect(JSON.stringify(first.frozen)).toContain(WEAPON);
    expect(first.frozen_images).toContain(imageUrl);
    await page.reload();
    await expect(panel.getByTestId("season-bans-rules-ok")).toBeVisible();
    await panel.getByTestId("season-bans-search").fill(stamp);
    await panel.getByTestId(`season-bans-toggle-${perk.id}`).check();
    await panel.getByTestId("season-bans-save").click();
    await expect(panel.getByTestId("season-bans-rules-outdated")).toBeVisible();
    await panel.getByTestId("season-bans-rules-outdated").scrollIntoViewIfNeeded();
    await shot(page, "sperrliste-season-abnahme.png");
    await panel.getByRole("link", { name: "Neue Version vorbereiten" }).click();
    const changes = page.getByTestId("rules-data-changes");
    await expect(changes).toContainText("Sperrliste");
    await expect(changes).toContainText(PERK);
    await shot(page, "sperrliste-regelwerk-vorschlag-abnahme.png");
    const second = await publishWithBlock(page, seasonId, `Sperrliste ${stamp} ergänzt`, true);
    expect(second.requires_consent).toBe(true);
    expect(JSON.stringify(second.frozen)).toContain(PERK);
    expect(JSON.stringify(first.frozen)).not.toContain(PERK);
    await page.goto(`/admin/leagues/seasons/${seasonId}`);
    await expect(page.getByTestId("season-bans-rules-ok")).toBeVisible();
    expect(problems).toEqual([]);
    await context.close();
  });

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Gast: Ligaseite und Regelwerk zeigen die Liste (${width} px)`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width, height }, locale: "de-AT", timezoneId: "Europe/Vienna" });
      const page = await context.newPage();
      await signIn(page, "anon");
      const problems = watch(page);
      const { league, season } = anmeldung;
      await page.goto(`/liga/${league.slug}/${season.slug}`);
      const block = page.getByTestId("league-loadout-bans");
      await expect(block).toContainText(WEAPON);
      await expect(block).toContainText("nur ");
      await expect(block.getByTestId("loadout-ban-weapon").filter({ hasText: WEAPON })).toContainText(SCOPE);
      await block.scrollIntoViewIfNeeded();
      await noSideScroll(page);
      await shot(page, `sperrliste-ligaseite-${width}-abnahme.png`);

      await page.goto(`/liga/${league.slug}/${season.slug}/regeln`);
      await expect(page.getByText(WEAPON).first()).toBeVisible();
      await expect(page.locator(`img[alt="${WEAPON}"]`).first()).toBeVisible();
      await noSideScroll(page);
      await page.locator(`img[alt="${WEAPON}"]`).first().scrollIntoViewIfNeeded();
      await shot(page, `sperrliste-regelwerk-${width}-abnahme.png`);
      const href = await page.getByTestId("rules-pdf").getAttribute("href");
      const pdf = await page.request.get(href);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()["content-type"]).toContain("application/pdf");
      expect(problems).toEqual([]);
      await context.close();
    });
  }
});
