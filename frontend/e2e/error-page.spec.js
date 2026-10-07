const { test, expect } = require("@playwright/test");

// Fehlerseite (#1230): eine Seite stürzt mit kaputten Serverdaten ab (die Server-Liste bekommt Text statt einer Liste).
// Gäste sehen den freundlichen Satz ohne Programmierer-Text; Admins zusätzlich „Technische Angaben“, zugeklappt,
// mit der Kennung der Meldung zum Kopieren. Läuft auch gegen den gebauten Stand: E2E_BASE_URL auf `vite preview`.

const ADMIN = { id: "admin-1", display_name: "Admin", username: "admin", role: "superadmin", mfa_enabled: true, auth_mfa_verified: true };
const REPORT_ID = "log-0a1b2c3d";

async function mockBrokenServersPage(page, user) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const reports = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.includes("/api/settings/public")) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at" }) });
    }
    if (url.includes("/api/auth/me")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    // Absichtlich kaputt: die Seite erwartet eine Liste und rechnet damit.
    if (url.includes("/api/game-servers")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: "kaputt", summary: {} }) });
    if (url.includes("/api/mobile/client-logs") && request.method() === "POST") {
      reports.push(request.postDataJSON());
      // Ohne Anmeldung nimmt der Server keine Meldung an - wie im Betrieb.
      if (!user) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Nicht angemeldet" }) });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, id: REPORT_ID }) });
    }
    return route.abort();
  });
  return reports;
}

test("als Gast: freundlicher Satz und zwei Knöpfe, kein Programmierer-Text", async ({ page }) => {
  const reports = await mockBrokenServersPage(page, null);
  await page.goto("/servers");
  const card = page.getByTestId("page-error");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Diese Seite konnte nicht angezeigt werden");
  await expect(card.getByRole("button", { name: /Neu laden/ })).toBeVisible();
  await expect(card.getByRole("link", { name: /Startseite/ })).toBeVisible();
  await expect(page.getByTestId("page-error-details")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("is not a function");
  await expect(page.locator("body")).not.toContainText("Technische Angaben");
  await expect.poll(() => reports.length).toBeGreaterThan(0);
});

test("als Admin: Technische Angaben zugeklappt, mit Kennung zum Kopieren", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockBrokenServersPage(page, ADMIN);
  await page.goto("/servers");
  const details = page.getByTestId("page-error-details");
  await expect(details).toBeVisible();
  await expect(details).not.toHaveAttribute("open", /.*/);
  await expect(page.getByTestId("page-error-technical")).toBeHidden();

  await details.locator("summary").click();
  const technical = page.getByTestId("page-error-technical");
  await expect(technical).toBeVisible();
  await expect(technical).toContainText("is not a function");
  await expect(technical).toContainText("Seite: /servers");
  await expect(technical).toContainText(`Kennung: ${REPORT_ID}`);
  await expect(page.getByTestId("page-error-log-link")).toHaveAttribute("href", `/admin/ops?tab=app&q=${REPORT_ID}`);

  await page.getByTestId("page-error-copy").click();
  await expect(page.getByTestId("page-error-copied")).toHaveText("Kopiert");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(`Kennung: ${REPORT_ID}`);
  expect(copied).toContain("Seite: /servers");
});
