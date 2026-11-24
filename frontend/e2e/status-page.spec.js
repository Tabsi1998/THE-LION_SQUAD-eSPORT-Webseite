const { test, expect } = require("@playwright/test");

// Statusseite (#1657, Entscheidung 15.10.2026): zwei Zustände aus der Überwachung, keine Einzelheiten, nur Deutsch,
// nicht im Suchindex. Am Handy (390 px) und am PC (1440 px) ohne Querlauf.

const SIZES = [
  { name: "Handy", width: 390, height: 844 },
  { name: "PC", width: 1440, height: 900 },
];

async function mockStatus(page, reply) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", json([]));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Nicht angemeldet" }) }));
  await page.route("**/api/settings/public", json({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at" }));
  await page.route("**/api/ops/status", reply);
}

for (const size of SIZES) {
  test.describe(`Statusseite ${size.name} (${size.width} px)`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("alles läuft: ein Satz, nicht im Index, kein Querlauf", async ({ page }) => {
      await mockStatus(page, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ state: "ok", checked_at: "2026-11-24T09:31:00Z" }) }));
      await page.goto("/status");
      const card = page.getByTestId("status-page");
      await expect(card).toHaveAttribute("data-state", "ok");
      await expect(card.getByRole("heading", { name: "Alles läuft" })).toBeVisible();
      await expect(card).toContainText("Zuletzt geprüft");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("Störung: „Störung, wir sind dran“ ohne Einzelheiten - auch wenn der Server gar nicht antwortet", async ({ page }) => {
      await mockStatus(page, (route) => route.fulfill({ status: 502, contentType: "text/html", body: "Bad Gateway" }));
      await page.goto("/status");
      const card = page.getByTestId("status-page");
      await expect(card).toHaveAttribute("data-state", "disturbance");
      await expect(card.getByRole("heading", { name: "Störung, wir sind dran" })).toBeVisible();
      await expect(card).not.toContainText(/Datenbank|API|502|Gateway/);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}
