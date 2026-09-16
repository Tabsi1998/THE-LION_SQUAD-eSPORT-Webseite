const { test, expect } = require("@playwright/test");

// Das Dashboard als persönliche Startseite (#256): kommende Termine mit
// Anmeldestatus, offene Aktionen, die Jahreswertung, keine Link-Kacheln für
// Dinge, die schon im Menü stehen. Der Server ist nachgestellt.

const me = { id: "user-1", username: "Testplayer", display_name: "Test Player", role: "player" };

function inDays(days, hour = 18) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

const dashboard = {
  me: {
    tournaments: [
      { id: "t-next", slug: "autumn-cup", title: "Autumn Cup", status: "registration_open", start_date: inDays(20), public_phase: { state: "registration", label: "Anmeldung offen" }, my_registration: { status: "approved" }, game: { display_name: "Rocket League" } },
      { id: "t-past", slug: "summer-cup", title: "Summer Cup", status: "results_published", start_date: inDays(-30), public_phase: { state: "finished", label: "Beendet" }, my_registration: { status: "approved" } },
    ],
    events: [
      { id: "e-past", slug: "opening", name: "Summer Opening", status: "completed", start_date: inDays(-60) },
    ],
    matches: [],
    staff_matches: [],
    actions: [
      { id: "tournament-checkin-t-next", type: "tournament_checkin", label: "Turnier Check-in offen", detail: "Autumn Cup", target_type: "tournament", target_id: "autumn-cup", priority: 10 },
    ],
  },
  season: { id: "s-1", slug: "2026", name: "Saison 2026", my_rank: 3, my_points: 42, participant_count: 20, leader: { display_name: "Anna", points: 99 } },
  stats: {},
};

test("das Dashboard zeigt einen kommenden Termin, keinen vergangenen, Aktionen und die Jahreswertung", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/sponsors**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(me) }));
  await page.route("**/api/notifications/me", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/prizes/me/open-count", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ count: 1 }) }));
  await page.route("**/api/mobile/dashboard", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(dashboard) }));
  await page.goto("/dashboard");
  const consent = page.getByRole("button", { name: /alle akzeptieren/i });
  if (await consent.count()) await consent.click();

  const dates = page.getByTestId("dashboard-timeline");
  await expect(dates.getByText("Autumn Cup", { exact: true })).toBeVisible();
  await expect(dates.getByText("Angemeldet", { exact: true })).toBeVisible();
  await expect(dates.getByText("Summer Cup", { exact: true })).toHaveCount(0);
  await expect(dates.getByText("Summer Opening", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("dashboard-timeline-t-next")).toHaveAttribute("href", "/tournaments/autumn-cup");

  const actions = page.getByTestId("dashboard-actions");
  await expect(actions.getByText("Turnier Check-in offen", { exact: true })).toBeVisible();
  await expect(actions.getByText("Gewinn abholen", { exact: true })).toBeVisible();
  await expect(page.getByTestId("dashboard-action-tournament-checkin-t-next")).toHaveAttribute("href", "/tournaments/autumn-cup");

  await expect(page.getByTestId("dashboard-season")).toContainText("Du: Platz 3 von 20 · 42 Punkte");
  await expect(page.getByTestId("dashboard-season")).toHaveAttribute("href", "/seasons/2026");

  // Keine Kacheln für Dinge aus dem Menü; was bleibt: Strafen und Daten.
  await expect(page.getByTestId("dashboard-profile-link")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-teams-link")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-achievements-link")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-penalties-link")).toBeVisible();
  await expect(page.getByTestId("dashboard-privacy-link")).toBeVisible();
});

test("ohne Termine steht der Hinweis mit dem Weg zu den Events", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/sponsors**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(me) }));
  await page.route("**/api/notifications/me", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/mobile/dashboard", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ me: { tournaments: [], events: [], matches: [], staff_matches: [], actions: [] }, season: null, stats: {} }) }));
  await page.goto("/dashboard");
  const consent = page.getByRole("button", { name: /alle akzeptieren/i });
  if (await consent.count()) await consent.click();

  const dates = page.getByTestId("dashboard-timeline");
  await expect(dates.getByText(/Keine Termine/)).toBeVisible();
  await expect(dates.getByRole("link", { name: /zu den Events/i })).toHaveAttribute("href", "/events");
  await expect(page.getByTestId("dashboard-actions")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-season")).toHaveCount(0);
});
