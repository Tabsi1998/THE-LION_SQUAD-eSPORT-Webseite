const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): externe Namen zuordnen (#1743). Der Vorstand
// trägt Namen in eine Saison ein, öffnet „Unbekannte Namen“ und sieht Vorschläge mit Begründung: über die Spiel-ID im
// Konto (stark, vorausgewählt), über den Namen im Profil und keinen bei einem bloß ähnlichen Namen. Er bestätigt
// einmal, markiert einen Gast und einen Externen - in der nächsten Saison wird derselbe Name von selbst erkannt.
// Ohne Anmeldung gibt es weder Teilnehmer noch Aliase. Nur erfundene Namen; was der Test am Admin-Konto und an Profilen
// ändert, nimmt er am Ende zurück. Läuft nur mit ABNAHME=1.

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
  const response = await page.request.fetch(url, { method, data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
  expect(response.status(), `${method} ${url}: ${await response.text()}`).toBe(200);
  return response.json();
}

test.describe("Abnahme #1743: externe Namen den Mitgliedern zuordnen", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.accounts?.admin, `Kein Seed-Stand: ${STATE_FILE} - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test("Vorschläge mit Begründung, einmal bestätigen, Gast und Extern, danach von selbst erkannt", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "ein Durchgang genügt");
    const stamp = Date.now().toString(36).slice(-5);
    const gameId = `Probe_EA_${stamp}`;
    const memberName = `Probe Mitglied ${stamp}`;
    const tagName = `ProbeTag${stamp}`;
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const anonContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const created = { profiles: [], eaBefore: null };
    let admin;
    try {
      admin = await adminContext.newPage();
      await signIn(admin, "admin");
      const problems = watch(admin);

      // Testdaten über die echten Routen: Spiel-ID am eigenen Konto, zwei Vereinsprofile, Spur mit zwei Saisons.
      const me = await (await admin.request.get("/api/auth/me")).json();
      created.eaBefore = me.ea_id ?? null;
      await send(admin, "PATCH", "/api/users/me", { ea_id: gameId });
      const linked = await send(admin, "POST", "/api/membership/profiles/admin", { display_name: memberName, user_id: me.id });
      const tagged = await send(admin, "POST", "/api/membership/profiles/admin", { display_name: `Probe Zweite ${stamp}`, gamertag: tagName });
      created.profiles.push(linked.id, tagged.id);
      const lineage = await send(admin, "POST", "/api/reference-series/admin/lineages", { title: `Probe Zuordnung ${stamp}`, kind: "racing", label: "F1" });
      const first = await send(admin, "POST", "/api/reference-series/admin/series", { lineage_id: lineage.id, season: "2025", points_scheme_id: "formula_1" });
      const second = await send(admin, "POST", "/api/reference-series/admin/series", { lineage_id: lineage.id, season: "2026", points_scheme_id: "formula_1" });

      // Namen eintragen wie aus einer Starterliste
      await admin.goto(`/admin/reference-series/${first.id}`);
      await expect(admin.getByTestId("series-participants")).toBeVisible();
      await admin.getByTestId("series-participants-add").click();
      await admin.getByTestId("participants-add-names").fill([`[TLS] ${gameId}`, tagName, `${tagName}2`, `Gast Probe ${stamp}`, `Fremd Probe ${stamp}`].join("\n"));
      await shot(admin, "serien-zuordnung-namen");
      await admin.getByTestId("participants-add-save").click();
      await expect(admin.getByTestId("participants-add")).toBeHidden();
      await expect(admin.getByTestId("series-unknown-open")).toContainText("Unbekannte Namen (5)");

      // Dialog „Unbekannte Namen“
      await admin.getByTestId("series-unknown-open").click();
      const dialog = admin.getByRole("dialog", { name: "Unbekannte Namen" });
      await expect(dialog).toBeVisible();
      const row = (name) => dialog.locator("li[data-testid^='unknown-']", { hasText: name }).first();
      await expect(row(`[TLS] ${gameId}`)).toContainText("Spiel-ID passt (EA-ID) – ohne Clan-Tag");
      await expect(row(`[TLS] ${gameId}`).locator("select")).toHaveValue(linked.id);
      await expect(row(tagName).first()).toContainText("Name im Profil passt");
      await expect(row(`${tagName}2`)).toContainText("Kein Vorschlag.");
      await shot(admin, "serien-zuordnung-unbekannte-namen");

      await row(`[TLS] ${gameId}`).getByRole("button", { name: "Bestätigen" }).click();
      await expect(row(`[TLS] ${gameId}`)).toHaveCount(0);
      await row(`Gast Probe ${stamp}`).getByRole("button", { name: "Gast" }).click();
      await expect(row(`Gast Probe ${stamp}`)).toHaveCount(0);
      await row(`Fremd Probe ${stamp}`).getByRole("button", { name: "Extern" }).click();
      await expect(row(`Fremd Probe ${stamp}`)).toHaveCount(0);
      await admin.getByTestId("unknown-names-cancel").click();
      await expect(dialog).toBeHidden();

      const list = admin.getByTestId("series-participants-list");
      await expect(list.locator("li", { hasText: `[TLS] ${gameId}` })).toContainText(`Mitglied · ${memberName}`);
      await expect(list.locator("li", { hasText: `Gast Probe ${stamp}` })).toContainText("Gast");
      await expect(list.locator("li", { hasText: `Fremd Probe ${stamp}` })).toContainText("Extern");
      await expect(admin.getByTestId("series-participants-counts")).toContainText("1 Mitglieder · 1 Gäste · 1 Extern · 2 offen");
      await shot(admin, "serien-zuordnung-liste");

      // Nächste Saison: bestätigte Namen erkennt die Website selbst, der Externe bleibt offen.
      await admin.goto(`/admin/reference-series/${second.id}`);
      await admin.getByTestId("series-participants-add").click();
      await admin.getByTestId("participants-add-names").fill([`[TLS] ${gameId}`, `Gast Probe ${stamp}`, `Fremd Probe ${stamp}`].join("\n"));
      await admin.getByTestId("participants-add-save").click();
      const next = admin.getByTestId("series-participants-list");
      await expect(next.locator("li", { hasText: `[TLS] ${gameId}` })).toContainText(`Mitglied · ${memberName}`);
      await expect(next.locator("li", { hasText: `Gast Probe ${stamp}` })).toContainText("Gast");
      await expect(next.locator("li", { hasText: `Fremd Probe ${stamp}` })).toContainText("Offen");
      expect(problems).toEqual([]);

      // Ohne Anmeldung: keine Teilnehmer, keine Aliase.
      const anon = await anonContext.newPage();
      await anon.goto("/");
      for (const url of [`/api/reference-series/admin/series/${first.id}/participants`, `/api/reference-series/admin/series/${first.id}/unknown-names`]) {
        expect([401, 403]).toContain((await anon.request.get(url)).status());
      }
    } finally {
      // Zurücknehmen, was der Test am Admin-Konto und an Profilen geändert hat.
      if (admin) {
        for (const id of created.profiles) await send(admin, "PATCH", `/api/membership/profiles/admin/${id}`, { user_id: null, is_active: false }).catch(() => {});
        await send(admin, "PATCH", "/api/users/me", { ea_id: created.eaBefore ?? "" }).catch(() => {});
      }
      await adminContext.close();
      await anonContext.close();
    }
  });
});
