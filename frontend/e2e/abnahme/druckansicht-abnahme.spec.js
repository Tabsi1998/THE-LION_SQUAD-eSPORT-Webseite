const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Abnahme #1283 gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Druckansicht für den Doppel-K.-o.-Cup und
// den Läufe-Cup (FFA vor Ort). Je Blatt: nichts ragt über den Inhaltsbereich hinaus (Breite und Höhe), A4 im Druck,
// Druckzeit und QR-Code; keine Konsolenfehler. Die Check-in-Liste gibt es nur mit Turnier-Recht - ohne Recht weder in
// der Ansicht noch über die Schnittstelle. Läuft nur mit ABNAHME=1. Mit PRINT_EXAMPLES=<Ordner> legt der Test die PDFs
// und Bilder dort ab (Testdaten), mit ABNAHME_SHOTS die Bilder fürs Handbuch.

const EXAMPLES = process.env.PRINT_EXAMPLES || "";
const SHOTS = process.env.ABNAHME_SHOTS || "";
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 375, height: 812 };

function save(dir, name, buffer) {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buffer);
}

/** Kein Element ragt aus dem Inhaltsbereich seines Blatts; das Blatt selbst ist genau A4. */
async function nothingCut(page) {
  return page.evaluate(() => {
    const out = [];
    const mmPx = 96 / 25.4;
    document.querySelectorAll("[data-orientation]").forEach((sheet, index) => {
      const landscape = sheet.dataset.orientation === "landscape";
      const width = sheet.offsetWidth / mmPx;
      const height = sheet.offsetHeight / mmPx;
      if (Math.abs(width - (landscape ? 297 : 210)) > 1 || Math.abs(height - (landscape ? 210 : 297)) > 1) out.push(`Blatt ${index + 1}: ${width.toFixed(1)} x ${height.toFixed(1)} mm`);
      const body = sheet.querySelector("[data-print-body]");
      if (body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1) {
        out.push(`Blatt ${index + 1}: Inhalt ${body.scrollWidth}x${body.scrollHeight} > ${body.clientWidth}x${body.clientHeight}`);
      }
      const box = body.getBoundingClientRect();
      for (const node of body.querySelectorAll("*")) {
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        if (rect.right > box.right + 1 || rect.bottom > box.bottom + 1 || rect.left < box.left - 1 || rect.top < box.top - 1) {
          out.push(`Blatt ${index + 1}: ${node.tagName.toLowerCase()} „${(node.textContent || "").trim().slice(0, 30)}“ ragt hinaus`);
          break;
        }
      }
      if (!sheet.querySelector("[data-testid='print-stamp']")?.textContent.startsWith("Stand ")) out.push(`Blatt ${index + 1}: ohne Druckzeit`);
      if (!sheet.querySelector("[data-testid='branded-qr-code']")) out.push(`Blatt ${index + 1}: ohne QR-Code`);
    });
    return out;
  });
}

function pdfPages(buffer) {
  return (buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
}

async function checkPrint(page, name) {
  const sheets = page.locator("[data-orientation]");
  await expect(sheets.first()).toBeVisible();
  const count = await sheets.count();
  expect(await nothingCut(page)).toEqual([]);
  // Druck-Medium: Werkzeugleiste weg, Blätter weiter unbeschnitten.
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("print-toolbar")).toBeHidden();
  expect(await nothingCut(page)).toEqual([]);
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  expect(pdfPages(pdf), "eine PDF-Seite je Blatt").toBe(count);
  save(EXAMPLES, `${name}.pdf`, pdf);
  // Bilder im Druck-Medium (ohne Werkzeugleiste): je Teil das erste Blatt.
  if (EXAMPLES || SHOTS) {
    for (const kind of ["baum", "spielplan", "liste", "tagesplan"]) {
      const first = page.getByTestId(`print-sheet-${kind}`).first();
      if (!(await first.count())) continue;
      const image = await first.screenshot();
      save(EXAMPLES, `${name}-${kind}.png`, image);
      save(SHOTS, `druckansicht-${name}-${kind}.png`, image);
    }
  }
  await page.emulateMedia({ media: "screen" });
  return count;
}

