const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Serien (#1741). Der Vorstand legt eine Spur und
// eine Saison an (Vorlage „Formel 1“), bearbeitet Status und eine Regel, öffnet die Seite der Saison und archiviert sie.
// Die öffentliche Referenzliste bleibt dabei genau, wie sie war: dieselbe Antwort von /api/references, derselbe Text
// auf /references (Bilder vorher/nachher mit ABNAHME_SHOTS). Nur erfundene Namen. Läuft nur mit ABNAHME=1.

const SHOTS = process.env.ABNAHME_SHOTS || "";

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  // Bilder fürs Handbuch: erst, wenn die Meldung „Gespeichert.“ wieder weg ist.
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10_000 });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

/** Schreiben wie die Website: mit dem CSRF-Kopf aus dem Cookie der Sitzung. */
async function post(page, url, data) {
  const cookies = await page.context().cookies();
  const csrf = decodeURIComponent(cookies.find((cookie) => cookie.name === "csrf_token")?.value || "");
  return page.request.post(url, { data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
}

test.describe("Abnahme #1741: Serien anlegen, bearbeiten, archivieren - Referenzen unverändert", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.accounts?.admin, `Kein Seed-Stand: ${STATE_FILE} - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test("Spur und Saison anlegen, bearbeiten, archivieren; /references bleibt, wie es war", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "ein Durchgang genügt");
    const stamp = Date.now().toString(36).slice(-5);
    const lineageTitle = `Probe Racing ${stamp}`;
    const referenceTitle = `Probe Herbst Cup ${stamp}`;
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const anonContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const admin = await adminContext.newPage();
      await signIn(admin, "admin");
      const problems = watch(admin);

      // Referenzen wie im Betrieb, über die echte Route.
      for (const body of [
        { title: referenceTitle, organizer: "Probe Liga", start_date: "2026-09-12", status: "completed",
          entries: [{ kind: "team", team_name: "Löwen Probe", lineup: ["Max Muster"], placement: 2, team_count: 16 }] },
        { title: `Probe Sommer Liga ${stamp}`, start_date: "2026-07-01", status: "active",
          entries: [{ kind: "solo", lineup: ["Erika Beispiel"], placement: 1 }] },
      ]) {
        const created = await post(admin, "/api/references", body);
        expect(created.status(), await created.text()).toBe(200);
      }

      const anon = await anonContext.newPage();
      await signIn(anon, "anon");
      const before = await (await anon.request.get("/api/references")).json();
      await anon.goto("/references");
      await expect(anon.getByText(referenceTitle).first()).toBeVisible();
      const beforeText = await anon.locator("main").innerText();
      await shot(anon, "references-vorher");

      // Spur anlegen
      await admin.goto("/admin/reference-series");
      await expect(admin.getByRole("heading", { level: 1, name: "Serien" })).toBeVisible();
      await admin.getByTestId("lineage-new").click();
      await admin.getByTestId("lineage-title").fill(lineageTitle);
      await admin.getByTestId("lineage-kind").selectOption("racing");
      await admin.getByTestId("lineage-label").fill("F1");
      await admin.getByTestId("lineage-organizer").fill("Probe Liga");
      await shot(admin, "serien-spur-anlegen");
      await admin.getByTestId("lineage-save").click();
      await expect(admin.getByTestId("lineage-sheet")).toBeHidden();
      const section = admin.locator("section", { hasText: lineageTitle });
      await expect(section).toBeVisible();

      // Saison mit Vorlage anlegen
      await section.getByRole("button", { name: "Saison", exact: true }).click();
      await admin.getByTestId("series-scheme").selectOption("formula_1");
      await expect(admin.getByTestId("series-rules-points")).toHaveValue("25, 18, 15, 12, 10, 8, 6, 4, 2, 1");
      await expect(admin.getByTestId("series-rules-team-enabled")).toBeChecked();
      await admin.getByTestId("series-season").fill("2026");
      await admin.getByTestId("series-tier").fill("Division 1");
      await admin.getByTestId("series-weekday").selectOption("2");
      await admin.getByTestId("series-time").fill("20:30");
      await shot(admin, "serien-saison-anlegen");
      await admin.getByTestId("series-save").click();
      await expect(admin.getByTestId("series-sheet")).toBeHidden();
      const row = section.locator("li", { hasText: "2026 · Division 1" });
      await expect(row).toContainText("Geplant");
      await expect(row).toContainText("Regeln v1");
      await shot(admin, "serien-liste");

      // Bearbeiten: Status und eine Regel - die Version steigt
      await row.getByRole("button", { name: "Saison bearbeiten" }).click();
      await admin.getByTestId("series-status").selectOption("active");
      await admin.getByTestId("series-rules-count-mode").selectOption("drop_n");
      await admin.getByTestId("series-rules-count-n").fill("2");
      await admin.getByTestId("series-rules-note").fill("Zwei Streichergebnisse ab sofort");
      await admin.getByTestId("series-save").click();
      await expect(admin.getByTestId("series-sheet")).toBeHidden();
      await expect(row).toContainText("Läuft");
      await expect(row).toContainText("Regeln v2");

      // Seite der Saison
      await row.getByRole("link", { name: "2026 · Division 1" }).click();
      await expect(admin.getByRole("heading", { level: 1 })).toHaveText("2026 · Division 1");
      await expect(admin.getByTestId("series-detail-rules")).toContainText("2 Streichergebnisse");
      await expect(admin.getByTestId("series-detail-rules")).toContainText("Zwei Streichergebnisse ab sofort");
      await shot(admin, "serien-saison-seite");

      // Archivieren statt Löschen
      await admin.getByTestId("series-detail-archive").click();
      await admin.getByTestId("confirm-dialog-confirm").click();
      await expect(admin.getByTestId("series-detail-archive")).toContainText("Zurückholen");
      await admin.getByTestId("series-detail-back").click();
      await expect(section.locator("li", { hasText: "2026 · Division 1" })).toHaveCount(0);
      await admin.getByTestId("series-show-archived").check();
      await expect(section.locator("li", { hasText: "2026 · Division 1" })).toContainText("Archiviert");
      await shot(admin, "serien-archiviert");
      expect(problems).toEqual([]);

      // Die öffentliche Referenzliste ist unverändert.
      expect(await (await anon.request.get("/api/references")).json()).toEqual(before);
      await anon.reload();
      await expect(anon.getByText(referenceTitle).first()).toBeVisible();
      expect(await anon.locator("main").innerText()).toBe(beforeText);
      await shot(anon, "references-nachher");
    } finally {
      await adminContext.close();
      await anonContext.close();
    }
  });
});
