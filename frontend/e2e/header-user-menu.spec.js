const { test, expect } = require("@playwright/test");

// Das Benutzermenü im Kopf (#282): Von jeder Seite in zwei Klicks ins Profil;
// Mitgliederbereich nur für Mitglieder, statt als eigener Knopf. Am Handy
// steckt dasselbe im Menü.

async function mockServer(page, user) {
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/sponsors**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/notifications/me", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/admin/notifications", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(user) }));
  // Die Profilseite erwartet Listen, kein leeres Objekt.
  for (const path of ["games", "achievements/me", "auth/sessions"]) {
    await page.route(`**/api/${path}`, (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  }
  await page.route("**/api/friends", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ incoming: [], friends: [], outgoing: [] }) }));
}

async function acceptCookies(page) {
  const consent = page.getByRole("button", { name: /alle akzeptieren/i });
  if (await consent.count()) await consent.click();
}

test("das Benutzermenü führt ins Profil; ein Mitglied sieht den Mitgliederbereich dort statt als Knopf", async ({ page, isMobile }) => {
  await mockServer(page, { id: "user-1", username: "tabsi98", display_name: "Tabsi98", role: "player", is_club_member: true });
  await page.goto("/dashboard");
  await acceptCookies(page);

  if (isMobile) {
    await page.getByTestId("nav-mobile-toggle").click();
    await expect(page.getByTestId("nav-profile-mobile")).toHaveAttribute("href", "/profile");
    await expect(page.getByTestId("nav-member-area-mobile")).toHaveAttribute("href", "/members/area");
    await page.getByTestId("nav-profile-mobile").click();
  } else {
    await expect(page.getByTestId("nav-member-area-button")).toHaveCount(0);
    await page.getByTestId("nav-user").click();
    await expect(page.getByTestId("nav-member-area")).toHaveAttribute("href", "/members/area");
    await expect(page.getByTestId("nav-logout")).toBeVisible();
    await page.getByTestId("nav-profile").click();
  }
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByTestId("profile-tab-basic")).toBeVisible();
});

test("ohne Mitgliedschaft gibt es keinen Mitgliederbereich im Menü, und das Dashboard verlinkt aufs Profil", async ({ page, isMobile }) => {
  await mockServer(page, { id: "user-2", username: "gast", display_name: "Gast", role: "player", is_club_member: false });
  await page.goto("/dashboard");
  await acceptCookies(page);

  await expect(page.getByTestId("dashboard-edit-profile")).toHaveAttribute("href", "/profile");
  if (isMobile) {
    await page.getByTestId("nav-mobile-toggle").click();
    await expect(page.getByTestId("nav-member-area-mobile")).toHaveCount(0);
  } else {
    await page.getByTestId("nav-user").click();
    await expect(page.getByTestId("nav-member-area")).toHaveCount(0);
    await expect(page.getByTestId("nav-admin-menu")).toHaveCount(0);
  }
});
