const { test, expect } = require("@playwright/test");

// Das Benutzermenü im Kopf (#282, #1150): Von jeder Seite in zwei Klicks ins eigene Profil oder in die Einstellungen;
// Mitgliederbereich nur für Mitglieder, statt als eigener Knopf. Jedes Thema an einem Ort: keine Chats, keine Glocke,
// keine Rechnungen im Menü. Am Handy steckt dasselbe im Menü.

async function mockServer(page, user) {
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/sponsors**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/notifications/me", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/admin/notifications", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(user) }));
  // Die Einstellungsseite erwartet Listen, kein leeres Objekt.
  for (const path of ["games", "achievements/me", "auth/sessions"]) {
    await page.route(`**/api/${path}`, (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  }
  await page.route("**/api/friends", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ incoming: [], friends: [], outgoing: [] }) }));
}

async function acceptCookies(page) {
  const consent = page.getByRole("button", { name: /alle erlauben/i });
  if (await consent.count()) await consent.click();
}

test("das Benutzermenü führt in die Gruppen von Mein Bereich; ein Mitglied sieht Verein dort statt als Knopf (#2059)", async ({ page, isMobile }) => {
  await mockServer(page, { id: "user-1", username: "tabsi98", display_name: "Tabsi98", role: "player", is_club_member: true });
  await page.goto("/dashboard");
  await acceptCookies(page);

  if (isMobile) {
    await page.getByTestId("nav-mobile-toggle").click();
    await expect(page.getByTestId("nav-profile-mobile")).toHaveAttribute("href", "/u/tabsi98");
    await expect(page.getByTestId("nav-account-profil-mobile")).toHaveAttribute("href", "/mein-bereich/profil");
    await expect(page.getByTestId("nav-account-verein-mobile")).toHaveAttribute("href", "/mein-bereich/verein");
    await expect(page.getByTestId("nav-member-area-mobile")).toHaveCount(0);
    await page.getByTestId("nav-account-profil-mobile").click();
  } else {
    await expect(page.getByTestId("nav-member-area-button")).toHaveCount(0);
    await expect(page.getByTestId("nav-admin")).toHaveCount(0);
    // Chats stehen unter Community, nicht als eigener Knopf im Kopf (#1148).
    await expect(page.getByTestId("nav-messages")).toHaveCount(0);
    await page.getByTestId("nav-user").click();
    await expect(page.getByTestId("nav-account-verein")).toHaveAttribute("href", "/mein-bereich/verein");
    await expect(page.getByTestId("nav-profile")).toHaveAttribute("href", "/u/tabsi98");
    await expect(page.getByTestId("nav-account-rechnungen")).toHaveAttribute("href", "/mein-bereich/rechnungen");
    for (const gone of ["nav-member-area", "nav-account-settings", "nav-messages-menu", "nav-public-profile", "nav-account-penalties", "nav-account-join"]) {
      await expect(page.getByTestId(gone)).toHaveCount(0);
    }
    await expect(page.getByTestId("nav-logout")).toBeVisible();
    await page.getByTestId("nav-account-profil").click();
  }
  await expect(page).toHaveURL(/\/mein-bereich\/profil$/);
  await expect(page.getByTestId("profile-tab-basic")).toBeVisible();
});

test("ohne Mitgliedschaft gibt es kein „Verein“ im Menü, und das Dashboard verlinkt nach Mein Bereich", async ({ page, isMobile }) => {
  await mockServer(page, { id: "user-2", username: "gast", display_name: "Gast", role: "player", is_club_member: false });
  await page.goto("/dashboard");
  await acceptCookies(page);

  await expect(page.getByTestId("dashboard-mein-bereich")).toHaveAttribute("href", "/mein-bereich");
  if (isMobile) {
    await page.getByTestId("nav-mobile-toggle").click();
    await expect(page.getByTestId("nav-account-verein-mobile")).toHaveCount(0);
  } else {
    await page.getByTestId("nav-user").click();
    await expect(page.getByTestId("nav-account-verein")).toHaveCount(0);
    await expect(page.getByTestId("nav-admin")).toHaveCount(0);
    // „Mitglied werden“ steht unter Verein (#1150) - kein zweiter Weg im Menü.
    await expect(page.getByTestId("nav-account-join")).toHaveCount(0);
  }
});
