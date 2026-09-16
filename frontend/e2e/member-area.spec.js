const { test, expect } = require("@playwright/test");

// Mitgliederbereich (#283): „Interne Events“ kommt aus der Event-Liste. Ein
// ausgeschriebenes Mitglieder-Event steht dort, ein öffentliches nicht.

const member = { id: "user-1", username: "tabsi98", display_name: "Tabsi98", role: "player", is_club_member: true };

const events = [
  { id: "e-lan", name: "LAN für alle", slug: "lan-fuer-alle", visibility: "public", status: "announced", start_date: "2099-09-18T10:00:00Z" },
  { id: "e-hallo", name: "Halloween Gaming Night 2099", slug: "halloween-2099", visibility: "members", status: "announced", start_date: "2099-10-31T18:00:00Z", end_date: "2099-11-01T02:00:00Z", location: "Vereinsheim" },
];

async function mockServer(page, eventList) {
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(member) }));
  await page.route("**/api/membership/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ membership: { member_number: "TLS-007", member_since: "2024-03-01", member_since_precision: "day" } }) }));
  await page.route("**/api/events?**", (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("upcoming")).toBe("true");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(eventList) });
  });
}

async function acceptCookies(page) {
  const consent = page.getByRole("button", { name: /alle akzeptieren/i });
  if (await consent.count()) await consent.click();
}

test("ein Mitglieder-Event steht im Mitgliederbereich, ein öffentliches nicht", async ({ page }) => {
  await mockServer(page, events);
  await page.goto("/members/area");
  await acceptCookies(page);

  await expect(page.getByTestId("member-area-event-e-hallo")).toContainText("Halloween Gaming Night 2099");
  await expect(page.getByTestId("member-area-event-e-hallo")).toContainText("Vereinsheim");
  await expect(page.getByTestId("member-area-event-e-hallo")).toHaveAttribute("href", "/events/halloween-2099");
  await expect(page.getByTestId("member-area-event-e-lan")).toHaveCount(0);
  await expect(page.getByTestId("tile-events")).toContainText("1 anstehend");
  await expect(page.getByTestId("member-area-events-empty")).toHaveCount(0);
});

test("ohne Mitglieder-Event steht der Leerhinweis", async ({ page }) => {
  await mockServer(page, [events[0]]);
  await page.goto("/members/area");
  await acceptCookies(page);

  await expect(page.getByTestId("member-area-events-empty")).toBeVisible();
  await expect(page.getByTestId("tile-events")).toContainText("0 anstehend");
});
