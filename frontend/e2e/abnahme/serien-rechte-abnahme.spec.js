const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Rechte externer Serien (#1749). Der Vorstand
// (Admin) trägt die Turnierleitung als Captain einer Saison ein - ein Konto mit Zwei-Faktor, aber ohne den Bereich
// Redaktion. Der Captain findet die Saison unter „Mein Dienst → Meine Serien“, öffnet sie ohne die Knöpfe des
// Vorstands und kommt weder an eine fremde Saison noch an Einstellungen der eigenen. Nach dem Entfernen ist das Recht
// sofort weg. Nur erfundene Namen. Läuft nur mit ABNAHME=1.

const SHOTS = process.env.ABNAHME_SHOTS || "";

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10_000 });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

/** Schreiben wie die Website: mit dem CSRF-Kopf aus dem Cookie der Sitzung. */
async function send(page, method, url, data) {
  const cookies = await page.context().cookies();
  const csrf = decodeURIComponent(cookies.find((cookie) => cookie.name === "csrf_token")?.value || "");
  return page.request.fetch(url, { method, data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
}

test.describe("Abnahme #1749: Captain je Serie - Vorstand verwaltet, Captain sieht nur seine Saison", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.accounts?.admin, `Kein Seed-Stand: ${STATE_FILE} - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test("Captain hinzufügen, Meine Serien, keine fremde Saison, entfernen", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "ein Durchgang genügt");
    const stamp = Date.now().toString(36).slice(-5);
    const until = `${new Date().getFullYear() + 1}-12-31`;
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const captainContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const admin = await adminContext.newPage();
      await signIn(admin, "admin");
      const adminProblems = watch(admin);

      // Spur mit zwei Saisons über die echten Routen: eine bekommt den Captain, die andere bleibt fremd.
      const lineage = await send(admin, "POST", "/api/reference-series/admin/lineages", { title: `Probe Captain Liga ${stamp}`, kind: "racing", label: "F1" });
      expect(lineage.status(), await lineage.text()).toBe(200);
      const lineageId = (await lineage.json()).id;
      const own = await send(admin, "POST", "/api/reference-series/admin/series", { lineage_id: lineageId, season: "2026", status: "active", points_scheme_id: "formula_1" });
      expect(own.status(), await own.text()).toBe(200);
      const ownId = (await own.json()).id;
      const foreign = await send(admin, "POST", "/api/reference-series/admin/series", { lineage_id: lineageId, season: "2027" });
      expect(foreign.status(), await foreign.text()).toBe(200);
      const foreignId = (await foreign.json()).id;

      // Vorstand: Captain auf der Seite der Saison hinzufügen
      await admin.goto(`/admin/reference-series/${ownId}`);
      await expect(admin.getByTestId("series-staff-empty")).toBeVisible();
      await admin.getByTestId("series-staff-person-search").fill("Turnierleitung");
      await admin.getByRole("option", { name: /Abnahme Turnierleitung/ }).click();
      await admin.getByTestId("series-staff-new-until").fill(until);
      await admin.getByTestId("series-staff-submit").click();
      const row = admin.getByTestId("series-staff-list").locator("li", { hasText: "Abnahme Turnierleitung" });
      await expect(row).toContainText("Einträge sind Entwürfe, der Vorstand gibt frei");
      await shot(admin, "serien-captains");

      // Captain: „Mein Dienst“ im Menü, „Meine Serien“ mit genau dieser Saison
      const captain = await captainContext.newPage();
      await signIn(captain, "lead");
      const captainProblems = watch(captain, { allow: (response) => response.status() === 403 && response.url().includes(foreignId) });
      const me = await (await captain.request.get("/api/auth/me")).json();
      expect(me.has_series_captain).toBe(true);
      await captain.goto("/admin/dienst");
      await expect(captain.getByRole("heading", { name: "Meine Serien" })).toBeVisible();
      const mine = captain.getByTestId(`duty-series-row-${ownId}`);
      await expect(mine).toContainText(`Probe Captain Liga ${stamp}`);
      await expect(captain.getByTestId(`duty-series-row-${foreignId}`)).toHaveCount(0);
      await shot(captain, "serien-meine-serien");
      await captain.getByTestId(`duty-series-open-${ownId}`).click();
      await expect(captain.getByTestId("series-detail-captain")).toContainText("Du bist Captain dieser Saison");
      await expect(captain.getByTestId("series-detail-edit")).toHaveCount(0);
      await expect(captain.getByTestId("series-detail-archive")).toHaveCount(0);
      await expect(captain.getByTestId("series-staff")).toHaveCount(0);

      // Keine fremde Saison, keine Einstellungen der eigenen, keine Captain-Verwaltung
      expect((await captain.request.get(`/api/reference-series/admin/series/${foreignId}`)).status()).toBe(403);
      expect((await send(captain, "PATCH", `/api/reference-series/admin/series/${ownId}`, { publish_mode: "direct" })).status()).toBe(403);
      expect((await captain.request.get(`/api/reference-series/admin/series/${ownId}/staff`)).status()).toBe(403);
      await captain.goto(`/admin/reference-series/${foreignId}`);
      await expect(captain.getByTestId("series-detail-missing")).toBeVisible();

      // Vorstand entfernt den Captain - das Recht ist sofort weg.
      await row.getByRole("button", { name: /als Captain entfernen/ }).click();
      await admin.getByTestId("confirm-dialog-confirm").click();
      await expect(admin.getByTestId("series-staff-empty")).toBeVisible();
      expect((await captain.request.get(`/api/reference-series/admin/series/${ownId}`)).status()).toBe(403);
      expect((await (await captain.request.get("/api/users/me/duty")).json()).series).toEqual([]);

      expect(adminProblems).toEqual([]);
      expect(captainProblems).toEqual([]);
    } finally {
      await adminContext.close();
      await captainContext.close();
    }
  });
});
