const { test, expect } = require("@playwright/test");

// Finanzen, Dolibarr und Kontakt (#2131) bei 390 und 1440 px: Export mit Zeitraum, erledigte Prüffälle, signierter Webhook,
// Kontakt-Inbox mit Antwort, Rückmeldungen und „Fehler melden“. Server und Konto sind Attrappen; nichts geht wirklich hinaus.

const WIDTHS = [["handy", 390, 844], ["pc", 1440, 900]];
const ADMIN = { id: "u-root", username: "root", display_name: "Sam Admin", role: "superadmin",
  areas: ["tournaments", "content", "club", "finance", "system", "moderation"], mfa_enabled: true, auth_mfa_verified: true };
const SOURCE = { name: "Lion Squad Winter-LAN 2026 – Wochenende mit Übernachtung", slug: "winter-lan", kind: "event" };

const OVERVIEW = {
  by_status: {}, labels: {}, payment_labels: { overdue: "überfällig" },
  open: [], open_total: 0,
  invoiced: [{ id: "o2", kind: "event", source_id: "e1", user_id: "u2", status: "invoiced", total_cents: 4000, currency: "EUR", total: "40,00 €", invoice_ref: "FA2609-000123",
    invoice_status: "validated", payment_state: "overdue", payment_label: "überfällig", due_on: "2026-10-01", remaining_cents: 4000, paid_cents: 0, refunded_cents: 0, credited_cents: 0,
    synced_at: "2026-10-14T08:00:00+00:00", source: SOURCE, person: "Maximiliane Sophie Mustermann-Oberhuber" }],
  invoiced_total: 1234, cases: [], cases_open: 0, cases_resolved: 1, summary: null, pdfs: { unconfirmed: 0 }, attention: { overdue: 1, pdf_missing: 0, draft_old: 0 }, attention_labels: { overdue: "überfällig", pdf_missing: "PDF fehlt", draft_old: "Entwurf alt" },
  dolibarr: { connected: true, mode: "live", write_capable: true, terms_complete: true, invoice_auto_validate: false }, tax_profiles: [], price_bases: {},
};
const RESOLVED = { total: 1, cases: [{ id: "c9", order_id: "o2", status: "resolved", kind: "overpaid", label: "Überzahlung", source: SOURCE, person: "Max", total: "40,00 €",
  resolved_at: "2026-10-24T10:00:00+00:00", resolved_by_name: "Kim Kassa", resolution: "20 € überwiesen, mit dem Mitglied besprochen und in Dolibarr verbucht", detail: {} }] };

const DOLIBARR = {
  mode: "preview", environment: "production", instance: "verein", entity: 1, base_url: "https://erp.example.test", api_key_configured: true, webhook_configured: true,
  signed_webhook: { configured: true, source: "settings", path: "/api/integrations/dolibarr/vereine-webhook", key_id: "website", secret_stored: true },
  features: [], links: {}, open_links: 0, unmapped_types: 0, members_led_by_dolibarr: 0, website_types: [], type_map: {}, sync: { capabilities: { signed_webhooks: true } },
  policy: { active: false, map: {}, derivable_areas: ["club"] },
};

const MESSAGE = { id: "m1", name: "Paula Beispiel mit einem ziemlich langen Namen", email: "paula.mit.langer.adresse@lionsquad-test.at", topic: "report_bug", subject: "Frage zum Turnier am Samstag und was danach kommt",
  message: "Hallo, die Seite hat einen Fehler gezeigt.", status: "new", created_at: "2026-10-27T10:00:00Z", internal_note: "", context: { page: "/events/herbst", device: "Testgerät", version: "1.54.0" } };
const FEEDBACK = { min_for_details: 3, total: 2, summary: { targets: 2, answers: 7, average: 4.2 }, items: [
  { kind: "tournament", target_id: "t1", title: "Winter Cup mit einem sehr langen Namen für die schmale Ansicht", day: "2026-10-20", count: 5, declined: 1, details: true, average: 4.2 },
  { kind: "event", target_id: "e1", title: "Herbst-LAN", day: "2026-10-01", count: 2, declined: 0, details: false, average: null },
] };

