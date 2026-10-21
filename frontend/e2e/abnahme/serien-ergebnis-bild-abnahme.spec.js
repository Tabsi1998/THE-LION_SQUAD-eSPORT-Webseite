const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Ergebnis-Bild auslesen (#1756). Tesseract muss im
// Backend-Image sein. Die Bilder sind synthetische Screenshots einer Rennliga mit erfundenen Namen
// (backend/tests/result_image_fixture.py, erzeugt mit `ABNAHME_PYTHON` - eine Python-Umgebung mit Pillow).
//
// Ablauf: Vorstand legt Spur, Saison, Termin und die zwölf Teilnehmer an. Im Ergebnis-Blatt fügt er ein leicht
// unscharfes Bild mit Strg+V ein → Übersicht und gelbe Felder → er korrigiert die gelben Felder nach dem Bild (oder
// bestätigt sie mit „Passt so“) → Vorschau → Veröffentlichen. Gespeichert ist genau das Blatt aus dem Bild. Danach am
// Handy (390 px) der Knopf „Bild auslesen“ mit einem sauberen Bild: nichts gelb. `ABNAHME_SHOTS` legt Bilder ab.
// Läuft nur mit ABNAHME=1.

const SERIES = "/api/reference-series/admin";
const SHOTS = process.env.ABNAHME_SHOTS || "";
const FIXTURE = path.join(__dirname, "..", "..", "..", "backend", "tests", "result_image_fixture.py");

async function shot(page, locator, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await locator.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function send(page, method, url, data) {
  const cookies = await page.context().cookies();
  const csrf = decodeURIComponent(cookies.find((cookie) => cookie.name === "csrf_token")?.value || "");
  return page.request.fetch(url, { method, data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
}

async function ok(response) {
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

/** Bilder und Blatt aus der Testhilfe des Backends - dieselben erfundenen Namen wie in den Backend-Tests. */
function makeImages(dir) {
  const python = process.env.ABNAHME_PYTHON || "python";
  fs.mkdirSync(dir, { recursive: true });
  const clean = path.join(dir, "ergebnis-sauber.png");
  const blurry = path.join(dir, "ergebnis-unscharf.jpg");
  const sheet = path.join(dir, "ergebnis.json");
  execFileSync(python, [FIXTURE, clean, "--json", sheet]);
  execFileSync(python, [FIXTURE, blurry, "--blurry"]);
  return { clean, blurry, sheet: JSON.parse(fs.readFileSync(sheet, "utf8")) };
}

/** Strg+V mit einem Bild in der Zwischenablage - so wie der Browser es beim Einfügen eines Screenshots auslöst. */
async function pasteImage(page, file, type) {
  const base64 = fs.readFileSync(file).toString("base64");
  await page.evaluate(({ data, mime }) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "ergebnis", { type: mime }));
    document.body.dispatchEvent(new window.ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, { data: base64, mime: type });
}

const EXPECTED = {
  place: (row) => (row.place ? String(row.place) : ""),
  name: (row) => row.name,
  team: (row) => row.team,
  start_number: (row) => row.number,
};

test.describe("Abnahme #1756: Ergebnis-Bild auslesen - einfügen, Vorschau, korrigieren, übernehmen", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.accounts?.admin, `Kein Seed-Stand: ${STATE_FILE} - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 300_000 });

  test("Strg+V mit unscharfem Bild, gelbe Felder korrigieren, übernehmen; am Handy ein sauberes Bild", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "ein Durchgang genügt");
    const images = makeImages(testInfo.outputPath("bilder"));
    const stamp = Date.now().toString(36).slice(-5);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const admin = await context.newPage();
      await signIn(admin, "admin");
      const problems = watch(admin);

      const lineage = await ok(await send(admin, "POST", `${SERIES}/lineages`, { title: `Probe Bild ${stamp}`, kind: "racing", label: "F1" }));
      const series = await ok(await send(admin, "POST", `${SERIES}/series`, {
        lineage_id: lineage.id, season: "2026", status: "active", points_scheme_id: "formula_1",
      }));
      const round = await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/rounds`, { day: "2026-01-08", code: "R1", venue: images.sheet.track }));
      const ids = {};
      for (const row of images.sheet.rows) {
        const added = await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/participants`, { name: row.name, start_number: row.number, default_team: row.team }));
        ids[row.name] = added.id;
      }
      const results = `${SERIES}/series/${series.id}/rounds/${round.id}/results`;
      const info = await ok(await admin.request.get(`${results}/image`));
      expect(info.template.id).toBe("rennliga-dunkel");
      expect(info.available, "Tesseract fehlt im Backend-Image").toBe(true);

      // 1. Leeres Blatt mit dem neuen Knopf (vorher), dann Strg+V mit einem leicht unscharfen Bild.
      await admin.goto(`/admin/reference-series/${series.id}`);
      await admin.getByTestId("results-round").filter({ hasText: "R1" }).getByTestId("results-open").click();
      const sheet = admin.getByTestId("result-sheet");
      await expect(sheet.getByTestId("result-image-pick")).toBeVisible();
      await shot(admin, sheet, "ergebnis-bild-vorher-1440");
      await pasteImage(admin, images.blurry, "image/jpeg");
      await expect(sheet.getByTestId("result-image-summary")).toBeVisible({ timeout: 60_000 });
      await expect(sheet.getByTestId("result-row")).toHaveCount(images.sheet.rows.length);
      await expect(sheet.getByTestId("result-preview")).toBeVisible();
      const yellow = await sheet.getByTestId("result-row-ocr").count();
      expect(yellow, "das unscharfe Bild hat unsichere Zeilen").toBeGreaterThan(0);
      await expect(sheet.getByTestId("result-submit")).toHaveText("Gelbe Zeilen prüfen");
      await admin.waitForTimeout(1600); // das Aufleuchten der gelben Felder ist vorbei
      await shot(admin, sheet, "ergebnis-bild-gelb-1440");

      // Übernehmen geht noch nicht: der Knopf springt zur ersten gelben Stelle.
      await sheet.getByTestId("result-submit").click();
      await expect(sheet.getByTestId("result-image-open")).toBeVisible();

      // 2. Korrigieren nach dem Bild: jedes gelbe Feld auf den Wert im Bild, übrige gelbe Zeilen mit „Passt so“.
      const rows = sheet.getByTestId("result-row");
      for (let index = 0; index < images.sheet.rows.length; index += 1) {
        const row = rows.nth(index);
        const fields = await row.locator("[data-ocr-uncertain]").evaluateAll((items) => items.map((item) => item.getAttribute("data-ocr-uncertain")));
        for (const field of fields) {
          const testId = field === "start_number" ? "result-row-start" : `result-row-${field}`;
          await row.getByTestId(testId).fill(EXPECTED[field](images.sheet.rows[index]));
        }
        if (await row.getByTestId("result-row-ocr-confirm").count()) await row.getByTestId("result-row-ocr-confirm").click();
      }
      await expect(sheet.getByTestId("result-row-ocr")).toHaveCount(0);
      await expect(sheet.getByTestId("result-image-open")).toHaveCount(0);
      await sheet.getByTestId("result-submit").click();
      await expect(sheet.getByTestId("result-submit")).toHaveText("Veröffentlichen");
      await sheet.getByTestId("result-submit").click();
      await expect(sheet).toHaveCount(0);

      // Gespeichert ist das Blatt aus dem Bild: Reihenfolge, Plätze, Ausfall, schnellste Runde.
      const stored = await ok(await admin.request.get(results));
      expect(stored.sheet.status).toBe("published");
      expect(stored.sheet.rows.map((row) => row.participant_id)).toEqual(images.sheet.rows.map((row) => ids[row.name]));
      expect(stored.sheet.rows.map((row) => row.place)).toEqual(images.sheet.rows.map((row) => row.place));
      expect(stored.sheet.rows.map((row) => row.team)).toEqual(images.sheet.rows.map((row) => row.team));
      const marks = Object.fromEntries(stored.sheet.rows.map((row) => [row.participant_id, row.marks]));
      expect(marks[ids[images.sheet.fastest_name]]).toContain("fastest_lap");
      expect(marks[ids[images.sheet.rows.at(-1).name]]).toContain("dnf");

      // 3. Am Handy: „Bild auslesen“ mit einem sauberen Screenshot - nichts gelb, nichts gespeichert.
      await admin.setViewportSize({ width: 390, height: 844 });
      await admin.getByTestId("results-round").filter({ hasText: "R1" }).getByTestId("results-open").click();
      await expect(sheet.getByTestId("result-image-pick")).toBeVisible();
      await sheet.getByTestId("result-image-file").setInputFiles(images.clean);
      await expect(sheet.getByTestId("result-image-summary")).toBeVisible({ timeout: 60_000 });
      await expect(sheet.getByTestId("result-image-status")).toContainText("Alles sicher gelesen");
      await expect(sheet.getByTestId("result-row-ocr")).toHaveCount(0);
      await expect(sheet.getByTestId("result-row-name")).toHaveCount(images.sheet.rows.length);
      expect(await sheet.getByTestId("result-row-name").evaluateAll((inputs) => inputs.map((input) => input.value))).toEqual(images.sheet.rows.map((row) => row.name));
      await expect(sheet.getByTestId("result-preview")).toBeVisible();
      const overflow = await admin.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await shot(admin, sheet, "ergebnis-bild-nachher-390");
      await sheet.getByTestId("result-image-enlarge").click();
      await shot(admin, sheet, "ergebnis-bild-gross-390");
      await admin.setViewportSize({ width: 1440, height: 900 });
      await shot(admin, sheet, "ergebnis-bild-nachher-1440");
      await sheet.getByTestId("result-sheet-cancel").click();
      expect((await ok(await admin.request.get(results))).version).toBe(stored.version);
      expect(problems).toEqual([]);

      await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/archive`));
      await ok(await send(admin, "POST", `${SERIES}/lineages/${lineage.id}/archive`));
    } finally {
      await context.close();
    }
  });
});
