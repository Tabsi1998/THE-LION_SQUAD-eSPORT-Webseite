const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn } = require("./abnahmeSession");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Ergebnisse externer Serien eintragen (#1744),
// über die API (die Oberfläche kommt mit P5b). Der Vorstand (Admin) prüft ein Blatt in der Vorschau - es ändert nichts -,
// übernimmt es mit Version (ein zweites Übernehmen auf denselben Stand bekommt 409) und sieht unbekannte Namen als
// offene Teilnehmer. Die Turnierleitung als Captain der Saison ändert das veröffentlichte Blatt nur als Entwurf
// daneben; der Vorstand gibt ihn frei. Ein Termin einer anderen Saison antwortet 404. Captain kann nur ein aktives
// Vereinsmitglied sein: die Turnierleitung wird dafür Mitglied, am Ende steht ihre Mitgliedschaft wieder auf „keine“.
// Nur erfundene Namen. Läuft nur mit ABNAHME=1.

const SERIES = "/api/reference-series/admin";

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
});
