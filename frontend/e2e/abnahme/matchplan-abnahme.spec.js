const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Abnahme gegen einen echten, lokal laufenden Server (docs/entwicklung/abnahme-lokal.md) - ohne nachgestellte API:
// Admin und Turnierleitung öffnen den Matchplan, wechseln zwischen „Matchplan“ und „Spiele“ hin und her, und die
// Ansicht bleibt stehen. Keine Konsolenfehler, keine Antwort 4xx/5xx. Läuft nur mit ABNAHME=1 und E2E_BASE_URL auf den
// Abnahme-Stand; Konten und Kennungen schreibt scripts/seed_abnahme.py nach .local-testing/abnahme/state.json.

const SHOTS = process.env.ABNAHME_SHOTS || "";

// TOTP nach RFC 6238 (SHA-1, 30 Sekunden, 6 Stellen) - die Konten der Abnahme haben ein Test-Geheimnis.
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

const VIEWS = [
  { key: "local_draft", mode: "local", title: "vor Ort, Baum noch Vorschau" },
  { key: "local_live", mode: "local", title: "vor Ort, nach dem Check-in-Ende, live" },
  { key: "online", mode: "online", title: "online" },
  { key: "league", mode: "league", title: "Liga" },
];

async function expectView(page, mode) {
  await expect(page.locator(".mp")).toHaveAttribute("data-mode", mode);
  if (mode === "local") {
    await expect(page.getByTestId("mp-flow").getByRole("button").first()).toBeVisible();
    await expect(page.getByTestId("mp-order").getByRole("row").nth(1)).toBeVisible();
  } else if (mode === "online") {
    await expect(page.getByTestId("mp-online").getByRole("listitem").first()).toBeVisible();
  } else {
    await expect(page.getByTestId("mp-league").getByTestId(/^mp-week-/).first()).toBeVisible();
  }
}

test.describe("Abnahme: Matchplan gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state, `Kein Seed-Stand: ${STATE_FILE} fehlt - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  for (const role of ["admin", "lead"]) {
    for (const view of VIEWS) {
      test(`${role === "admin" ? "Admin" : "Turnierleitung"}: ${view.title} - Matchplan ↔ Spiele, Ansicht bleibt stehen`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "chromium", "Größe stellt der Test selbst ein");
        await page.setViewportSize({ width: 1440, height: 900 });
        await signIn(page, role);
        const problems = watch(page);
        const tid = state.tournaments[view.key];
        await page.goto(`/admin/tournaments/${tid}?tab=matchplan`);
        await expect(page.getByTestId("mp-settings")).toBeVisible();
        await expectView(page, view.mode);
        // Erst die Antwort des Planers abwarten - danach darf nichts mehr springen.
        await page.waitForTimeout(2_000);
        await expectView(page, view.mode);
        await shot(page, `${role}-${view.key}-matchplan.png`);

        for (let round = 0; round < 3; round += 1) {
          await page.getByTestId("admin-tr-tab-stages").click();
          await expect(page.getByTestId("stages-matchplan-hint")).toBeVisible();
          await expect(page.getByText("Planung speichern")).toHaveCount(0);
          await expect(page.getByLabel("Dauer in Minuten")).toHaveCount(0);
          await page.getByTestId("admin-tr-tab-matchplan").click();
          await expectView(page, view.mode);
          await page.waitForTimeout(1_500);
          await expectView(page, view.mode);
        }
        await page.getByTestId("admin-tr-tab-stages").click();
        await shot(page, `${role}-${view.key}-spiele.png`);
        expect(problems).toEqual([]);
      });
    }
  }
});
