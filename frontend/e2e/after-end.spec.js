const { test, expect } = require("@playwright/test");

// Nach dem Ende (#1221): ein beendetes Event zeigt bei 390 px keinen Live- und keinen Kalender-Knopf, sondern den Satz
// mit den Turnieren; die Live-Adresse führt auf die Event-Seite. Die API ist nachgestellt, die Uhr steht fest.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const EVENT = {
  id: "e1", slug: "gamers-fest-2026", name: "Gamers Fest 2026", status: "scheduled", visibility: "public", event_type: "lan",
  start_date: "2026-06-20T08:00:00+00:00", end_date: "2026-06-21T18:00:00+00:00", location: "Vereinsheim", city: "Telfs",
  public_phase: { state: "completed", label: "Beendet" },
  registrations: [], sponsors: [], albums: [], news: [], f1_challenges: [], partners: [],
  tournaments: [{ id: "t1", slug: "mk-summer-cup", title: "Mario Kart Summer Cup", status: "results_published", format: "single_elim", public_phase: { state: "results_published", label: "Ergebnisse veröffentlicht" } }],
};

async function mockApi(page) {
  await page.clock.setFixedTime(new Date("2026-10-07T10:00:00+00:00"));
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/events/gamers-fest-2026") return route.fulfill(json(EVENT));
    if (path === "/api/tournaments/t1/standings") return route.fulfill(json([{ rank: 1, registration_id: "r1", display_name: "NeonFalke" }]));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/auth/me") return route.fulfill(json({ detail: "anonym" }, 401));
    return route.abort();
  });
}

test.describe("Beendetes Event", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  test("bei 390 px kein Live- und Kalender-Knopf, dafür der Satz mit den Turnieren", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page);
    await page.goto("/events/gamers-fest-2026");
    await expect(page.getByTestId("event-over")).toContainText("Das Event ist vorbei – die Ergebnisse stehen bei den Turnieren:");
    await expect(page.getByTestId("event-over").getByRole("link", { name: "Mario Kart Summer Cup" })).toHaveAttribute("href", "/tournaments/mk-summer-cup");
    await expect(page.getByText("Live verfolgen")).toHaveCount(0);
    await expect(page.getByText("Display", { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-testid^='add-to-calendar']")).toHaveCount(0);
    await testInfo.attach("event-vorbei-390.png", { body: await page.screenshot(), contentType: "image/png" });
  });

  test("die Live-Adresse führt auf die Event-Seite", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page);
    await page.goto("/events/gamers-fest-2026/live");
    await expect(page).toHaveURL(/\/events\/gamers-fest-2026$/);
    await expect(page.getByTestId("event-over")).toBeVisible();
  });
});
