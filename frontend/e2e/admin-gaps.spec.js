const { test, expect } = require("@playwright/test");

// Admin-Lücken (#2112): die neuen Knöpfe und Blätter bei 390 und 1440 px - erreichbar, ohne seitliches Scrollen, und sie
// schicken, was sie sollen. Die API ist eine Attrappe; Geheimnisse kommen hier nicht vor.

const WIDTHS = [["handy", 390, 844], ["pc", 1440, 900]];
const ADMIN = { id: "u-root", username: "root", display_name: "Sam Admin", role: "superadmin",
  areas: ["tournaments", "content", "club", "finance", "system", "moderation"], mfa_enabled: true, auth_mfa_verified: true };
const SHOTS = process.env.E2E_SHOTS || "";

const CHALLENGE = { id: "c-1", slug: "monza", title: "Monza Sprint", status: "draft", visibility: "public", tracks: [{ id: "tr-1", name: "Monza" }] };
const GUESTS = [
  { id: "g-1", challenge_id: "c-1", display_name: "Anna mit einem ziemlich langen Spitznamen", number: 1, has_times: true },
  { id: "g-2", challenge_id: "c-1", display_name: "Ben", number: 2, has_times: false },
];
const PACKS = [{ id: "p-1", name: "Vereinsmomente", builtin: false, active: true, stickers: [
  { id: "s-1", pack_id: "p-1", name: "Pokal", keywords: ["sieg"], url: "/logo192.png", sort_order: 0 },
] }];
const PRIZES = [{ id: "pr-1", tournament_id: "t-1", tournament_title: "Winter-Cup", place: 1, prize_label: "Gutschein", prize_value: "20 €",
  status: "pending", pickup_deadline: null, recipient_type: "user", recipient_label: "Erika", recipient_subtitle: "erika", display_name: "Erika" }];
const USERS = [{ id: "u-1", username: "erika", display_name: "Erika Beispiel", email: "erika@example.test", role: "player", areas: [], ban_protected: false }];
const ALBUM = { id: "a-1", title: "Herbst-LAN", slug: "herbst-lan", visibility: "public", published: true, media_count: 1 };
const PHOTO = { id: "ph-1", album_id: "a-1", media_type: "image", source_type: "upload", image_url: "/logo192.png", thumbnail_url: "/logo192.png",
  caption: "IMG_0042", order_index: 1, section_id: null };
const EVENTS = { items: [{ id: "d-1", source: "email", source_label: "E-Mail-Versand", href: "/admin/ops?tab=events&source=email", severity: "error",
  status: "failed", time: "2026-10-28T10:00:00Z", title: "news", subtitle: "discord · LION", detail: "Missing Access", resendable: true }],
sources: [{ key: "email", label: "E-Mail-Versand", total: 1, problem_count: 1 }], summary: { shown: 1, problem_count: 1 } };

const PAGE_DATA = {
  "/api/f1/challenges": [CHALLENGE],
  "/api/f1/challenges/c-1": CHALLENGE,
  "/api/f1/challenges/c-1/guests": GUESTS,
  "/api/stickers/admin": { packs: PACKS, source: null },
  "/api/prizes": PRIZES,
  "/api/tournaments": [{ id: "t-1", title: "Winter-Cup" }],
  "/api/users": USERS,
  "/api/admin/gallery": [ALBUM],
  "/api/admin/gallery/a-1": { sections: [], photos: [PHOTO] },
  "/api/admin/dolibarr/status": { mode: "preview", environment: "production", base_url: "https://erp.example.test", instance: "verein", entity: 1,
    api_key_configured: true, write_api_key_configured: true, features: [], type_map: {}, website_types: [], links: {}, sync: {}, policy: { map: {} } },
  "/api/settings/amp": { base_url: "https://amp.example.test", username: "website", enabled: true, configured: true },
  "/api/game-servers/admin": [],
  "/api/admin/ops/events": EVENTS,
  "/api/admin/achievements/overview": { unlocks_7d: 1, unlocks_30d: 2, users_total: 3, users_without_award: 1, prestige_holders: 0, levels: {}, per_category_30d: {}, queue: {}, catalog: {} },
  "/api/admin/achievements/me": { board: true },
};

async function mockApi(page, calls) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() !== "GET") {
      calls.push({ method: request.method(), path, body: request.postDataJSON() });
      if (path === "/api/admin/awards/rebuild") return json({ tournaments: 4, awards: 11 });
      return json({ ok: true });
    }
    if (path === "/api/auth/me") return json(ADMIN);
    if (path === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (path in PAGE_DATA) return json(PAGE_DATA[path]);
    const list = /notifications|games$|nav$|site-banners|sponsors|partners|times$|staff$|events$|teams$|seasons$|submissions|links$|media$|achievements\/(groups|tiers)/.test(path);
    return json(list ? [] : {});
  });
}

async function overflow(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
}

