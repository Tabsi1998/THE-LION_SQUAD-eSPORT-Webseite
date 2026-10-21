const { test, expect } = require("@playwright/test");

// Bestätigungs-Blatt der Turnier-Anmeldung (#1261) am Handy (390 px): „Jetzt anmelden“ öffnet das Blatt von unten,
// Abbrechen meldet nicht an, „Verbindlich anmelden“ steht unten fest und meldet genau einmal an. Nur erfundene Daten.

const user = { id: "user-1", username: "probe", display_name: "Probe Spieler", role: "player", user_type: "community_user" };

const tournament = {
  id: "tournament-1",
  slug: "probe-cup",
  title: "Probe Cup mit einem sehr langen Namen für das Handy",
  status: "registration_open",
  registration_enabled: true,
  participant_count: 0,
  max_participants: 16,
  team_mode: "solo",
  event_mode: "local",
  location: "Vereinsheim Probehausen",
  start_date: "2099-10-04T18:00:00+00:00",
  check_in_from: "2099-10-04T17:00:00+00:00",
  check_in_until: "2099-10-04T17:45:00+00:00",
  rules: "Fair Play gilt immer. Ergebnisse meldet der Sieger. Wer zu spät kommt, verliert kampflos. Proteste gehen an die Turnierleitung.",
  game: { id: "game-1", slug: "probe-game", name: "Probespiel", player_id_fields: [] },
  public_phase: { state: "registration_open", label: "Anmeldung" },
};

async function acceptCookies(page) {
  const button = page.getByRole("button", { name: /alle erlauben/i });
  if (await button.count()) await button.click();
}

test.use({ viewport: { width: 390, height: 844 } });

test("390 px: Anmelden → Blatt → Verbindlich anmelden", async ({ page }) => {
  let registrations = [];
  let submissions = 0;
  await page.route("**/api/settings/public", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ club_name: "THE LION SQUAD" }) }));
  await page.route("**/api/sponsors**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/api/tournaments/probe-cup", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...tournament, participant_count: registrations.length }) }));
  await page.route("**/api/tournaments/tournament-1/registrations", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(registrations) }));
  await page.route("**/api/teams/my", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/tournaments/tournament-1/register", async (route) => {
    submissions += 1;
    registrations = [{ id: "registration-1", user_id: user.id, display_name: user.display_name, status: "approved" }];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(registrations[0]) });
  });

  await page.goto("/tournaments/probe-cup");
  await acceptCookies(page);

  // Abbrechen: keine Anmeldung.
  await page.getByTestId("tournament-register-btn").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await page.getByTestId("register-sheet-cancel").click();
  await expect(sheet).toHaveCount(0);
  expect(submissions).toBe(0);

  await page.getByTestId("tournament-register-btn").click();
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("register-sheet-place")).toHaveText("Vor Ort · Vereinsheim Probehausen");
  await expect(page.getByTestId("register-sheet-checkin")).toContainText("–");
  await expect(page.getByTestId("register-sheet-rules")).toContainText("Wer zu spät kommt, verliert kampflos.");
  // Blatt von unten, der Knopf unten im Bild, keine waagrechte Scrollleiste.
  await page.waitForTimeout(400);
  const box = await sheet.boundingBox();
  expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(843);
  const submit = page.getByTestId("tournament-register-submit");
  await expect(submit).toBeInViewport();
  await expect(submit).toHaveText("Verbindlich anmelden");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await submit.click();
  await expect(page.getByTestId("tournament-my-stand")).toBeVisible();
  await expect(sheet).toHaveCount(0);
  expect(submissions).toBe(1);
});
