const { test, expect } = require("@playwright/test");

// Kanal einer News (#1532): im Editor „Wo erscheint der Beitrag?“ unter der Sichtbarkeit, in der Liste ein Schild „Nur App“
// bzw. „Nur Website“, und auf der Website bei „Nur App“ der Hinweis auf die LionsAPP statt „nicht gefunden“.
// Bei 390 und 1440 px, ohne seitliches Scrollen. Alles gegen Attrappen, nichts wird verschickt.

const WIDTHS = [["handy", 390, 844], ["pc", 1440, 900]];
const EDITOR = { id: "u-red", username: "rita", display_name: "Rita Redaktion", role: "club_admin", areas: ["content"], mfa_enabled: true, auth_mfa_verified: true };
const NOW = new Date().toISOString();
const POSTS = [
  { id: "n-1", slug: "herbst-lan", title: "Herbst-LAN im Vereinsheim", category: "club", visibility: "public", published: true, published_at: NOW, channels: ["web", "app"], can_delete: false },
  { id: "n-2", slug: "app-update", title: "LionsAPP 1.9.4 ist da", category: "announcement", visibility: "public", published: true, published_at: NOW, channels: ["app"], can_delete: false },
  { id: "n-3", slug: "sitzung", title: "Einladung zur Jahreshauptversammlung", category: "club", visibility: "members", published: true, published_at: NOW, channels: ["web"], can_delete: false },
  { id: "n-4", slug: "alt", title: "Rückblick Sommerturnier", category: "recap", visibility: "public", published: true, published_at: NOW, can_delete: false },
];
const PLAY = "https://play.google.com/store/apps/details?id=at.lionsquad.app";

async function mockApi(page, state, { user = EDITOR } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    // Die Website meldet sich bei jedem Aufruf als „web“.
    if (url.pathname.startsWith("/api/news")) state.channelHeaders = [...(state.channelHeaders || []), request.headers()["x-lsw-channel"]];
    if (request.method() === "POST" && url.pathname === "/api/news") {
      state.created = request.postDataJSON();
      return json({ id: "n-new", ...state.created });
    }
    if (request.method() === "POST" && url.pathname === "/api/settings/discord/preview") {
      const appOnly = JSON.stringify(request.postDataJSON()?.item?.channels) === JSON.stringify(["app"]);
      return json({ would_send: !appOnly, reason: appOnly ? "app_only" : null, embed: {}, buttons: [] });
    }
    if (request.method() !== "GET") return json({ ok: true });
    if (url.pathname === "/api/auth/me") return user ? json(user) : json({ detail: "nicht angemeldet" }, 401);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at", play_store_url: PLAY });
    if (url.pathname === "/api/news-meta") return json({ categories: [{ k: "club", l: "Verein" }, { k: "announcement", l: "Ankündigung" }, { k: "recap", l: "Rückblick" }], visibilities: [{ k: "public", l: "Öffentlich" }, { k: "members", l: "Nur Vereinsmitglieder" }], in_use: [] });
    if (url.pathname === "/api/settings/newsletter/audience") return json({ kind: "news", visibility: "public", internal: false, recipients: 214, announcement: "" });
    if (url.pathname === "/api/admin/news") return json(POSTS);
    if (url.pathname === "/api/news/app-update") return json({ detail: { code: "app_only", message: "Diese Nachricht gibt es nur in der LionsAPP. Öffne sie in der App." } }, 404);
    if (url.pathname === "/api/home/about") return json({ games: [] });
    const list = /notifications|games$|site-banners|sponsors|partners|tournaments|challenges|events|news$|users/.test(url.pathname);
    return json(list ? [] : {});
  });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
      await page.setViewportSize({ width, height });
    });

    test("Editor: „Nur App“ unter der Sichtbarkeit - kein Newsletter, kein Discord, gespeichert als [app]", async ({ page }, testInfo) => {
      const state = {};
      await mockApi(page, state);
      await page.goto("/admin/news/new");
      const select = page.getByTestId("news-channels");
      await expect(select).toHaveValue("both");
      // Die Auswahl steht im Abschnitt „Veröffentlichung“ direkt nach der Sichtbarkeit - nicht unten angehängt.
      const order = await page.evaluate(() => [...document.querySelectorAll("select[data-testid]")].map((node) => node.dataset.testid));
      expect(order.indexOf("news-channels")).toBe(order.indexOf("news-visibility") + 1);
      await select.selectOption("app");
      await expect(page.getByText("Erscheint nur in der LionsAPP", { exact: false })).toBeVisible();
      await page.getByTestId("distribute-toggle").evaluate((node) => node.getAttribute("aria-expanded") === "false" && node.click());
      await expect(page.getByTestId("distribute-audience-line")).toHaveText("Kein Newsletter – „Nur App“ geht nicht per Mail hinaus.");
      // Öffentlich und „Nur App“: beim Veröffentlichen ein App-Push an alle App-Nutzer mit Zustimmung (Fabian, 23.11.).
      await expect(page.getByTestId("distribute-app-push")).toContainText("App-Push an alle App-Nutzer mit Zustimmung");
      await page.getByTestId("news-title").fill("LionsAPP 1.9.4 ist da");
      await select.scrollIntoViewIfNeeded();
      await noSideScroll(page);
      await page.screenshot({ path: testInfo.outputPath(`kanal-formular-${width}.png`), fullPage: true });
      await page.getByTestId("news-publish-now").check();
      await page.getByTestId("news-save").click();
      const dialog = page.getByTestId("confirm-dialog");
      await expect(dialog).toContainText("Kein Newsletter – „Nur App“ geht nicht per Mail hinaus.");
      await expect(dialog).toContainText("Die App schickt einen Push an alle App-Nutzer mit Zustimmung");
      await expect(dialog).toContainText("Keine Meldung auf Discord.");
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect.poll(() => state.created?.channels).toEqual(["app"]);
    });

    test("Liste: Schild „Nur App“ und „Nur Website“, keins bei beidem und bei alten Beiträgen", async ({ page }, testInfo) => {
      await mockApi(page, {});
      await page.goto("/admin/news");
      await expect(page.getByTestId("news-channel-n-2")).toHaveText("Nur App");
      await expect(page.getByTestId("news-channel-n-3")).toHaveText("Nur Website");
      await expect(page.getByTestId("news-channel-n-1")).toHaveCount(0);
      await expect(page.getByTestId("news-channel-n-4")).toHaveCount(0);
      await noSideScroll(page);
      await page.screenshot({ path: testInfo.outputPath(`kanal-liste-${width}.png`), fullPage: true });
    });

    test("Website: Link zu „Nur App“ zeigt den Hinweis auf die LionsAPP mit Store-Knopf", async ({ page }) => {
      const state = {};
      await mockApi(page, state, { user: null });
      await page.goto("/news/app-update");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nur in der LionsAPP");
      await expect(page.getByTestId("news-error")).toContainText("Diese Nachricht gibt es nur in der LionsAPP.");
      await expect(page.getByTestId("news-app-only-play")).toHaveAttribute("href", PLAY);
      await noSideScroll(page);
      expect(state.channelHeaders.length).toBeGreaterThan(0);
      expect(new Set(state.channelHeaders)).toEqual(new Set(["web"]));
    });
  });
}