async function shot(page, name, width) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-gaps-${name}-${width}.png`, fullPage: true });
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

    test("Fast Lap: Entwurf löschen und Gast ohne Zeiten löschen", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/f1/c-1");
      await expect(page.getByTestId("f1-guests-panel")).toBeVisible();
      await expect(page.getByTestId("f1-guest-delete-g-1")).toHaveCount(0);
      await shot(page, "fastlap", width);
      expect(await overflow(page)).toBeLessThanOrEqual(2);
      await page.getByTestId("f1-guest-delete-g-2").click();
      await confirmDialog(page);
      await expect.poll(() => calls.some((call) => call.method === "DELETE" && call.path === "/api/f1/guests/g-2")).toBe(true);
      await page.getByTestId("f1-delete-challenge").click();
      await confirmDialog(page);
      await expect.poll(() => calls.some((call) => call.method === "DELETE" && call.path === "/api/f1/challenges/c-1")).toBe(true);
      await expect(page).toHaveURL(/\/admin\/f1$/);
    });

    test("Sticker bearbeiten", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/stickers");
      await page.getByTestId("sticker-edit-s-1").click();
      await page.getByTestId("sticker-name").fill("Großer Pokal");
      await shot(page, "sticker", width);
      expect(await overflow(page)).toBeLessThanOrEqual(2);
      await page.getByTestId("sticker-save").click();
      await expect.poll(() => calls.find((call) => call.path === "/api/stickers/admin/stickers/s-1")?.body).toEqual({ name: "Großer Pokal", keywords: ["sieg"], sort_order: 0 });
    });

    test("Gewinn hinzufügen und bearbeiten", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/prizes");
      await page.getByTestId("prizes-add").click();
      await expect(page.getByTestId("prize-form-sheet")).toBeVisible();
      await shot(page, "prize-add", width);
      expect(await overflow(page)).toBeLessThanOrEqual(2);
      await page.keyboard.press("Escape");
      await page.getByTestId(width < 768 ? "prize-mobile-edit-pr-1" : "prize-edit-pr-1").click();
      await page.getByTestId("prize-form-label").fill("Gutschein Gaming-Shop");
      await page.getByTestId("prize-form-save").click();
      await expect.poll(() => calls.find((call) => call.path === "/api/prizes/pr-1")?.body).toEqual({ prize_label: "Gutschein Gaming-Shop", prize_value: "20 €" });
    });

    test("Benutzer: Profil zurücksetzen", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/users");
      await page.getByTestId(width < 1024 ? "user-edit-card-erika" : "user-edit-erika").click();
      const section = page.getByTestId("user-sheet-profile-reset");
      await section.getByTestId("user-sheet-reset-display_name").check();
      await section.getByTestId("user-sheet-reset-reason").fill("Beleidigender Name");
      await section.scrollIntoViewIfNeeded();
      await shot(page, "user-reset", width);
      expect(await overflow(page)).toBeLessThanOrEqual(2);
      await section.getByTestId("user-sheet-reset").click();
      await confirmDialog(page);
      await expect.poll(() => calls.find((call) => call.method === "PATCH" && call.path === "/api/users/u-1")?.body).toEqual({ reset: ["display_name"], reason: "Beleidigender Name" });
    });

    test("Galerie: Beschriftung und Reihenfolge", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/gallery");
      await page.getByTestId("album-open-a-1").click();
      await page.getByTestId("gallery-photo-edit-ph-1").click();
      await page.getByTestId("gallery-photo-caption").fill("Siegerehrung");
      await shot(page, "gallery", width);
      expect(await overflow(page)).toBeLessThanOrEqual(2);
      await page.getByTestId("gallery-photo-save").click();
      await expect.poll(() => calls.find((call) => call.path === "/api/gallery/photos/ph-1")?.body).toEqual({ caption: "Siegerehrung", order_index: 1 });
    });

    test("Dolibarr: Schlüssel entfernen", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/dolibarr?tab=connection");
      await page.getByTestId("dolibarr-key-remove").click();
      await confirmDialog(page);
      await expect.poll(() => calls.some((call) => call.method === "DELETE" && call.path === "/api/admin/dolibarr/settings/api-key")).toBe(true);
      await shot(page, "dolibarr", width);
      expect(await overflow(page)).toBeLessThanOrEqual(2);
    });

    test("Game-Server: AMP-Zugang", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/game-servers");
      await page.getByTestId("amp-panel-toggle").click();
      await expect(page.getByTestId("amp-base-url")).toHaveValue("https://amp.example.test");
      await shot(page, "amp", width);
      expect(await overflow(page)).toBeLessThanOrEqual(2);
      await page.getByTestId("amp-save").click();
      await expect.poll(() => calls.find((call) => call.path === "/api/settings/amp")?.body).toEqual({ base_url: "https://amp.example.test", username: "website", enabled: true });
    });

    test("Betrieb: Discord-Meldung erneut senden", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/ops?tab=events");
      await page.getByTestId("ops-event-resend-d-1").click();
      await expect.poll(() => calls.some((call) => call.path === "/api/settings/discord/resend/d-1")).toBe(true);
      await shot(page, "ops", width);
      expect(await overflow(page)).toBeLessThanOrEqual(2);
    });

    test("Erfolge: Pokale nachtragen", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/achievements");
      await page.getByTestId("ach-awards-rebuild").click();
      await expect.poll(() => calls.some((call) => call.path === "/api/admin/awards/rebuild")).toBe(true);
      await expect(page.getByText("4 Turniere geprüft, 11 Pokale und Banner stehen.")).toBeVisible();
      await shot(page, "awards", width);
      expect(await overflow(page)).toBeLessThanOrEqual(2);
    });
  });
}
