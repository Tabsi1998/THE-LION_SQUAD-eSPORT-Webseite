const { test, expect } = require("@playwright/test");

// Inhalte vervollständigen (#2122): neuer Beitrag als Entwurf mit Auswahl und Rückfrage „geht an N Personen“, Vorschau mit
// Band „Noch nicht öffentlich“, zurückgezogener Beitrag mit Hinweis, Navigation-Editor mit Liga und die Kachel „Liga“ auf
// der eSports-Übersicht. Bei 390 und 1440 px, ohne seitliches Scrollen. Alles gegen Attrappen, nichts wird verschickt.

const WIDTHS = [["handy", 390, 844], ["pc", 1440, 900]];
const EDITOR = { id: "u-red", username: "rita", display_name: "Rita Redaktion", role: "club_admin", areas: ["content"], mfa_enabled: true, auth_mfa_verified: true };
const DRAFT = { id: "n-2", slug: "liga-startet", title: "Die Liga startet", excerpt: "Alles zum Start.", content: "Am 10.11. geht es los.", category: "club",
  visibility: "public", published: false, preview: { state: "draft" }, content_embeds: [], mentioned_users: [] };
const NAV = { items: [
  { key: "home", to: "/", label: "Start", visible: true, order: 0 },
  { key: "esports", to: "/esports", label: "eSports", visible: true, order: 1, children: [
    { key: "esports_overview", to: "/esports", label: "Übersicht", visible: true, order: 0 },
    { key: "tournaments", to: "/tournaments", label: "Turniere", visible: true, order: 1 },
    { key: "league", to: "/liga", label: "Liga", visible: true, order: 2 },
    { key: "fastlap", to: "/fastlap", label: "Fast Lap", visible: true, order: 3 },
  ] },
] };
const LEAGUES = { leagues: [{ id: "l1", slug: "cod-liga", name: "CoD-Liga", seasons: [{ id: "s1", slug: "season-1", name: "Season 1", status: "draft", start_date: "2026-11-10" }] }] };

async function mockApi(page, state, { user = EDITOR } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() === "POST" && url.pathname === "/api/news") {
      state.created = request.postDataJSON();
      return json({ id: "n-new", ...state.created });
    }
    if (request.method() === "POST" && url.pathname === "/api/settings/discord/preview") return json({ would_send: true, embed: {}, buttons: [] });
    if (request.method() !== "GET") return json({ ok: true });
    if (url.pathname === "/api/auth/me") return user ? json(user) : json({ detail: "nicht angemeldet" }, 401);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (url.pathname === "/api/news-meta") return json({ categories: [{ k: "club", l: "Verein" }], visibilities: [{ k: "public", l: "Öffentlich" }], in_use: [] });
    if (url.pathname === "/api/settings/newsletter/audience") return json({ kind: "news", visibility: "public", internal: false, recipients: 214, announcement: "" });
    if (url.pathname === "/api/news/liga-startet") return json(DRAFT);
    if (url.pathname === "/api/news/abgesagt") return json({ detail: "Dieser Beitrag wurde zurückgezogen. Alle aktuellen News findest du auf der News-Seite." }, 410);
    if (url.pathname === "/api/admin/nav") return json(NAV);
    if (url.pathname === "/api/nav") return json(NAV);
    if (url.pathname === "/api/leagues") return json(LEAGUES);
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

    test("neuer Beitrag ist Entwurf; „Jetzt veröffentlichen“ fragt mit Empfängerzahl nach", async ({ page }) => {
      const state = { created: null };
      await mockApi(page, state);
      await page.goto("/admin/news/new");
      await expect(page.getByTestId("news-publish-draft")).toBeChecked();
      await page.getByTestId("news-title").fill("Die Liga startet");
      await page.getByTestId("news-publish-now").check();
      await page.getByTestId("news-save").click();
      const dialog = page.getByTestId("confirm-dialog");
      await expect(dialog).toContainText("Beitrag jetzt veröffentlichen?");
      await expect(dialog).toContainText("214 Personen");
      await expect(dialog).toContainText("Discord bekommt eine Meldung.");
      await noSideScroll(page);
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect.poll(() => state.created?.published).toBe(true);
    });

    test("Vorschau eines Entwurfs mit Band, zurückgezogener Beitrag mit Hinweis", async ({ page }) => {
      await mockApi(page, {});
      await page.goto("/news/liga-startet");
      await expect(page.getByTestId("news-preview-band")).toContainText("Noch nicht öffentlich");
      await noSideScroll(page);
      await page.goto("/news/abgesagt");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Beitrag zurückgezogen");
      await expect(page.getByTestId("news-error")).toContainText("Alle aktuellen News");
      await noSideScroll(page);
    });

    test("Navigation-Editor: Liga unter eSports mit Hinweis, leerer Name sperrt Speichern", async ({ page }) => {
      await mockApi(page, {});
      await page.goto("/admin/nav");
      await page.getByRole("button", { name: "eSports aufklappen" }).click();
      await expect(page.getByTestId("nav-label-esports-league")).toHaveValue("Liga");
      await expect(page.getByTestId("nav-note-league")).toContainText("Season");
      await page.getByTestId("nav-label-home").fill("");
      await expect(page.getByTestId("nav-missing-label")).toBeVisible();
      await expect(page.getByTestId("nav-save")).toBeDisabled();
      await noSideScroll(page);
    });

    test("eSports-Übersicht: Kachel „Liga“ mit Starttermin", async ({ page }) => {
      await mockApi(page, {}, { user: null });
      await page.goto("/esports");
      const tile = page.getByTestId("esports-hub-league");
      await expect(tile).toHaveAttribute("href", "/liga");
      await expect(page.getByTestId("esports-hub-league-badge")).toHaveText(/Start am 10\.11\.2026/i);
      await noSideScroll(page);
    });
  });
}
