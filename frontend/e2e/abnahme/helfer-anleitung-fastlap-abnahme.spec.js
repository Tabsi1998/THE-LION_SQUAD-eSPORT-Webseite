const { test, expect } = require("@playwright/test");
const { ENABLED, state, signIn, watch } = require("./abnahmeSession");
const { PC, bilder } = require("./anleitungBilder");

// Die Helfer-Anleitung, Teil „B. Simulator (Fast Lap)“ (docs/handbuch/helfer.md, #1686), gegen den echten Server
// (docs/entwicklung/abnahme-lokal.md): als Helfer an der Schnelleingabe einen Gast anlegen, eine Zeit tippen,
// „Eintragen & nächster Fahrer“ und eine ungültige Runde mit Grund - Schritt für Schritt wie in der Anleitung. Mit
// ABNAHME_SHOTS entstehen dabei die Bilder (PC 1440 px und Handy 390 px, zugeschnitten). Läuft nur mit ABNAHME=1;
// Stand aus scripts/seed_abnahme_fastlap.py (DriftDaniel am Start an Simulator 1, danach Lena als Gast).

const onsite = state?.fastlap?.onsite;
const GUEST = "Mia T.";

test.use({ deviceScaleFactor: 2, viewport: PC });

async function keys(page, text) {
  for (const key of text) await page.getByTestId(`fl-key-${key === ":" ? "colon" : key === "," ? "comma" : key}`).click();
}

test.describe("Abnahme: Helfer-Anleitung (Simulator, Fast Lap)", () => {
  test.skip(!ENABLED || !onsite, "nur mit ABNAHME=1 und dem Stand aus scripts/seed_abnahme_fastlap.py");
  test.skip(({ isMobile }) => Boolean(isMobile), "Breiten stellt der Test selbst ein");

  test("B. Simulator: Fahrer wählen, Zeit tippen, Eintragen & nächster Fahrer, ungültig", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, "helper");
    const problems = watch(page);
    // Öffnen: Fast-Lap-Challenge → ganz oben „Schnelleingabe“.
    await page.goto(`/admin/f1/${onsite.id}`);
    const quick = page.getByTestId("fl-quick");
    await expect(quick).toBeVisible();
    await expect(page.getByTestId("fl-quick-driver-selected")).toContainText("DriftDaniel");

    // 1. Fahrer wählen: Konto (Name suchen) oder Gast (nur Name eintippen).
    await page.getByTestId("fl-quick-driver-clear").click();
    await expect(page.getByTestId("fl-quick-attempt")).toHaveText("Fahrer wählen");
    await page.getByTestId("fl-quick-driver-tab-guest").click();
    await page.getByTestId("fl-quick-driver-guest-name").fill(GUEST);
    await bilder(page, "b1-fahrer", [quick.locator("h2"), page.getByTestId("fl-quick-attempt"), page.getByTestId("fl-quick-driver")]);
    await page.getByTestId("fl-quick-driver-guest-create").click();
    await expect(page.getByTestId("fl-quick-driver-selected")).toContainText(GUEST);
    // Oben steht, der wievielte Versuch es ist.
    await expect(page.getByTestId("fl-quick-attempt")).toHaveText(/Versuch 1 von \d+/);

    // 2. Zeit tippen, z. B. 1:24,587.
    await keys(page, "1:24,587");
    await expect(quick.getByText("= 1:24,587")).toBeVisible();
    await bilder(page, "b2-zeit", [quick.locator("h2"), page.getByTestId("fl-quick-attempt"), page.getByTestId("fl-quick-time"), quick.getByRole("group", { name: "Ziffernblock" })]);

    // 3. „Eintragen & nächster Fahrer“ - der Nächste aus der Liste ist dran.
    await bilder(page, "b3-eintragen", [page.getByTestId("fl-quick-save"), page.getByTestId("fl-quick-save-next"), page.getByTestId("fl-quick-invalid")]);
    await page.getByTestId("fl-quick-save-next").click();
    await expect(page.getByTestId("fl-quick-last")).toContainText(GUEST);
    await expect(page.getByTestId("fl-quick-last")).toContainText("1:24,587");
    await expect(page.getByTestId("fl-quick-driver-selected")).toContainText("Lena");

    // 4. Runde zählt nicht: „Ungültig“ → Grund wählen.
    await page.getByTestId("fl-quick-invalid").click();
    const reasons = page.getByTestId("fl-quick-reasons");
    await expect(reasons).toContainText("Strecke verlassen");
    await bilder(page, "b4-ungueltig", [page.getByTestId("fl-quick-invalid"), reasons]);
    await reasons.getByRole("button", { name: "Strecke verlassen" }).click();
    await expect(page.getByTestId("fl-quick-last")).toContainText("ungültig");
    await expect(page.getByTestId("fl-quick-attempt")).toHaveText(/Versuch 2 von \d+/);
    expect(problems).toEqual([]);
  });
});
