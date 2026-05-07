const { test, expect } = require("@playwright/test");

async function acceptCookies(page) {
  const button = page.getByRole("button", { name: /alle akzeptieren/i });
  if (await button.count()) await button.click();
}

test("public community structure is reachable", async ({ page }) => {
  await page.goto("/community");
  await acceptCookies(page);
  await expect(page.getByRole("heading", { name: /accounts,\s*teams\s*&\s*verein/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /profile öffnen/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /teams öffnen/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /mitglieder öffnen/i })).toBeVisible();
});

test("verein and community navigation are separated", async ({ page, isMobile }) => {
  await page.goto("/");
  await acceptCookies(page);
  if (isMobile) {
    await page.getByTestId("nav-mobile-toggle").click();
    await page.getByTestId("mobile-nav-verein").click();
    await expect(page.getByTestId("mobile-nav-sub-vereinsmitglieder")).toBeVisible();
    await expect(page.getByTestId("mobile-nav-sub-mitglied-werden")).toBeVisible();
    await page.getByTestId("mobile-nav-community").click();
    await expect(page.getByTestId("mobile-nav-sub-community-spieler")).toBeVisible();
    await expect(page.getByTestId("mobile-nav-sub-teams")).toBeVisible();
    return;
  }
  await page.getByTestId("nav-verein").hover();
  await expect(page.getByTestId("nav-sub-vereinsmitglieder")).toBeVisible();
  await expect(page.getByTestId("nav-sub-mitglied-werden")).toBeVisible();
  await page.getByTestId("nav-community").hover();
  await expect(page.getByTestId("nav-sub-community-spieler")).toBeVisible();
  await expect(page.getByTestId("nav-sub-teams")).toBeVisible();
});

test("club members render gamertag-first cards", async ({ page }) => {
  await page.route("**/api/membership/profiles", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "member-1",
          slug: "tabsi98",
          display_name: "Fabian Tabelander",
          gamertag: "Tabsi98",
          real_name: "Fabian Tabelander",
          role_title: "Obmann",
          photo_url: "",
          games: ["F1 25", "Mario Kart"],
          platforms: ["PC", "PS5"],
          level: 27,
        },
      ]),
    });
  });

  await page.goto("/members");
  await acceptCookies(page);

  const card = page.getByTestId("member-card-tabsi98");
  await expect(card).toBeVisible();
  await expect(card.getByText("Tabsi98")).toBeVisible();
  await expect(card.getByText("Fabian Tabelander")).toBeVisible();
  await expect(card.getByText("Obmann")).toBeVisible();
});