test.describe("Abnahme #1283: Druckansicht gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.slugs?.print_double, `Kein passender Seed-Stand: ${STATE_FILE} - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test("Turnierleitung: Doppel-K.-o. mit Baum (quer), Spielplan und Check-in-Liste - nichts abgeschnitten", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "PDF gibt es nur in Chromium");
    await page.setViewportSize(DESKTOP);
    await signIn(page, "lead");
    const problems = watch(page);
    await page.goto(`/tournaments/${state.slugs.print_double}/bracket`);
    await page.getByTestId("bracket-print-link").click();
    await expect(page).toHaveURL(/\/print\/tournaments\/.+teile=baum/);
    await expect(page.getByTestId("print-sheet-baum").first()).toBeVisible();
    // Doppel-K.-o.: Winner, Loser und Grand Final stehen auf dem Papier, jede Spalte mit Rundennamen.
    const blocks = await page.locator("[data-testid='print-block']").allInnerTexts();
    expect(blocks.some((text) => /Winner Bracket/i.test(text))).toBe(true);
    expect(blocks.some((text) => /Loser Bracket/i.test(text))).toBe(true);
    expect(blocks.some((text) => /Grand Final/i.test(text))).toBe(true);
    await expect(page.locator("[data-testid='print-round-title']").first()).not.toBeEmpty();
    expect(await page.getByTestId("print-sheet-baum").first().getAttribute("data-orientation")).toBe("landscape");

    await page.getByTestId("print-part-spielplan").click();
    await expect(page.getByTestId("print-part-spielplan")).toBeChecked();
    await page.getByTestId("print-part-liste").click();
    await expect(page.getByTestId("print-part-liste")).toBeChecked();
    await expect(page.getByTestId("print-sheet-liste").first()).toBeVisible();
    await expect(page.locator("[data-testid='print-checkin-row']").first()).toBeVisible();
    await expect(page.getByLabel(/^(abhaken|schon da)$/).first()).toBeAttached();
    const count = await checkPrint(page, "doppel-ko-baum-spielplan-liste");
    expect(count).toBeGreaterThanOrEqual(3);
    expect(problems).toEqual([]);
  });

  test("Läufe-Cup (FFA vor Ort) nicht angemeldet: Baum und Spielplan, hochkant auch nichts abgeschnitten", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "PDF gibt es nur in Chromium");
    await page.setViewportSize(DESKTOP);
    await signIn(page, "anon");
    const problems = watch(page, { allow: (response) => response.status() === 401 && /\/api\/auth\/(me|refresh)/.test(response.url()), allowConsole: (text) => /401/.test(text) });
    await page.goto(`/print/tournaments/${state.slugs.local_live}?teile=baum,spielplan`);
    await expect(page.locator("[data-testid='print-match']").first()).toBeVisible();
    expect((await page.locator("[data-testid='print-match']").first().innerText())).toMatch(/Lauf/);
    await expect(page.getByTestId("print-part-liste")).toHaveCount(0);
    await checkPrint(page, "laeufe-cup-baum-spielplan");
    await page.getByRole("radio", { name: "Hoch" }).first().click();
    await expect(page.getByTestId("print-sheet-baum").first()).toHaveAttribute("data-orientation", "portrait");
    expect(await nothingCut(page)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("Check-in-Liste ohne Recht: weder Ansicht noch Schnittstelle", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Größe stellt der Test selbst ein");
    const url = `/api/tournaments/${state.slugs.print_double}/print/checkin`;
    await signIn(page, "anon");
    expect((await page.request.get(url)).status()).toBe(401);
    for (const role of ["player", "helper"]) {
      await page.context().clearCookies();
      await signIn(page, role);
      expect((await page.request.get(url)).status(), role).toBe(403);
      await page.goto(`/print/tournaments/${state.slugs.print_double}?teile=liste,baum`);
      await expect(page.getByTestId("print-sheet-baum").first()).toBeVisible();
      await expect(page.getByTestId("print-part-liste")).toHaveCount(0);
      await expect(page.getByTestId("print-sheet-liste")).toHaveCount(0);
    }
  });

  test("Event: Tagesplan und Anmeldeliste mit Begleitung und Warteliste; am Handy Knopf ohne seitliches Überlaufen", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "PDF gibt es nur in Chromium");
    await page.setViewportSize(DESKTOP);
    await signIn(page, "lead");
    const problems = watch(page);
    const slug = state.print_event.slug || state.print_event.id;
    await page.goto(`/events/${slug}/leitung`);
    await page.getByTestId("event-lead-print").click();
    await expect(page).toHaveURL(/\/print\/events\/.+teile=liste/);
    await page.getByTestId("print-part-tagesplan").click();
    await expect(page.getByTestId("print-part-tagesplan")).toBeChecked();
    await expect(page.locator("[data-testid='print-dayplan-row']").first()).toBeVisible();
    await expect(page.getByTestId("print-sheet-liste").first()).toContainText("Begleitung");
    await expect(page.getByTestId("print-sheet-liste").first()).toContainText("Warteliste");
    await checkPrint(page, "event-tagesplan-anmeldeliste");

    await page.setViewportSize(PHONE);
    await expect(page.getByTestId("print-button")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "seitliches Überlaufen").toBeLessThanOrEqual(1);
    if (SHOTS) save(SHOTS, "druckansicht-handy.png", await page.screenshot());
    expect(problems).toEqual([]);
  });
});
