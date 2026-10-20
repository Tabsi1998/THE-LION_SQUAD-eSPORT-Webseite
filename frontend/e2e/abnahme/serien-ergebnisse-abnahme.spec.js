const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Ergebnisse externer Serien eintragen (#1744),
// erst über die API, dann über die Oberfläche (P5b). Der Vorstand (Admin) prüft ein Blatt in der Vorschau - es ändert nichts -,
// übernimmt es mit Version (ein zweites Übernehmen auf denselben Stand bekommt 409) und sieht unbekannte Namen als
// offene Teilnehmer. Die Turnierleitung als Captain der Saison ändert das veröffentlichte Blatt nur als Entwurf
// daneben; der Vorstand gibt ihn frei. Ein Termin einer anderen Saison antwortet 404. Captain kann nur ein aktives
// Vereinsmitglied sein: die Turnierleitung wird dafür Mitglied, am Ende steht ihre Mitgliedschaft wieder auf „keine“.
// Die Oberfläche: Liste, Einfügen, Vorschau, Speichern, 409 mit „deinen nicht gespeicherten Änderungen“, Captain-Entwurf
// und Freigabe, bei 1440 und 390 px. `ABNAHME_SHOTS` legt Bilder des Blatts ab (optional).
// Nur erfundene Namen. Läuft nur mit ABNAHME=1.

const SERIES = "/api/reference-series/admin";
const SHOTS = process.env.ABNAHME_SHOTS || "";

async function shot(page, locator, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await locator.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** Anfrage wie die Website: mit dem CSRF-Kopf aus dem Cookie der Sitzung. */
async function send(page, method, url, data) {
  const cookies = await page.context().cookies();
  const csrf = decodeURIComponent(cookies.find((cookie) => cookie.name === "csrf_token")?.value || "");
  return page.request.fetch(url, { method, data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
}

async function ok(response) {
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

test.describe("Abnahme #1744: Ergebnisse eintragen - Vorschau, Version, Entwurf daneben, Freigabe", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.accounts?.admin, `Kein Seed-Stand: ${STATE_FILE} - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test("Vorschau ändert nichts, Übernehmen mit Version, Captain-Entwurf und Freigabe", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "ein Durchgang genügt");
    const stamp = Date.now().toString(36).slice(-5);
    const until = `${new Date().getFullYear() + 1}-12-31`;
    const names = [`Probe Anna ${stamp}`, `Probe Bert ${stamp}`, `Probe Carl ${stamp}`];
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const captainContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    let admin = null;
    let leadId = null;
    try {
      admin = await adminContext.newPage();
      await signIn(admin, "admin");
      const captain = await captainContext.newPage();
      await signIn(captain, "lead");
      leadId = (await (await captain.request.get("/api/auth/me")).json()).id;

      // Spur, Saison mit Streichergebnis und Finalgrenze, zwei Termine; eine fremde Saison mit einem Termin.
      const lineage = await ok(await send(admin, "POST", `${SERIES}/lineages`, { title: `Probe Ergebnisse ${stamp}`, kind: "racing", label: "F1" }));
      const series = await ok(await send(admin, "POST", `${SERIES}/series`, {
        lineage_id: lineage.id, season: "2026", status: "active", points_scheme_id: "formula_1",
        rules: { count_mode: "drop_n", count_n: 1, final_top_n: 2 },
      }));
      const foreign = await ok(await send(admin, "POST", `${SERIES}/series`, { lineage_id: lineage.id, season: "2027" }));
      const first = await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/rounds`, { day: "2026-01-08", code: "R1" }));
      await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/rounds`, { day: "2026-01-15", code: "R2" }));
      const other = await ok(await send(admin, "POST", `${SERIES}/series/${foreign.id}/rounds`, { day: "2027-01-08" }));
      const results = `${SERIES}/series/${series.id}/rounds/${first.id}/results`;
      const rows = names.map((name, index) => ({ name, place: index + 1 }));

      // Vorschau: neue Namen, Punkte nach Schlüssel, Zwischenstand - gespeichert wird nichts.
      expect((await ok(await admin.request.get(results))).version).toBe(0);
      const preview = await ok(await send(admin, "POST", `${results}/preview`, { rows: [...rows, { name: names[0], place: 4 }] }));
      expect(preview.can_save).toBe(false);
      expect(preview.errors.map((item) => item.code)).toEqual(["duplicate_participant"]);
      const clean = await ok(await send(admin, "POST", `${results}/preview`, { rows }));
      expect(clean.can_save).toBe(true);
      expect(clean.unknown_names.map((item) => item.name)).toEqual(names);
      expect(clean.rows.map((row) => row.scored.points)).toEqual([25, 18, 15]);
      expect(clean.standings.scopes.drivers.map((row) => row.name)).toEqual(names);
      expect(clean.final.top_n).toBe(2);
      const before = await ok(await admin.request.get(`${SERIES}/series/${series.id}/participants`));
      expect(before.participants).toEqual([]);
      expect((await ok(await admin.request.get(results))).sheet).toBeNull();

      // Übernehmen mit Version: neue Namen werden offene Teilnehmer, ein zweites Übernehmen auf Stand 0 bekommt 409.
      const saved = await ok(await send(admin, "PUT", results, { rows, status: "published", expected_version: 0 }));
      expect(saved.version).toBe(1);
      expect(saved.created_participants.map((row) => row.link_status)).toEqual(["open", "open", "open"]);
      const stale = await send(admin, "PUT", results, { rows, status: "published", expected_version: 0 });
      expect(stale.status()).toBe(409);
      const unknown = await ok(await admin.request.get(`${SERIES}/series/${series.id}/unknown-names`));
      expect(unknown.items.map((item) => item.participant.name).sort()).toEqual([...names].sort());
      const calendar = await ok(await admin.request.get(`${SERIES}/series/${series.id}/calendar`));
      expect(calendar.rounds.find((item) => item.id === first.id).status).toBe("scored");

      // Ein Termin einer anderen Saison antwortet 404.
      const foreignResults = `${SERIES}/series/${series.id}/rounds/${other.id}/results`;
      expect((await admin.request.get(foreignResults)).status()).toBe(404);

      // Captain (Turnierleitung, dafür Mitglied): Änderung am veröffentlichten Blatt nur als Entwurf daneben.
      await ok(await send(admin, "PUT", `/api/membership/user/${leadId}`, { member_status: "active" }));
      await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/staff`, { user_id: leadId, valid_until: until }));
      const loaded = await ok(await captain.request.get(results));
      expect(loaded.target).toBe("pending_draft");
      expect(loaded.sheet.created_by).toBeUndefined();
      const swapped = [{ name: names[1], place: 1 }, { name: names[0], place: 2 }, { name: names[2], place: 3 }];
      expect((await send(captain, "PUT", results, { rows: swapped, status: "published", expected_version: 1 })).status()).toBe(403);
      const draft = await ok(await send(captain, "PUT", results, { rows: swapped, status: "draft", expected_version: 1 }));
      expect(draft.target).toBe("pending_draft");
      const beside = (await ok(await admin.request.get(results))).sheet;
      expect(beside.status).toBe("published");
      expect(beside.rows[0].participant_id).toBe(saved.sheet.rows[0].participant_id);
      expect(beside.pending_draft.rows[0].participant_id).toBe(saved.sheet.rows[1].participant_id);
      expect((await send(captain, "POST", `${results}/approve`, { expected_version: 2 })).status()).toBe(403);
      expect((await captain.request.get(foreignResults)).status()).toBe(404);

      // Vorstand gibt frei: der Entwurf wird das Blatt.
      const approved = await ok(await send(admin, "POST", `${results}/approve`, { expected_version: 2 }));
      expect(approved.sheet.pending_draft).toBeNull();
      expect(approved.sheet.rows[0].participant_id).toBe(saved.sheet.rows[1].participant_id);
      expect((await send(admin, "POST", `${results}/approve`, { expected_version: 3 })).status()).toBe(409);

      // Aufräumen: Saisons und Spur archivieren (gelöscht wird nichts).
      await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/archive`));
      await ok(await send(admin, "POST", `${SERIES}/series/${foreign.id}/archive`));
      await ok(await send(admin, "POST", `${SERIES}/lineages/${lineage.id}/archive`));
    } finally {
      // Die Turnierleitung des Seeds ist sonst kein Mitglied - so bleibt es für die anderen Abnahmen.
      if (admin && leadId) await send(admin, "PUT", `/api/membership/user/${leadId}`, { member_status: "none" });
      await adminContext.close();
      await captainContext.close();
    }
  });

  test("Oberfläche: Liste und Einfügen, Vorschau, Speichern, 409 mit eigenen Eingaben, Captain-Entwurf und Freigabe", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "ein Durchgang genügt");
    const stamp = Date.now().toString(36).slice(-5);
    const until = `${new Date().getFullYear() + 1}-12-31`;
    const [anna, bert, carl] = [`Probe Anna ${stamp}`, `Probe Bert ${stamp}`, `Probe Carl ${stamp}`];
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const captainContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    let admin = null;
    let leadId = null;
    try {
      admin = await adminContext.newPage();
      await signIn(admin, "admin");
      // 409 beim Speichern gehört hier zum Ablauf.
      const problems = watch(admin, {
        allow: (response) => response.status() === 409 && response.url().endsWith("/results"),
        allowConsole: (text) => text.includes("status of 409"),
      });
      const captain = await captainContext.newPage();
      await signIn(captain, "lead");
      leadId = (await (await captain.request.get("/api/auth/me")).json()).id;

      const lineage = await ok(await send(admin, "POST", `${SERIES}/lineages`, { title: `Probe Oberfläche ${stamp}`, kind: "racing", label: "F1" }));
      const series = await ok(await send(admin, "POST", `${SERIES}/series`, {
        lineage_id: lineage.id, season: "2026", status: "active", points_scheme_id: "formula_1", rules: { final_top_n: 2 },
      }));
      const first = await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/rounds`, { day: "2026-01-08", code: "R1", venue: "Probering" }));
      await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/rounds`, { day: "2026-01-15", code: "R2" }));
      const results = `${SERIES}/series/${series.id}/rounds/${first.id}/results`;
      const page = `/admin/reference-series/${series.id}`;
      const openRound = async (target) => {
        await target.getByTestId("results-round").filter({ hasText: "R1" }).getByTestId("results-open").click();
        const sheet = target.getByTestId("result-sheet");
        await expect(sheet.getByTestId("result-rows-section")).toBeVisible();
        return sheet;
      };
      const names = async (sheet) => sheet.getByTestId("result-row-name").evaluateAll((inputs) => inputs.map((input) => input.value));

      // 1. Vorstand trägt per Liste ein: zwei Zeilen, Platz aus der Reihenfolge, Vorschau, Veröffentlichen.
      await admin.goto(page);
      let sheet = await openRound(admin);
      await sheet.getByTestId("result-row-name").first().fill(anna);
      await sheet.getByTestId("result-row-add").click();
      await sheet.getByTestId("result-row-name").nth(1).fill(bert);
      await expect(sheet.getByTestId("result-row-place").nth(1)).toHaveAttribute("placeholder", "2");
      await sheet.getByTestId("result-submit").click();
      await expect(sheet.getByTestId("result-preview")).toBeVisible();
      await expect(sheet.getByTestId("result-row-scored").first()).toContainText("25 Pkt");
      await expect(sheet.getByTestId("preview-unknown-name")).toHaveCount(2);
      await expect(sheet.getByTestId("result-submit")).toHaveText("Veröffentlichen");
      await sheet.getByTestId("result-submit").click();
      // Neue offene Namen: danach öffnet sich „Unbekannte Namen“.
      await expect(admin.getByTestId("unknown-names")).toBeVisible();
      await admin.getByTestId("unknown-names-close").click();
      let stored = await ok(await admin.request.get(results));
      expect(stored.version).toBe(1);
      expect(stored.sheet.status).toBe("published");
      expect(stored.sheet.rows.map((row) => row.place)).toEqual([1, 2]);

      // 2. Einfügen: Liste aus der Zwischenablage, eine Zahl am Namen bleibt beim Namen, Vorschau kommt gleich.
      await expect(admin.getByTestId("results-round").filter({ hasText: "R1" }).getByTestId("results-open")).toHaveText(/ändern/);
      sheet = await openRound(admin);
      expect(await names(sheet)).toEqual([anna, bert]);
      await sheet.getByTestId("result-paste-toggle").click();
      await sheet.getByTestId("result-paste-text").fill(`1. ${bert}  25 FL\n2. ${anna} 18 Pkt\n3. ${carl} 7\n4. Probe Dora ${stamp} DNF`);
      await sheet.getByTestId("result-paste-apply").click();
      await expect(sheet.getByTestId("result-preview")).toBeVisible();
      await expect(sheet.getByTestId("result-row-hint")).toHaveCount(1);
      await sheet.getByTestId("result-row-hint-points").click();
      expect(await names(sheet)).toEqual([bert, anna, carl, `Probe Dora ${stamp}`]);
      await sheet.getByTestId("result-submit").click();
      await expect(sheet.getByTestId("result-preview")).toBeVisible();
      await expect(sheet.getByTestId("preview-standing-row")).toHaveCount(4);
      await shot(admin, sheet, "ergebnis-vorschau-1440");
      await admin.setViewportSize({ width: 390, height: 844 });
      await shot(admin, sheet, "ergebnis-vorschau-390");
      const overflow = await admin.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await admin.setViewportSize({ width: 1440, height: 900 });

      // 3. 409: jemand anderes speichert dazwischen. Neu laden zeigt seinen Stand, die eigenen Eingaben bleiben daneben.
      const theirs = await ok(await send(admin, "PUT", results, { rows: [{ name: carl, place: 1 }, { name: anna, place: 2 }, { name: bert, place: 3 }], status: "published", expected_version: 1 }));
      expect(theirs.version).toBe(2);
      await sheet.getByTestId("result-submit").click();
      await expect(sheet.getByTestId("result-stale")).toBeVisible();
      await sheet.getByTestId("result-reload").click();
      await expect(sheet.getByTestId("result-mine")).toBeVisible();
      await expect.poll(() => names(sheet)).toEqual([carl, anna, bert]);
      await shot(admin, sheet, "ergebnis-409-1440");
      await sheet.getByTestId("result-mine-apply").click();
      expect(await names(sheet)).toEqual([bert, anna, carl, `Probe Dora ${stamp}`]);
      await sheet.getByTestId("result-submit").click();
      await expect(sheet.getByTestId("result-preview")).toBeVisible();
      await sheet.getByTestId("result-submit").click();
      await expect(sheet).toHaveCount(0);
      stored = await ok(await admin.request.get(results));
      expect(stored.version).toBe(3);
      expect(stored.sheet.rows.map((row) => [row.place, row.points, row.marks])).toEqual([
        [1, 25, ["fastest_lap"]], [2, 18, []], [3, 7, []], [4, null, ["dnf"]],
      ]);
      // Eingetragene Punkte zählen; wie der Server die Herkunft ablegt („manual“/„organizer“), prüft die API-Abnahme.
      expect(stored.sheet.rows[3].points_source).toBe("scheme");
      if (await admin.getByTestId("unknown-names").isVisible()) await admin.getByTestId("unknown-names-close").click();

      // 4. Captain (Turnierleitung, dafür Mitglied): Änderung am veröffentlichten Blatt wird Entwurf daneben.
      await ok(await send(admin, "PUT", `/api/membership/user/${leadId}`, { member_status: "active" }));
      await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/staff`, { user_id: leadId, valid_until: until }));
      await captain.goto(page);
      sheet = await openRound(captain);
      await expect(sheet.getByTestId("result-pending-note")).toBeVisible();
      await sheet.getByTestId("result-row-points").nth(2).fill("8");
      await sheet.getByTestId("result-submit").click();
      await expect(sheet.getByTestId("result-preview")).toBeVisible();
      await expect(sheet.getByTestId("result-row-known").first()).toHaveText("bekannt");
      await expect(sheet.getByTestId("preview-unknown-suggestions")).toHaveCount(0);
      await expect(sheet.getByTestId("result-submit")).toHaveText("Entwurf zur Freigabe");
      await captain.setViewportSize({ width: 390, height: 844 });
      await shot(captain, sheet, "ergebnis-captain-390");
      await sheet.getByTestId("result-submit").click();
      await expect(sheet).toHaveCount(0);
      stored = await ok(await admin.request.get(results));
      expect(stored.sheet.rows[2].points).toBe(7);
      expect(stored.sheet.pending_draft.rows[2].points).toBe(8);

      // 5. Vorstand sieht den Entwurf daneben und gibt ihn frei.
      await admin.goto(page);
      sheet = await openRound(admin);
      await expect(sheet.getByTestId("result-pending")).toBeVisible();
      await shot(admin, sheet, "ergebnis-freigabe-1440");
      await sheet.getByTestId("result-pending-approve").click();
      await expect(sheet).toHaveCount(0);
      stored = await ok(await admin.request.get(results));
      expect(stored.sheet.pending_draft).toBeNull();
      expect(stored.sheet.rows[2].points).toBe(8);
      expect(problems).toEqual([]);

      await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/archive`));
      await ok(await send(admin, "POST", `${SERIES}/lineages/${lineage.id}/archive`));
    } finally {
      if (admin && leadId) await send(admin, "PUT", `/api/membership/user/${leadId}`, { member_status: "none" });
      await adminContext.close();
      await captainContext.close();
    }
  });
});
