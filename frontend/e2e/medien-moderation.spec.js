const { test, expect } = require("@playwright/test");

// Medien und Moderation (#2122 Teil K2), Stationen (#2112) bei 390 und 1440 px: erreichbar, ohne seitliches Scrollen, und
// die Knöpfe schicken, was sie sollen. Die API ist eine Attrappe; die Namen sind erfunden, die Bilder synthetisch.

const WIDTHS = [["handy", 390, 844], ["pc", 1440, 900]];
const ADMIN = { id: "u-root", username: "root", display_name: "Sam Admin", role: "superadmin",
  areas: ["tournaments", "content", "club", "finance", "system", "moderation"], mfa_enabled: true, auth_mfa_verified: true };
const SHOTS = process.env.E2E_SHOTS || "";
const LONG_NAME = "ein-sehr-langer-dateiname-ohne-leerzeichen-der-nicht-umbrechen-will-0123456789abcdef.webp";

const mediaItem = (filename, extra = {}) => ({ filename, url: `/logo192.png?f=${filename}`, ext: "webp", size: 2048, mtime: "2026-09-01T10:00:00Z", media_type: "image",
  media_scope: "admin", tracked: true, usage_count: 0, references: [], is_unused: true, duplicate_count: 0, duplicate_filenames: [], width: 800, height: 400, ...extra });
const MEDIA_ITEMS = [
  mediaItem(LONG_NAME),
  mediaItem("kopie.webp", { usage_count: 3, is_unused: false, duplicate_count: 2, duplicate_filenames: ["kopie.webp", "zwilling.webp"], references: [{ collection: "news_posts", id: "n-1", field: "banner_url", place: "News · Banner", label: "Herbst-LAN" }] }),
];
const AUDIT = { total: 130, unused: 12, untracked: 1, duplicate_files: 2, metadata_missing_files: 0, by_scope: { admin: 128, legacy: 2 }, reference_summary: {}, summary: {} };
const ALBUM = { id: "a-1", title: "Herbst-LAN", slug: "herbst-lan", visibility: "members", published: true, media_count: 2 };
const PHOTOS = [
  { id: "ph-1", album_id: "a-1", media_type: "image", source_type: "upload", image_url: "/logo192.png", thumbnail_url: "/logo192.png", caption: "IMG_0042", order_index: 1, section_id: null },
  { id: "ph-2", album_id: "a-1", media_type: "image", source_type: "upload", image_url: "/logo192.png", thumbnail_url: "/logo192.png", caption: "IMG_0043", order_index: 2, section_id: null },
];
const SECTIONS = [{ id: "s-1", title: "Siegerehrung", order_index: 1 }];
const REPORT = { id: "r-1", category: "harassment", status: "open", details: "Beleidigt mich seit Tagen im Chat, auch mit sehr langen Texten ohne Ende.", target_user_id: "u-rohe-kennung",
  target_user: { id: "u-rohe-kennung", display_name: "Paula Beispiel" }, reporter_id: "u-otto", reporter: { username: "otto" }, message_id: "m-1", message_excerpt: "Du Noob!", created_at: "2026-10-20T10:00:00Z" };
const STATION = { id: "st-1", name: "Tisch 1", device_type: "switch2", status: "free", notes: "Alt", game_id: null, current_match_id: null, tournament_id: "t-1" };

const PAGE_DATA = {
  "/api/admin/media/audit": AUDIT,
  "/api/admin/media/unused": { count: 12, total_size: 4096, filenames: ["a.webp", "b.webp"], batch: 500, min_age_hours: 24 },
  "/api/uploads/limits": { image_mb: 37, video_mb: 900, document_mb: 20, svg_mb: 2 },
  "/api/admin/gallery": [ALBUM],
  "/api/admin/gallery/a-1": { sections: SECTIONS, photos: PHOTOS },
  "/api/moderation/reports": [REPORT],
  "/api/tournaments": [{ id: "t-1", title: "Winter-Cup", status: "live", event_mode: "local" }],
  "/api/stations": [STATION],
  "/api/tournaments/t-1/bracket": { tournament: { id: "t-1", title: "Winter-Cup" }, matches_v2: [], registrations: [], stages: [] },
  "/api/games": [{ id: "g-1", name: "Mario Kart" }],
};

