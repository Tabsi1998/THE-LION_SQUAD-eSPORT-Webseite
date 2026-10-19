const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Abnahme #1838 gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Admin startet unter Auftritt → Jahreszeiten
// die Silvester-Vorschau als Probe. Das Token liegt in dieser Sitzung und geht mit, der Server antwortet mit der
// Probe-Show, Countdown und Feuerwerks-Ebene erscheinen auch in der Verwaltung, und der Canvas zeichnet wirklich (nach
// Mitternacht der Probe leuchten Pixel). „Auf der Website ansehen“ führt im selben Tab auf die Startseite, die Vorschau
// läuft dort weiter. Mit „Bewegung reduzieren“: Countdown ja, Feuerwerk nein - und die Karte sagt warum. 0 Konsolenfehler.
// Läuft nur mit ABNAHME=1. ABNAHME_SHOTS legt zwei Bilder ab.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const DESKTOP = { width: 1440, height: 900 };

test.skip(!ENABLED || !state, `ABNAHME=1 und ${STATE_FILE} nötig`);

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
}

/** Leuchtende Pixel auf dem Himmels-Canvas (Stichprobe): > 0 heißt, das Feuerwerk zeichnet. */
async function litPixels(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("[data-testid=season-sky]");
    if (!canvas) return -1;
    const ctx = canvas.getContext("2d");
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    for (let i = 3; i < data.length; i += 4 * 7) if (data[i] > 40) lit += 1;
    return lit;
  });
}

test("Silvester-Vorschau aus der Verwaltung: Countdown, Feuerwerk, dann auf der Website", async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watch(page);
  await signIn(page, "admin");
  await page.setViewportSize(DESKTOP);
  await page.goto("/admin/settings/jahreszeiten");
  await expect(page.getByTestId("season-new_year-preview")).toBeVisible();
  await expect(page.getByTestId("season-new_year-preview-limits")).toHaveCount(0);
  const answer = page.waitForResponse((response) => response.url().includes("/api/seasonal/active?preview=new_year."));
  await page.getByTestId("season-new_year-preview").click();
  const payload = await (await answer).json();
  expect(payload.preview).toBe(true);
  expect(payload.seasons.map((season) => season.key)).toEqual(["new_year"]);
  expect(payload.seasons[0].data.demo).toBe(true);
  expect(JSON.parse(await page.evaluate(() => sessionStorage.getItem("tls-season-preview"))).token).toMatch(/^new_year\./);

  await expect(page.getByTestId("new-year-countdown")).toBeVisible();
  await expect(page.getByTestId("season-sky")).toBeAttached();
  await expect(page.getByTestId("season-new_year-preview-site")).toBeVisible();
  // Mitternacht der Probe kommt nach 15 Sekunden: Jahreszahl und erste Salve.
  await expect(page.getByTestId("new-year-zero")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => litPixels(page), { timeout: 10_000 }).toBeGreaterThan(50);
  await page.waitForTimeout(2500);
  await shot(page, "1838-silvester-vorschau-admin.png");

  await page.getByTestId("season-new_year-preview-site").click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.season)).toBe("new_year");
  await expect(page.getByTestId("season-sky")).toBeAttached();
  expect(problems).toEqual([]);
});

test("Silvester-Vorschau mit „Bewegung reduzieren“: Countdown ohne Feuerwerk, die Karte sagt warum", async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watch(page);
  await signIn(page, "admin");
  await page.setViewportSize(DESKTOP);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/admin/settings/jahreszeiten");
  const limits = page.getByTestId("season-new_year-preview-limits");
  await expect(limits).toContainText("Bewegung reduzieren");
  await page.getByTestId("season-new_year-preview").click();
  await expect(page.getByTestId("new-year-countdown")).toBeVisible();
  await expect(page.getByTestId("season-sky")).toHaveCount(0);
  await limits.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot(page, "1838-silvester-vorschau-bewegung-reduziert.png");
  expect(problems).toEqual([]);
});