async function mockApi(page) {
  const sent = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() !== "GET") {
      sent.push({ method: request.method(), path, body: request.postDataJSON() });
      if (path === "/api/contact/m1/reply") return json({ ...MESSAGE, status: "answered", answered_at: "2026-10-28T10:00:00Z", answered_by_name: "Sam Admin", replies: [{ id: "r1", text: request.postDataJSON().text, by_name: "Sam Admin", at: "2026-10-28T10:00:00Z" }] });
      if (path === "/api/contact/m1") return json({ ...MESSAGE, ...request.postDataJSON(), assigned_to_name: "Sam Admin" });
      if (path === "/api/contact/submit") return json({ ok: true, id: "neu" });
      return json({ ok: true });
    }
    sent.push({ method: "GET", path, query: Object.fromEntries(url.searchParams) });
    if (path === "/api/auth/me") return json(ADMIN);
    if (path === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (path === "/api/admin/finance/overview") return json(OVERVIEW);
    if (path === "/api/admin/finance/cases") return json(RESOLVED);
    if (path === "/api/admin/finance/export.csv") return route.fulfill({ status: 200, contentType: "text/csv; charset=utf-8", headers: { "x-export-rows": "1234" }, body: "﻿Rechnung\r\n" });
    if (path === "/api/admin/dolibarr/status") return json(DOLIBARR);
    if (path === "/api/admin/dolibarr/links") return json([]);
    if (path === "/api/admin/dolibarr/consent-texts") return json({ error: "forbidden", text: "Dem API-Benutzer fehlt ein Recht", texts: [] });
    if (path === "/api/contact/topics") return json([{ value: "general", label: "Allgemeine Anfrage" }, { value: "invoice", label: "Rechnung" }, { value: "report_bug", label: "Fehler melden" }]);
    if (path === "/api/contact/assignees") return json([{ id: "u-root", name: "Sam Admin" }, { id: "u-2", name: "Vera Vorstand" }]);
    if (path === "/api/contact") return json({ items: url.searchParams.get("q") === "nichts" ? [] : [MESSAGE], total: url.searchParams.get("q") === "nichts" ? 0 : 120, page: Number(url.searchParams.get("page") || 1), limit: 50,
      counts: { new: 80, in_progress: 40, answered: 3, closed: 9, spam: 2 }, suspicious: 2, retention: { done_days: 365, spam_days: 30 } });
    if (path === "/api/spam-guard/stats") return json({ today: { caught: 0, by_reason: {} }, week: { caught: 0, by_reason: {} }, labels: {} });
    if (path === "/api/spam-guard/token") return json({ token: "contact.1.a.sig", honeypot: "hp_fax", min_seconds: 0, max_age_seconds: 7200, turnstile: null });
    if (path === "/api/admin/feedback/overview") return json(FEEDBACK);
    if (path === "/api/admin/feedback/tournament/t1") return json({ title: "Winter Cup", count: 5, declined: 1, details: true, average: 4.2, min_for_details: 3, distribution: { 1: 0, 2: 0, 3: 1, 4: 2, 5: 2 }, praised: {}, criticised: {}, texts: [] });
    const list = /notifications|games$|nav$|site-banners|sponsors|partners/.test(path);
    return json(list ? [] : {});
  });
  return sent;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
  expect(overflow, "die Seite läuft nicht seitlich über").toBeLessThanOrEqual(2);
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ isMobile, page }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
      await page.setViewportSize({ width, height });
    });

    test("Finanzen: N von M, Export mit Zeitraum vom Server, erledigte Prüffälle", async ({ page }) => {
      const sent = await mockApi(page);
      await page.goto("/admin/finance");
      await expect(page.getByTestId("finance-invoiced-count")).toContainText("Vollständig ist der CSV-Export", { timeout: 20000 });
      await page.getByTestId("finance-export-from").fill("2026-01-01");
      await page.getByTestId("finance-export-to").fill("2026-12-31");
      await noSideScroll(page);
      const download = page.waitForEvent("download");
      await page.getByTestId("finance-csv").click();
      expect((await download).suggestedFilename()).toBe("abrechnung-2026-01-01-bis-2026-12-31.csv");
      expect(sent.find((row) => row.path === "/api/admin/finance/export.csv").query).toMatchObject({ from: "2026-01-01", to: "2026-12-31" });

      await page.getByTestId("finance-cases-resolved").click();
      await expect(page.getByTestId("finance-resolved-c9")).toContainText("von Kim Kassa");
      await noSideScroll(page);
      if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/finanzen-${label}.png`, fullPage: true });
    });

    test("Dolibarr: Felder für den signierten Webhook, Rückfrage, Lesefehler mit Grund", async ({ page }) => {
      const sent = await mockApi(page);
      await page.goto("/admin/dolibarr?tab=connection");
      await expect(page.getByTestId("dolibarr-signed-key-id")).toHaveValue("website", { timeout: 20000 });
      await expect(page.getByTestId("dolibarr-signed-secret")).toHaveAttribute("type", "password");
      await expect(page.getByTestId("dolibarr-signed-secret")).toHaveValue("");
      await noSideScroll(page);
      if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/dolibarr-${label}.png`, fullPage: true });
      await page.getByTestId("dolibarr-signed-secret").fill("g".repeat(40));
      await page.getByTestId("dolibarr-signed-save").click();
      await page.getByRole("dialog").getByRole("button", { name: "Speichern" }).click();
      await expect.poll(() => sent.find((row) => row.method === "PUT" && row.path === "/api/admin/dolibarr/settings")?.body).toEqual({ signed_webhook_key_id: "website", signed_webhook_secret: "g".repeat(40) });

      await page.getByTestId("dolibarr-webhook-new").click();
      await expect(page.getByRole("dialog")).toContainText("Die bisherige Adresse gilt dann nicht mehr");
      await page.getByRole("dialog").getByRole("button", { name: "Abbrechen" }).click();
      expect(sent.some((row) => row.path === "/api/admin/dolibarr/webhook-token")).toBe(false);

      await page.goto("/admin/dolibarr?tab=features");
      await expect(page.getByTestId("dolibarr-feature-rows").or(page.getByText("Noch kein Stand geladen."))).toBeVisible({ timeout: 20000 });
    });

    test("Kontakt-Inbox: offen als Standard, Suche, zuständig, Antwort mit Rückfrage", async ({ page }) => {
      const sent = await mockApi(page);
      await page.goto("/admin/contact");
      await expect(page.getByTestId("contact-row-m1")).toBeVisible({ timeout: 20000 });
      expect(sent.find((row) => row.path === "/api/contact").query.status).toBe("open");
      await expect(page.getByTestId("contact-paging")).toContainText("Seite 1 von 3");
      await expect(page.getByTestId("contact-topic-m1")).toHaveText("Fehler melden");
      await noSideScroll(page);

      await page.getByTestId("contact-search").fill("nichts");
      await expect(page.getByTestId("contact-empty")).toHaveText("Nichts gefunden.");
      await page.getByTestId("contact-search").fill("");
      await page.getByTestId("contact-row-m1").click();

      await expect(page.getByTestId("contact-context")).toContainText("/events/herbst");
      await noSideScroll(page);
      await page.getByTestId("contact-assignee").selectOption("u-root");
      await expect.poll(() => sent.find((row) => row.method === "PATCH")?.body).toEqual({ assigned_to: "u-root" });

      await page.getByTestId("contact-reply-text").fill("Danke, wir schauen uns das an.");
      await page.getByTestId("contact-reply-send").click();
      await expect(page.getByRole("dialog")).toContainText(MESSAGE.email);
      await page.getByRole("dialog").getByRole("button", { name: "Senden" }).click();
      await expect(page.getByTestId("contact-history")).toContainText("Danke, wir schauen uns das an.");
      await expect(page.getByTestId("contact-detail-status")).toHaveText("Beantwortet");
      await noSideScroll(page);
      if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/kontakt-${label}.png`, fullPage: true });
    });

    test("Rückmeldungen: Übersicht, unter drei nur die Zahl, Auswertung klappt auf", async ({ page }) => {
      await mockApi(page);
      await page.goto("/admin/feedback");
      await expect(page.getByTestId("feedback-average-t1")).toContainText("4,2", { timeout: 20000 });
      await expect(page.getByTestId("feedback-few-e1")).toHaveText("zu wenige");
      await page.getByTestId("feedback-open-t1").click();
      await expect(page.getByTestId("feedback-report")).toBeVisible();
      await noSideScroll(page);
    });

    test("Fehler melden: von der 404-Seite ins Formular, die Person sieht, was mitgeht", async ({ page }) => {
      const sent = await mockApi(page);
      await page.goto("/gibt-es-nicht-2131?geheim=1");
      await page.getByTestId("error-report-btn").click({ timeout: 20000 });
      const box = page.getByTestId("contact-bug-context");
      await expect(box).toContainText("Seite: /gibt-es-nicht-2131");
      await expect(box).not.toContainText("geheim");
      await expect(page.getByTestId("contact-name")).toHaveAttribute("maxlength", "120");
      await noSideScroll(page);
      await page.getByTestId("contact-email-input").fill("sam@lionsquad-test.at");
      await page.getByTestId("contact-message").fill("Beim Öffnen kam diese Seite.");
      await page.getByTestId("contact-privacy").check();
      await page.getByTestId("contact-submit").click();
      await expect.poll(() => sent.find((row) => row.path === "/api/contact/submit")?.body?.context?.page).toBe("/gibt-es-nicht-2131");
    });
  });
}
