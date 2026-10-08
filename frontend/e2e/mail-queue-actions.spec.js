const { test, expect } = require("@playwright/test");

// Mail-Warteschlange (#1361): eine gesendete und eine fehlgeschlagene Mail - nur bei der fehlgeschlagenen steht
// „Nochmal versuchen“, der Stand steht auf Deutsch. Bei 390, 768 und 1440 px; der Server ist eine Attrappe.

const WIDTHS = [["handy", 390, 844], ["tablet", 768, 1024], ["pc", 1440, 900]];
const ADMIN = { id: "u-sys", username: "sam", display_name: "Sam System", role: "club_admin", mfa_enabled: true, auth_mfa_verified: true };
const JOBS = [
  { id: "m-failed", to: "anna@example.test", subject: "Deine Anmeldung ist eingegangen", template_key: "registration_received", template_label: "Turnier: Anmeldung eingegangen",
    status: "failed", attempts: 5, last_error: "(550, b'5.1.1 user unknown')", created_at: "2026-10-08T07:00:00+00:00", updated_at: "2026-10-08T07:40:00+00:00" },
  { id: "m-sent", to: "ben@example.test", subject: "Dein Gewinn liegt bereit", template_key: "prize_ready", template_label: "Gewinn abholbereit", status: "sent", attempts: 1,
    sent_at: "2026-10-08T17:00:00+00:00", created_at: "2026-10-08T16:59:00+00:00", updated_at: "2026-10-08T17:00:00+00:00" },
];

async function mockApi(page, state) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const retry = url.pathname.match(/^\/api\/settings\/mail-queue\/([^/]+)\/retry$/);
    if (request.method() === "POST" && retry) {
      state.retried.push(retry[1]);
      state.jobs = state.jobs.map((job) => (job.id === retry[1] ? { ...job, status: "pending", attempts: 0, last_error: null, next_attempt_at: "2026-10-08T18:00:00+00:00" } : job));
      return json({ ok: true });
    }
    if (request.method() !== "GET") return json({ ok: true });
    if (url.pathname === "/api/auth/me") return json(ADMIN);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (url.pathname === "/api/settings/mail-queue/stats") {
      const counts = { pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };
      for (const job of state.jobs) counts[job.status] += 1;
      return json({ counts, due_pending: counts.pending, stale_sending: 0, latest_problem: null, max_attempts: 5, stale_after_minutes: 15 });
    }
    if (url.pathname === "/api/settings/mail-queue") return json(state.jobs);
    if (url.pathname === "/api/settings/email/logs") return json([]);
    const list = /notifications|games$|nav$|site-banners|sponsors|partners|tournaments|challenges|events|counters/.test(url.pathname);
    return json(list ? [] : {});
  });
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
      await page.setViewportSize({ width, height });
    });

    test("nur die fehlgeschlagene Mail hat „Nochmal versuchen“", async ({ page }) => {
      const state = { jobs: JOBS.map((job) => ({ ...job })), retried: [] };
      await mockApi(page, state);
      await page.goto("/admin/settings/mail-queue");
      const prefix = width >= 1024 ? "queue" : "queue-card";
      await expect(page.getByTestId(`${prefix}-state-m-failed`)).toHaveText(/Fehlgeschlagen/);
      await expect(page.getByTestId(`${prefix}-state-m-sent`)).toHaveText(/Gesendet/);
      await expect(page.getByTestId(`${prefix}-detail-m-failed`)).toContainText("Postfach unbekannt");
      const visibleRetry = page.getByRole("button", { name: "Nochmal versuchen", exact: true }).filter({ visible: true });
      await expect(visibleRetry).toHaveCount(1);
      await expect(page.getByTestId(`${prefix}-retry-m-sent`)).toHaveCount(0);
      await expect(page.getByTestId("queue-filter").locator("option")).toHaveText(["Alle", "Wartet", "Wird gesendet", "Gesendet", "Fehlgeschlagen", "Übersprungen"]);

      await page.getByTestId(`${prefix}-retry-m-failed`).click();
      await expect.poll(() => state.retried).toEqual(["m-failed"]);
      await expect(page.getByTestId(`${prefix}-state-m-failed`)).toHaveText(/Wartet/);
      await expect(visibleRetry).toHaveCount(0);
      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(2);
    });
  });
}
