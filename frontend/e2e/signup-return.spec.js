const { test, expect } = require("@playwright/test");

// Nach dem Registrieren zurück dorthin, wo man hinwollte (#1225): Turnier → „Jetzt anmelden“ als Gast → Login (mit dem
// Satz, wofür) → „Registrieren“ → Formular → Mail-Bestätigung (der Link aus der Mail nachgestellt) → „Einloggen und
// weiter“ → angemeldet zurück auf der Turnierseite. Die API ist nachgestellt, alle Daten sind erfunden.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const TOURNAMENT = {
  id: "t1", slug: "mk-cup", title: "Mario Kart Cup", status: "registration_open", registration_enabled: true, participant_count: 3, max_participants: 16,
  team_mode: "solo", team_size: 1, event_mode: "online", format: "single_elim", start_date: "2026-11-14T13:00:00+00:00",
  public_phase: { state: "registration_open", label: "Anmeldung offen" }, registration_open_from: "2026-10-01T08:00:00+00:00", registration_open_until: "2026-11-13T20:00:00+00:00",
};
const USER = { id: "u7", username: "neonfalke", display_name: "NeonFalke", email: "neonfalke@lionsquad-test.at", role: "player", roles: ["player"], areas: [], email_verified: true };

test.describe("Registrieren mit Ziel", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "ein Ablauf genügt");

  test("Turnier → Login → Registrieren → Mail-Link → angemeldet auf der Turnierseite", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-07T10:00:00+00:00"));
    await page.addInitScript(() => {
      window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
    });
    let loggedIn = false;
    let registerBody = null;
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at", registration_enabled: true, password_login_enabled: true }));
      if (path === "/api/auth/me") return loggedIn ? route.fulfill(json(USER)) : route.fulfill(json({ detail: "anonym" }, 401));
      if (path === "/api/auth/register") {
        registerBody = request.postDataJSON();
        return route.fulfill(json({ verification_required: true, email: registerBody.email }));
      }
      if (path === "/api/auth/verify-email") return route.fulfill(json({ ok: true, next: "/tournaments/mk-cup" }));
      if (path === "/api/auth/login") {
        loggedIn = true;
        return route.fulfill(json(USER));
      }
      if (path === "/api/auth/passkeys/status") return route.fulfill(json({ enabled: false }));
      if (path === "/api/tournaments/mk-cup") return route.fulfill(json(TOURNAMENT));
      if (path === "/api/tournaments/t1/registrations") return route.fulfill(json([]));
      if (path === "/api/teams/my") return route.fulfill(json([]));
      return route.abort();
    });

    await page.goto("/tournaments/mk-cup");
    await page.getByTestId("tournament-register-btn").click();
    await expect(page).toHaveURL(/\/login\?next=%2Ftournaments%2Fmk-cup$/);
    await expect(page.getByTestId("login-purpose")).toHaveText("Melde dich an, um dich für „Mario Kart Cup“ anzumelden.");

    await page.getByTestId("login-register-link").click();
    await expect(page).toHaveURL(/\/register\?next=%2Ftournaments%2Fmk-cup$/);
    await expect(page.getByTestId("register-purpose")).toHaveText("Erstelle ein Konto, um dich für „Mario Kart Cup“ anzumelden.");
    await page.getByTestId("register-username").fill("neonfalke");
    await page.getByTestId("register-email").fill("neonfalke@lionsquad-test.at");
    await page.getByTestId("register-password").fill("testtest-42");
    await page.getByTestId("register-accept").check();
    await page.getByTestId("register-accept-terms").check();
    await page.getByTestId("register-submit").click();
    await expect(page).toHaveURL(/\/verify-email\?sent=1&email=.*&next=%2Ftournaments%2Fmk-cup$/);
    expect(registerBody.next).toBe("/tournaments/mk-cup");

    // Der Link aus der Bestätigungs-Mail - so baut ihn der Server.
    await page.goto("/verify-email?token=mail-token&next=%2Ftournaments%2Fmk-cup");
    await expect(page.getByTestId("verify-continue")).toHaveText("Einloggen und weiter");
    await page.getByTestId("verify-continue").click();
    await expect(page).toHaveURL(/\/login\?next=%2Ftournaments%2Fmk-cup$/);
    await page.getByTestId("login-email").fill("neonfalke@lionsquad-test.at");
    await page.getByTestId("login-password").fill("testtest-42");
    await page.getByTestId("login-submit").click();

    await expect(page).toHaveURL(/\/tournaments\/mk-cup$/);
    await expect(page.getByTestId("tournament-title")).toHaveText("Mario Kart Cup");
  });
});
