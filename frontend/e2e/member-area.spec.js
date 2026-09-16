const { test, expect } = require("@playwright/test");

// Mitgliederbereich (#283, #284): Kopf mit Mitgliedschaft, eine Zeile
// Verweise, darunter nur Karten mit Inhalt – interne Events aus der
// Event-Liste, Dokumente, Vorteile, interne News, Ansprechpartner. Ist
// nichts freigeschaltet, steht ein Satz statt vier leerer Karten.

const member = { id: "user-1", username: "tabsi98", display_name: "Tabsi98", role: "player", is_club_member: true };

const events = [
  { id: "e-lan", name: "LAN für alle", slug: "lan-fuer-alle", visibility: "public", status: "announced", start_date: "2099-09-18T10:00:00Z" },
  { id: "e-hallo", name: "Halloween Gaming Night 2099", slug: "halloween-2099", visibility: "members", status: "announced", start_date: "2099-10-31T18:00:00Z", end_date: "2099-11-01T02:00:00Z", location: "Vereinsheim" },
];

async function mockServer(page, { eventList = [], board = [], documents = [], news = [], benefits = [], settings = {} } = {}) {
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(member) }));
  await page.route("**/api/settings/public", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(settings) }));
  await page.route("**/api/membership/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ membership: { member_number: "TLS-007", member_since: "2024-03-01", member_since_precision: "day" } }) }));
  await page.route("**/api/membership/benefits", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(benefits) }));
  await page.route("**/api/documents", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(documents) }));
  await page.route("**/api/news", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(news) }));
  await page.route("**/api/board?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(board) }));
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

test("ein Mitglieder-Event steht im Mitgliederbereich, ein öffentliches nicht; keine Kacheln mehr", async ({ page }) => {
  await mockServer(page, { eventList: events });
  await page.goto("/members/area");
  await acceptCookies(page);

  await expect(page.getByTestId("member-area-event-e-hallo")).toContainText("Halloween Gaming Night 2099");
  await expect(page.getByTestId("member-area-event-e-hallo")).toContainText("Vereinsheim");
  await expect(page.getByTestId("member-area-event-e-hallo")).toHaveAttribute("href", "/events/halloween-2099");
  await expect(page.getByTestId("member-area-event-e-lan")).toHaveCount(0);
  await expect(page.locator('[data-testid^="tile-"]')).toHaveCount(0);
  await expect(page.getByTestId("member-area-empty")).toHaveCount(0);
  await expect(page.getByTestId("member-area-news")).toHaveCount(0);
  await expect(page.getByTestId("member-area-links")).toContainText("Mitgliedschaft");
});

test("ist nichts freigeschaltet, steht ein Satz statt leerer Karten", async ({ page }) => {
  await mockServer(page, { eventList: [events[0]] });
  await page.goto("/members/area");
  await acceptCookies(page);

  await expect(page.getByTestId("member-area-empty")).toBeVisible();
  await expect(page.getByTestId("member-area-events")).toHaveCount(0);
  await expect(page.getByTestId("member-area-documents")).toHaveCount(0);
  await expect(page.getByTestId("member-area-benefits")).toHaveCount(0);
  await expect(page.getByTestId("member-area-board")).toHaveCount(0);
});

test("Dokumente, interne News, Ansprechpartner und der Discord-Link erscheinen, sobald es sie gibt", async ({ page }) => {
  await mockServer(page, {
    documents: [{ id: "d-1", title: "Statuten 2026", original_filename: "statuten.pdf" }],
    news: [{ id: "n-1", slug: "intern-1", title: "Nur für Mitglieder", visibility: "members", created_at: "2099-09-01T10:00:00Z" }, { id: "n-2", slug: "public-1", title: "Für alle", visibility: "public", created_at: "2099-09-02T10:00:00Z" }],
    board: [{ id: "p-1", display_title: "Obmann", is_active: true, user: { display_name: "Lion Boss", profile_url: "/members/lion-boss" } }],
    settings: { discord_invite_url: "https://discord.com/invite/lions" },
  });
  await page.goto("/members/area");
  await acceptCookies(page);

  await expect(page.getByTestId("member-area-documents")).toContainText("Statuten 2026");
  await expect(page.getByTestId("member-area-news")).toContainText("Nur für Mitglieder");
  await expect(page.getByTestId("member-area-news")).not.toContainText("Für alle");
  await expect(page.getByTestId("member-area-board")).toContainText("Obmann");
  await expect(page.getByTestId("member-area-board")).toContainText("Lion Boss");
  await expect(page.getByTestId("member-area-discord")).toHaveAttribute("href", "https://discord.com/invite/lions");
  await expect(page.getByTestId("member-area-empty")).toHaveCount(0);
});
