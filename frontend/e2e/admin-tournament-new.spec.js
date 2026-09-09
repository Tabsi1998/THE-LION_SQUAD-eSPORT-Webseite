const { test, expect } = require("@playwright/test");

/**
 * Was beim Anlegen eines Turniers sofort sichtbar ist - und was nicht.
 *
 * Der Bildschirm zeigte vorher siebzehn Bedienelemente auf einmal, darunter drei
 * Auswahllisten und drei Knöpfe für dieselben drei Werte. Diese Tests halten die
 * neue Aufteilung fest, damit sie beim nächsten Feld nicht wieder zuwächst.
 */

async function mockAdminSession(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true,
      external_media: false,
      analytics: false,
      meta: false,
      tiktok: false,
      saved_at: Date.now(),
      expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "admin-1",
        email: "admin@example.test",
        display_name: "Admin",
        username: "admin",
        role: "superadmin",
        is_tournament_staff: true,
        mfa_enabled: true,
        auth_mfa_verified: true,
      }),
    });
  });
  await page.route("**/api/settings/public", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        club_name: "THE LION SQUAD",
        domain: "lionsquad.at",
        mascot_url: "/assets/brand/tls-mascot.png",
        qr_logo_url: "/assets/brand/tls-mascot.png",
      }),
    });
  });
  await page.route("**/api/games", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: "game-1", name: "Mario Kart 8 Deluxe", slug: "mario-kart-8" }]),
    });
  });
  await page.route("**/api/events**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  });
}

async function openForm(page) {
  await mockAdminSession(page);
  await page.goto("/admin/tournaments/new");
  await expect(page.getByRole("heading", { name: /neues turnier/i })).toBeVisible();
}

test("das Wesentliche steht oben, ohne etwas aufklappen zu müssen", async ({ page }) => {
  await openForm(page);

  for (const testId of ["new-tr-title", "new-tr-game", "new-tr-format", "new-tr-mode",
                        "new-tr-max", "new-tr-start"]) {
    await expect(page.getByTestId(testId)).toBeVisible();
  }
});

test("Pflichtfelder sind als solche erkennbar", async ({ page }) => {
  await openForm(page);

  await expect(page.getByTestId("new-tr-title")).toHaveAttribute("required", "");
  await expect(page.getByTestId("new-tr-game")).toHaveAttribute("required", "");
});

test("die drei Regel-Listen liegen hinter der Voreinstellung", async ({ page }) => {
  // Vorher standen Auswahlliste und Knopf für denselben Wert übereinander.
  await openForm(page);

  await expect(page.getByRole("button", { name: /^online$/i })).toBeVisible();
  await expect(page.getByTestId("new-tr-event-mode")).not.toBeVisible();

  await page.getByText(/abweichend einstellen/i).click();

  await expect(page.getByTestId("new-tr-event-mode")).toBeVisible();
  await expect(page.getByTestId("new-tr-result-entry-mode")).toBeVisible();
  await expect(page.getByTestId("new-tr-schedule-mode")).toBeVisible();
});

test("eine Voreinstellung setzt alle drei Werte auf einmal", async ({ page }) => {
  await openForm(page);

  await page.getByRole("button", { name: /vor ort/i }).click();
  await page.getByText(/abweichend einstellen/i).click();

  await expect(page.getByTestId("new-tr-event-mode")).toHaveValue("local");
  await expect(page.getByTestId("new-tr-result-entry-mode")).toHaveValue("staff_only");
  await expect(page.getByTestId("new-tr-schedule-mode")).toHaveValue("fixed_by_staff");
});

test("Texte und Bilder halten den Einstieg nicht auf", async ({ page }) => {
  // Zwei Rich-Text-Editoren und ein Bild-Upload beim Anlegen sind zu viel;
  // sie gehören zur Darstellung und warten hinter ihrem Abschnitt.
  await openForm(page);

  await expect(page.getByTestId("new-tr-description")).not.toBeVisible();
  await expect(page.getByTestId("new-tr-rules")).not.toBeVisible();
  await expect(page.getByTestId("new-tr-slug")).not.toBeVisible();

  await page.getByText(/darstellung und regeln/i).click();

  await expect(page.getByTestId("new-tr-slug")).toBeVisible();
});

test("das Formular bleibt am Telefon ohne Querlauf bedienbar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openForm(page);

  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(2);
});
