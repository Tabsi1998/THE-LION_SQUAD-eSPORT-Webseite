const { test, expect } = require("@playwright/test");

// Bewerbungen (#1356): mit der Personensuche zum Antrag einladen - der Eintrag erscheint danach in den Einladungen.
// Bei 390, 768 und 1440 px.

const WIDTHS = [["handy", 390, 844], ["tablet", 768, 1024], ["pc", 1440, 900]];
const BOARD = { id: "u-board", username: "vera", display_name: "Vera Vorstand", role: "player", areas: ["club"], mfa_enabled: true, auth_mfa_verified: true, is_club_member: true };

async function mockApi(page, state) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() === "POST" && url.pathname === "/api/admin/membership-invitations") {
      const body = request.postDataJSON();
      state.invitations.push({ id: "inv-1", user_id: body.user_id, status: "open", created_at: "2026-10-08T08:00:00+00:00", invited_by_name: "Vera Vorstand", note: body.note || "", user: { id: body.user_id, username: "nina", display_name: "Nina Neu" } });
      return json(state.invitations[0]);
    }
    if (request.method() !== "GET") return json({ ok: true });
    if (url.pathname === "/api/auth/me") return json(BOARD);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (url.pathname === "/api/membership/applications") return json([{ id: "a-1", created_at: "2026-10-05T09:00:00+00:00", user_display_name: "Max Muster", user_username: "max", coupled: true, type_label: "Ordentliches Mitglied", status: "pending", motivation: "Ich spiele mit.", dolibarr: { application_status: "received" } }]);
    if (url.pathname === "/api/admin/membership-invitations") return json(state.invitations);
    if (url.pathname === "/api/admin/people/search") return json(url.searchParams.get("purpose") === "invite" && url.searchParams.get("q") ? [{ id: "u-5", name: "Nina Neu", avatar_url: null, context: "Community" }] : []);
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

    test("mit Suche einladen – der Eintrag steht danach in den Einladungen", async ({ page }) => {
      const state = { invitations: [] };
      await mockApi(page, state);
      await page.goto("/admin/membership-applications");
      await expect(page.getByTestId("invitations-empty")).toBeVisible();
      // Am PC steht der Stand in der Tabelle, am Tablet und Handy auf der Karte.
      await expect(page.getByText("Wartet auf Dolibarr").filter({ visible: true }).first()).toBeVisible();
      await page.getByTestId("apps-invite-open").click();
      await page.getByTestId("apps-invite-person-search").fill("nin");
      await page.getByTestId("apps-invite-person-option-u-5").click();
      await page.getByTestId("apps-invite-save").click();
      await expect(page.getByTestId("invitation-inv-1")).toContainText("Nina Neu");
      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(2);
    });
  });
}
