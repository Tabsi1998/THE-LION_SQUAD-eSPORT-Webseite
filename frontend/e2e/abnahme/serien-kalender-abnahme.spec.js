const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Kalender je Serie (#1742). Der Vorstand legt eine
// Spur und eine Saison an (Standard Donnerstag 20:30), fügt eine Terminliste ein (Vorschau, dann übernehmen), legt einen
// Termin einzeln an, verschiebt einen (der ursprüngliche Tag bleibt stehen) und sagt einen ab. Öffentlich zeigt die
// Serienseite dieselben Termine; ist die Saison nur für Mitglieder, ist sie für Gäste 404. Nur erfundene Namen.
// Läuft nur mit ABNAHME=1.

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
  return page.request[method](url, { data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
}

test.describe("Abnahme #1742: Kalender je Serie", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.accounts?.admin, `Kein Seed-Stand: ${STATE_FILE} - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test("Liste einfügen, Termin anlegen, verschieben, absagen; öffentlich mit Sichtbarkeit", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "ein Durchgang genügt");
    const stamp = Date.now().toString(36).slice(-5);
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const anonContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const admin = await adminContext.newPage();
      await signIn(admin, "admin");
      const problems = watch(admin);

      // Spur und Saison über die echten Routen (das Anlegen selbst prüft serien-abnahme.spec.js).
      const lineage = await send(admin, "post", "/api/reference-series/admin/lineages", { title: `Probe Kalender ${stamp}`, kind: "racing", label: "F1", organizer: "Probe Liga" });
      expect(lineage.status(), await lineage.text()).toBe(200);
      const { id: lineageId, slug } = await lineage.json();
      const created = await send(admin, "post", "/api/reference-series/admin/series", { lineage_id: lineageId, season: "2026/27", default_weekday: 3, default_time: "20:30", status: "active" });
      expect(created.status(), await created.text()).toBe(200);
      const series = await created.json();

      await admin.goto(`/admin/reference-series/${series.id}`);
      await expect(admin.getByTestId("calendar-empty")).toBeVisible();

      // Liste einfügen: erst die Vorschau mit Fehler, dann korrigiert übernehmen.
      await admin.getByTestId("calendar-paste").click();
      await admin.getByTestId("paste-text").fill("R1 · 05.11. · Probering\nR2 · 31.11. · Teststadt");
      await admin.getByTestId("paste-submit").click();
      await expect(admin.getByTestId("paste-errors")).toContainText("Zeile 2: Datum 31.11. gibt es nicht.");
      await admin.getByTestId("paste-text").fill("R1 · 05.11. · Probering\nR2 · 12.11. 19:00 · Teststadt\nR3 Beispielpark\nR4 · 07.01. · Musterkurs");
      await admin.getByTestId("paste-submit").click();
      const preview = admin.getByTestId("paste-preview");
      await expect(preview).toContainText("Do., 19.11.2026");
      await expect(preview).toContainText("Do., 07.01.2027");
      await shot(admin, "serien-kalender-einfuegen");
      await expect(admin.getByTestId("paste-submit")).toHaveText("4 Termine übernehmen");
      await admin.getByTestId("paste-submit").click();
      await expect(admin.getByTestId("paste-sheet")).toBeHidden();
      const rounds = admin.getByTestId("calendar-round");
      await expect(rounds).toHaveCount(4);
      await expect(rounds.nth(1)).toContainText("Do., 12.11.2026 · 19:00");

      // Einzeln: Vorschlag ist der nächste Donnerstag nach dem letzten Termin, mit 20:30.
      await admin.getByTestId("calendar-new").click();
      await expect(admin.getByTestId("round-day")).toHaveValue("2027-01-14");
      await expect(admin.getByTestId("round-time")).toHaveValue("20:30");
      await admin.getByTestId("round-code").fill("R5");
      await admin.getByTestId("round-venue").fill("Nordring");
      await admin.getByTestId("round-kind").selectOption("final");
      await admin.getByTestId("round-save").click();
      await expect(admin.getByTestId("round-sheet")).toBeHidden();
      await expect(rounds).toHaveCount(5);
      await expect(rounds.nth(4)).toContainText("Finale");

      // Verschieben: R3 auf Samstag, der ursprüngliche Tag bleibt stehen.
      await rounds.nth(2).getByTestId("round-postpone").click();
      await admin.getByTestId("postpone-day").fill("2026-11-21");
      await admin.getByTestId("postpone-save").click();
      await expect(admin.getByTestId("postpone-sheet")).toBeHidden();
      await expect(rounds.nth(2)).toContainText("ursprünglich Do., 19.11.2026");
      await expect(rounds.nth(2).getByTestId("round-state")).toHaveText("Verschoben");

      // Absagen: R4 ist abgesagt und lässt sich wieder ansetzen.
      await rounds.nth(3).getByTestId("round-cancel").click();
      await admin.getByTestId("confirm-dialog-confirm").click();
      await expect(rounds.nth(3).getByTestId("round-state")).toHaveText("Abgesagt");
      await expect(rounds.nth(3).getByTestId("round-reinstate")).toBeVisible();
      await shot(admin, "serien-kalender-verwaltung");
      expect(problems).toEqual([]);

      // Öffentlich: dieselben Termine, ohne Notizen.
      const anon = await anonContext.newPage();
      const url = `/references/series/${slug}/${series.season_slug}`;
      await anon.goto(url);
      const publicRounds = anon.getByTestId("series-page-round");
      await expect(publicRounds).toHaveCount(5);
      await expect(publicRounds.nth(2)).toContainText("ursprünglich Do., 19.11.2026");
      await expect(publicRounds.nth(3)).toContainText("Abgesagt");
      await expect(anon.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await shot(anon, "serien-kalender-oeffentlich");

      // Nur für Mitglieder: Gäste bekommen 404.
      const hidden = await send(admin, "patch", `/api/reference-series/admin/series/${series.id}`, { visibility: "members" });
      expect(hidden.status()).toBe(200);
      const api = await anon.request.get(`/api/reference-series/public/${slug}/${series.season_slug}/calendar`);
      expect(api.status()).toBe(404);
      await anon.reload();
      await expect(anon.getByTestId("series-page-round")).toHaveCount(0);

      // Aufräumen: Saison und Spur archivieren (gelöscht wird nichts).
      await send(admin, "post", `/api/reference-series/admin/series/${series.id}/archive`);
      await send(admin, "post", `/api/reference-series/admin/lineages/${lineageId}/archive`);
    } finally {
      await adminContext.close();
      await anonContext.close();
    }
  });
});
