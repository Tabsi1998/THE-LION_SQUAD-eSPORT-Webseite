const { test, expect } = require("@playwright/test");

// „Mein Dienst“ (#1352): Helfer und Moderation finden ihren Eingang mit einem Tipp - im Benutzermenü (PC) bzw. im
// Handy-Menü - statt auf „Kein Zugriff“ zu landen. Helfer sehen ihr Turnier und kommen zur Turnierleitung, die
// Moderation landet bei den Meldungen. Geprüft bei 390, 768 und 1440 px.

const HELPER = { id: "helfer-1", username: "helfer", display_name: "Helfer", role: "player", has_staff_assignment: true, is_tournament_staff: true };
const MODERATOR = { id: "mod-1", username: "moderation", display_name: "Moderation", role: "moderator" };
const DUTY = {
  assignments: [{
    kind: "tournament", id: "t-1", slug: "herbst-cup", title: "Herbst-Cup", status: "live", today: true,
    starts_at: "2026-10-13T16:00:00Z", roles: ["referee"], url: "/tournaments/herbst-cup/leitung", admin_url: "/admin/tournaments/t-1",
  }],
  moderation: null,
  lead_today: [],
};
const WIDTHS = [[390, 844], [768, 1024], [1440, 900]];

async function mockServer(page, user) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", json({}));
  for (const path of ["sponsors**", "notifications/me", "games", "moderation/reports**", "moderation/items**", "moderation/people**", "moderation/word-filter"]) {
    await page.route(`**/api/${path}`, json([]));
  }
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(user));
  await page.route("**/api/users/me/duty", json(DUTY));
}

// PC (ab 1024 px): Benutzermenü oben rechts; schmaler: das ausklappende Handy-Menü.
async function openDuty(page, width) {
  if (width >= 1024) {
    await page.getByTestId("nav-user").click();
    await page.getByTestId("nav-duty").click();
  } else {
    await page.getByTestId("nav-mobile-toggle").click();
    await page.getByTestId("nav-duty-mobile").click();
  }
}

for (const [width, height] of WIDTHS) {
  test(`Helfer (${width} px): Benutzermenü → „Mein Dienst“ → eigenes Turnier`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page, HELPER);
    await page.goto("/dashboard");
    await openDuty(page, width);

    await expect(page).toHaveURL(/\/admin\/dienst$/);
    await expect(page.getByTestId("duty-heading")).toHaveText("Mein Dienst");
    await expect(page.getByTestId("duty-roles-t-1")).toContainText("Schiedsrichter");
    await expect(page.getByText("Kein Zugriff")).toHaveCount(0);
    await page.getByTestId("duty-open-t-1").click();
    await expect(page).toHaveURL(/\/tournaments\/herbst-cup\/leitung$/);
  });

  test(`Moderation (${width} px): „Mein Dienst“ öffnet die Meldungen`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page, MODERATOR);
    await page.goto("/dashboard");
    await openDuty(page, width);

    await expect(page).toHaveURL(/\/admin\/moderation$/);
    await expect(page.getByRole("heading", { level: 1, name: "Moderation" })).toBeVisible();
  });
}

test("Spieler ohne Dienst: /admin erklärt, wofür die Verwaltung da ist - ohne „Anmelden“", async ({ page }) => {
  await mockServer(page, { id: "spieler-1", username: "spieler", display_name: "Spieler", role: "player" });
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/403$/);
  await expect(page.getByTestId("error-detail-403")).toContainText("Die Verwaltung ist für Vereinsdienste.");
  await expect(page.getByTestId("error-login-btn")).toHaveCount(0);
  await expect(page.getByTestId("error-contact-link")).toHaveAttribute("href", "/contact");
});
