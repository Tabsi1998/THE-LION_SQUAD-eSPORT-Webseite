const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, state, signIn, watch } = require("./abnahmeSession");

// Abnahme „Regeln dieser Phase“ (#1636) gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Die
// Turnierleitung öffnet im Reiter „Spiele“ die Regeln einer Phase, stellt die Austragung um, speichert, lädt neu und
// findet den Wert wieder; danach zurück auf „Vom Turnier erben“. Desktop 1440 und Handy 390, keine Konsolenfehler,
// keine Antwort 4xx/5xx. Läuft nur mit ABNAHME=1 und einem befüllten Abnahme-Stand (scripts/seed_abnahme.py).

const SHOTS = process.env.ABNAHME_SHOTS || "";

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

async function openRules(page, tid) {
  await page.goto(`/admin/tournaments/${tid}?tab=stages`);
  const toggle = page.locator("[data-testid^='stage-rules-toggle-']").first();
  await expect(toggle).toBeVisible();
  const stageId = (await toggle.getAttribute("data-testid")).replace("stage-rules-toggle-", "");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  return stageId;
}

async function saveRules(page, stageId) {
  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes(`/stages/${stageId}`));
  await page.getByTestId(`stage-rules-save-${stageId}`).click();
  expect((await saved).status()).toBe(200);
}

test.describe("Abnahme: Regeln dieser Phase", () => {
  test.skip(!ENABLED || !state, "nur mit ABNAHME=1 und einem befüllten Abnahme-Stand");
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");
  test.describe.configure({ mode: "serial" });

  const tid = state?.tournaments?.online;

  for (const [label, size] of [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]]) {
    test(`Turnierleitung: Austragung umstellen, speichern, neu laden (${label} px)`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(size);
      await signIn(page, "lead");
      const problems = watch(page);

      let stageId = await openRules(page, tid);
      const select = () => page.getByTestId(`stage-rules-event-mode-${stageId}`);
      const hint = () => page.getByTestId(`stage-rules-event-mode-hint-${stageId}`);
      await expect(select()).toHaveValue("");
      await expect(hint()).toContainText("wie es beim Turnier eingestellt ist");
      await select().selectOption("local");
      await expect(hint()).toContainText("Stationen");
      await shot(page, `phasen-regeln-${label}-offen.png`);
      await saveRules(page, stageId);

      // Neu laden: der Wert steht da, die Karte zeigt ihn im Kopf.
      stageId = await openRules(page, tid);
      await expect(select()).toHaveValue("local");
      await expect(page.getByText("· Vor Ort").first()).toBeVisible();
      // Keine Waagrecht-Rolle am Handy.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await shot(page, `phasen-regeln-${label}-gespeichert.png`);

      // Zurück auf „Vom Turnier erben“, damit der Stand für weitere Läufe gleich bleibt.
      await select().selectOption("");
      await saveRules(page, stageId);
      stageId = await openRules(page, tid);
      await expect(select()).toHaveValue("");

      expect(problems, problems.join("\n")).toEqual([]);
    });
  }
});
