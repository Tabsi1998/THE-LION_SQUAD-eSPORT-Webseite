const { test, expect } = require("@playwright/test");

// Ohne Netz (#1152): Seite laden, Netz weg - oben steht „Offline · Stand …“, der geladene Inhalt bleibt; Netz zurück -
// die Leiste verschwindet. Ein Ladefehler zeigt „Nochmal versuchen“ statt ewiger Platzhalter. Erfundene Daten.

const EMPTY = { events: [], tournaments: [], challenges: [] };
const NEWS = [{ id: "n1", slug: "herbst-lan", title: "Herbst-LAN 2026 angekündigt", excerpt: "Drei Tage Turniere im Vereinsheim.", category: "events", created_at: "2026-10-01T10:00:00Z", published_at: "2026-10-01T10:00:00Z" }];
const HOME = { has_live: false, live: EMPTY, today: EMPTY, soon: EMPTY, upcoming: EMPTY, news: NEWS, featured_news: [NEWS[0]], stats: {}, club_numbers: {} };

async function mockServer(page, { homeFails = false } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, body: "{}" }));
  await page.route("**/api/settings/public", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/seasonal/active", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ enabled: false, seasons: [] }) }));
  await page.route("**/api/home/state", (route) => (homeFails
    ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Kaputt." }) })
    : route.fulfill({ contentType: "application/json", body: JSON.stringify(HOME) })));
}

for (const width of [390, 1440]) {
  test(`Netz weg: Leiste mit Stand, der Inhalt bleibt; Netz zurück: Leiste weg (${width} px)`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await mockServer(page);
    await page.goto("/");
    await expect(page.getByText("Herbst-LAN 2026 angekündigt").first()).toBeVisible();
    await expect(page.getByTestId("offline-bar")).toHaveCount(0);
    await context.setOffline(true);
    await expect(page.getByTestId("offline-bar")).toBeVisible();
    await expect(page.getByTestId("offline-bar")).toContainText("Offline · Stand");
    await expect(page.getByText("Herbst-LAN 2026 angekündigt").first()).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByTestId("offline-bar")).toHaveCount(0);
  });
}

test("Startseite: ein Serverfehler zeigt „Nochmal versuchen“ statt ewiger Platzhalter", async ({ page }) => {
  await mockServer(page, { homeFails: true });
  await page.goto("/");
  await expect(page.getByTestId("public-error-state")).toBeVisible();
  await expect(page.getByTestId("public-error-retry")).toBeVisible();
});
