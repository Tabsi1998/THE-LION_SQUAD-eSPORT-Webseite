const { test, expect } = require("@playwright/test");

// Vorstand (#1355): einen Posten mit der Personensuche besetzen - der Satz nennt die Rechte, die Rückfrage bestätigt.
// Bei 390, 768 und 1440 px; am Handy öffnet das Blatt als ganze Seite.

const WIDTHS = [["handy", 390, 844], ["tablet", 768, 1024], ["pc", 1440, 900]];
const BOARD = { id: "u-board", username: "vera", display_name: "Vera Vorstand", role: "player", areas: ["club"], mfa_enabled: true, auth_mfa_verified: true, is_club_member: true };
const POSITIONS = [
  { id: "bp-1", slug: "obmann", title_male: "Obmann", title_female: "Obfrau", is_default: true, allow_deputy: true, is_active: true, user_id: "prof-1", user: { display_name: "Leo Löwe" } },
  { id: "bp-2", slug: "kassier", title_male: "Kassier", title_female: "Kassierin", is_default: true, allow_deputy: true, is_active: true, user_id: null },
];

async function mockApi(page, calls) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() !== "GET") {
      calls.push({ method: request.method(), path: url.pathname, body: request.postDataJSON() });
      return json({ ok: true });
    }
    if (url.pathname === "/api/auth/me") return json(BOARD);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (url.pathname === "/api/board" && url.searchParams.get("manual") === "true") return json(POSITIONS);
    if (url.pathname === "/api/board/source") return json({ dolibarr: false, switch_on: false, has_board: false });
    if (url.pathname === "/api/board/admin/state") return json({ dolibarr_leads: false, rights_from_dolibarr: false });
    if (url.pathname === "/api/admin/people/search") return json(url.searchParams.get("purpose") === "board" && url.searchParams.get("q") ? [{ id: "u-7", name: "Erika Beispiel", avatar_url: null, context: "Mitglied", has_account: true }] : []);
    const list = /notifications|games$|nav$|site-banners|sponsors|partners/.test(url.pathname);
    return json(list ? [] : {});
  });
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
      await page.setViewportSize({ width, height });
    });

    test("Posten mit Suche und Rückfrage besetzen", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/board");
      await page.getByTestId("board-assign-kassier").click();
      const sheet = page.getByTestId("board-assign-sheet");
      await expect(sheet).toBeVisible();
      if (width < 640) expect(Math.abs((await sheet.boundingBox()).width - width)).toBeLessThanOrEqual(2);
      await page.getByTestId("board-person-search").fill("eri");
      await page.getByTestId("board-person-option-u-7").click();
      await expect(page.getByTestId("board-assign-sentence")).toContainText("Erika Beispiel wird Kassier:in und bekommt damit die Vereinsverwaltung");
      await page.getByTestId("board-assign-save").click();
      await expect(page.getByTestId("confirm-dialog")).toContainText("Mitgliederdaten, Anträge, Dokumente, Benutzer");
      expect(calls).toEqual([]);
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect.poll(() => calls.find((call) => call.path === "/api/board/bp-2")?.body).toEqual({ user_id: "u-7" });
      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(2);
    });
  });
}