async function mockApi(page, calls) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() !== "GET") {
      calls.push({ method: request.method(), path, body: request.postDataJSON() });
      return json({ ok: true, count: 1, deleted: 2, skipped: 0, removed: 1, references: 3, url: "/logo192.png?v=7", width: 400, height: 800 });
    }
    if (path === "/api/auth/me") return json(ADMIN);
    if (path === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (path === "/api/admin/media") {
      calls.push({ method: "GET", path, query: url.search });
      const needle = url.searchParams.get("q");
      if (needle) return json({ items: [mediaItem("uralt.webp")], total: 1, total_size: 2048, limit: 60, offset: 0 });
      return json({ items: MEDIA_ITEMS, total: 130, total_size: 262144, limit: 60, offset: Number(url.searchParams.get("offset") || 0) });
    }
    if (path in PAGE_DATA) return json(PAGE_DATA[path]);
    const list = /notifications|games$|nav$|site-banners|sponsors|partners|times$|staff$|events$|teams$|seasons$|submissions|links$|media$|uploads\/events|achievements\/(groups|tiers)/.test(path);
    return json(list ? [] : {});
  });
}

async function overflow(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
}

async function shot(page, name, width) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/medien-${name}-${width}.png`, fullPage: true });
}

async function confirmDialog(page) {
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.getByTestId("confirm-dialog-confirm").click();
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
      await page.setViewportSize({ width, height });
    });

    test("Mediathek: Seiten, Suche am Server, Begriffe auf Deutsch", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/media");
      await expect(page.getByTestId("media-page-label")).toHaveText("Seite 1 von 3");
      await expect(page.getByTestId("media-grid")).toBeVisible();
      await expect(page.locator("body")).not.toContainText("Legacy");
      await expect(page.locator("body")).not.toContainText("Ungetrackt");
      await expect(page.locator("body")).not.toContainText("Scope");
      await shot(page, "mediathek", width);
      expect(await overflow(page)).toBeLessThanOrEqual(2);

      await page.getByTestId("media-page-next").click();
      await expect(page.getByTestId("media-page-label")).toHaveText("Seite 2 von 3");
      await expect.poll(() => calls.some((call) => call.path === "/api/admin/media" && call.query.includes("offset=60"))).toBe(true);

      await page.getByTestId("media-search").fill("uralt");
      await expect(page.getByTestId("media-tile-uralt.webp")).toBeVisible();
      expect(calls.some((call) => call.path === "/api/admin/media" && call.query.includes("q=uralt") && call.query.includes("offset=0"))).toBe(true);
    });

    test("Mediathek: Ungenutzte löschen fragt nach und schickt genau die Liste", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/media");
      await page.getByTestId("media-cleanup-unused").click();
      await expect(page.getByTestId("confirm-dialog")).toContainText("letzten 24 Stunden");
      await shot(page, "aufraeumen", width);
      await confirmDialog(page);
      await expect.poll(() => calls.find((call) => call.path === "/api/admin/media/cleanup-unused")?.body).toEqual({ filenames: ["a.webp", "b.webp"] });
    });

    test("Mediathek: Drehen fragt nach, Duplikat ersetzen geht aus dem Blatt", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/media");
      await page.getByTestId("media-tile-kopie.webp").click();
      await expect(page.getByTestId("media-sheet-dimensions")).toHaveText("800 × 400 px");
      await shot(page, "blatt", width);
      expect(await overflow(page)).toBeLessThanOrEqual(2);

      await page.getByTestId("media-rotate-right").click();
      await expect(page.getByTestId("confirm-dialog")).toContainText("an 3 Stellen");
      await confirmDialog(page);
      await expect.poll(() => calls.find((call) => call.path === "/api/admin/media/kopie.webp/rotate")?.body).toEqual({ degrees: 90 });
      await expect(page.getByTestId("media-sheet-dimensions")).toHaveText("400 × 800 px");

      await page.getByTestId("media-duplicate-keep").click();
      await expect(page.getByTestId("confirm-dialog")).toContainText("„kopie.webp“ bleibt");
      await confirmDialog(page);
      await expect.poll(() => calls.find((call) => call.path === "/api/admin/media/duplicates/replace")?.body).toEqual({ keep: "kopie.webp" });
    });

    test("Bildfeld: Grenze vom Server und Auswahl mit Suche", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/gallery");
      await page.getByTestId("album-new").click();
      await expect(page.getByTestId("album-cover-hint")).toHaveText("PNG/JPG/WebP bis 37 MB. SVG geht nicht.");
      await page.getByTestId("album-cover-library").click();
      await expect(page.getByTestId("album-cover-library-count")).toHaveText("2 von 130");
      await shot(page, "bildauswahl", width);
      expect(calls.some((call) => call.path === "/api/admin/media" && call.query.includes("exclude_svg=true") && call.query.includes("paged=true"))).toBe(true);
      await page.getByTestId("album-cover-library-search").fill("uralt");
      await expect(page.getByTitle("uralt.webp")).toBeVisible();
    });

    test("Galerie: Häkchen, Sammelaktion, Worte statt Rohwerte", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/gallery");
      await expect(page.getByText("Nur Mitglieder · Veröffentlicht")).toBeVisible();
      await page.getByTestId("album-open-a-1").click();
      await page.getByTestId("gallery-photo-check-ph-1").check();
      await page.getByTestId("gallery-photo-check-ph-2").check();
      await expect(page.getByTestId("gallery-bulk-count")).toHaveText("2 von 2 ausgewählt");
      await shot(page, "galerie", width);
      expect(await overflow(page)).toBeLessThanOrEqual(2);

      await page.getByTestId("gallery-bulk-remove").click();
      await expect(page.getByTestId("confirm-dialog")).toContainText("Dateien bleiben in den Medien");
      await confirmDialog(page);
      await expect.poll(() => calls.find((call) => call.path === "/api/gallery/a-1/photos/bulk")?.body).toEqual({ ids: ["ph-1", "ph-2"], action: "delete" });

      await page.getByTestId("photo-media-picker").click();
      await page.getByTestId("gallery-media-search").fill("uralt");
      await expect(page.getByTitle("uralt.webp")).toBeVisible();
    });

    test("Moderation: Knöpfe mit Grund statt sofortiger Auswahl", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/moderation");
      const card = page.getByTestId("report-r-1");
      await expect(card).toContainText("Belästigung");
      await expect(card).toContainText("Gegen Paula Beispiel");
      await expect(card).not.toContainText("rohe-kennung");
      await page.getByTestId("report-step-justified-r-1").click();
      await expect(page.getByTestId("report-decision-r-1")).toContainText("Zählt als Treffer gegen Paula Beispiel");
      await expect(page.getByTestId("report-save-r-1")).toBeDisabled();
      await shot(page, "moderation", width);
      expect(await overflow(page)).toBeLessThanOrEqual(2);
      await page.getByTestId("report-reason-r-1").fill("Beleidigung bestätigt");
      await page.getByTestId("report-save-r-1").click();
      await expect.poll(() => calls.find((call) => call.path === "/api/moderation/reports/r-1")?.body).toEqual({ status: "justified", resolution_note: "Beleidigung bestätigt" });
    });

    test("Station bearbeiten", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/stations");
      await page.getByTestId("station-edit-st-1").click();
      await expect(page.getByTestId("station-edit-name")).toHaveValue("Tisch 1");
      await page.getByTestId("station-edit-name").fill("Tisch 7");
      await page.getByTestId("station-edit-device").selectOption("pc");
      await page.getByTestId("station-edit-game").selectOption("g-1");
      await shot(page, "station", width);
      expect(await overflow(page)).toBeLessThanOrEqual(2);
      await page.getByTestId("station-edit-save").click();
      await expect.poll(() => calls.find((call) => call.path === "/api/stations/st-1")?.body).toEqual({ name: "Tisch 7", device_type: "pc", game_id: "g-1", notes: "Alt" });
    });
  });
}
