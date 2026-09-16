const { test, expect } = require("@playwright/test");

// Betrieb II (#265): Admin → Betrieb hat die Reiter Vitals und Checks, die
// Tageszentrale zeigt die Ampel der Auto-Checks in der Kachel „Betrieb“.

const ADMIN = { id: "admin-1", email: "admin@example.test", display_name: "Admin", username: "admin", role: "superadmin", is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true };

const OPS_SUMMARY = { open_error_groups: 0, error_groups_24h: 0, slow_requests_24h: 2, slowest_route_24h: null, threshold_ms: 1000, checks: { at: "2026-09-16T12:05:00Z", status: "crit", counts: { ok: 6, warn: 1, crit: 1 }, failing: ["mail_queue", "disk"] } };

const CHECKS = {
  interval_minutes: 5,
  history_days: 7,
  latest: {
    at: "2026-09-16T12:05:00Z",
    status: "crit",
    counts: { ok: 6, warn: 1, crit: 1 },
    failing: ["mail_queue", "disk"],
    checks: [
      { key: "database", label: "Datenbank", status: "ok", value: "12 ms", detail: "Antwortzeit auf ping" },
      { key: "disk", label: "Freier Speicher", status: "warn", value: "9.8 GB frei (12 %)", detail: "" },
      { key: "mail_queue", label: "Mail-Queue", status: "crit", value: "0 wartend, 0 fehlgeschlagen", detail: "0 fällig, 2 hängen im Versand" },
    ],
  },
  history: [{ day: "2026-09-16", runs: 3, warn: 1, crit: 1 }],
  recent_bad: [],
};

const VITALS = {
  days: 7,
  retention_days: 30,
  samples: 8,
  overall: { LCP: { count: 8, p50: 2100, p75: 3900, good_share: 0.5, rating: "needs-improvement" } },
  routes: [{ route: "/galerie/:slug", samples: 8, worst: "poor", metrics: { LCP: { count: 8, p50: 4000, p75: 6100, good_share: 0.1, rating: "poor" } } }],
};

async function mockAdmin(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", json([]));
  await page.route("**/api/auth/me", json(ADMIN));
  await page.route("**/api/settings/public", json({ club_name: "THE LION SQUAD" }));
  await page.route("**/api/settings/auth", json({ password_login_enabled: true }));
  await page.route("**/api/admin/system-status", json({ database: { ok: true }, scheduler: { running: true, jobs: [] }, mail_queue: { pending: 0, failed: 0 } }));
  await page.route("**/api/admin/dashboard", json({
    ops: OPS_SUMMARY,
    player_count: 42, team_count: 7, active_tournaments: 2, registration_open: 1, today_matches: 3, active_f1: 0, total_events: 11, open_disputes: 0,
    membership_applications: { pending: 0 }, tournament_registrations: { pending: 0 }, prize_pickups: { pending: 0, ready: 0 },
    mobile_push: { active_tokens: 12, ticket_errors: 0, receipt_errors: 0 }, client_logs: { open: 0, critical_open: 0, high_open: 0 }, recent_audit_logs: [],
  }));
  await page.route("**/api/admin/growth-stats**", json({ days: [] }));
  await page.route("**/api/setup/status", json({ completed: true, health_score: 100, missing: [] }));
  await page.route("**/api/admin/ops/summary", json(OPS_SUMMARY));
  await page.route("**/api/admin/ops/errors**", json([]));
  await page.route("**/api/admin/ops/slow**", json({ hours: 24, threshold_ms: 1000, total: 0, routes: [], recent: [] }));
  await page.route("**/api/admin/ops/vitals**", json(VITALS));
  await page.route("**/api/admin/ops/checks", json(CHECKS));
  await page.route("**/api/admin/ops/checks/run", json({ ...CHECKS.latest, status: "ok", counts: { ok: 8, warn: 0, crit: 0 }, failing: [], checks: CHECKS.latest.checks.map((c) => ({ ...c, status: "ok" })) }));
}

test("Betrieb hat die Reiter Vitals und Checks mit Ampel und Jetzt prüfen", async ({ page, isMobile }) => {
  test.skip(isMobile, "Der Adminbereich ist für den Desktop gebaut.");
  await mockAdmin(page);
  await page.goto("/admin/ops");

  await page.getByRole("button", { name: "Checks" }).click();
  await expect(page.getByTestId("ops-check-mail_queue")).toContainText("2 hängen im Versand");
  await expect(page.getByTestId("ops-checks-summary")).toContainText("Mail-Queue: rot");
  await page.getByTestId("ops-checks-run").click();
  await expect(page.getByTestId("ops-checks-summary")).toContainText(/Alle Prüfungen grün/);

  await page.getByRole("button", { name: "Vitals" }).click();
  await expect(page.getByTestId("ops-vitals-/galerie/:slug")).toContainText("6100 ms");
});

test("die Tageszentrale färbt die Kachel Betrieb nach der Ampel der Checks", async ({ page, isMobile }) => {
  test.skip(isMobile, "Der Adminbereich ist für den Desktop gebaut.");
  await mockAdmin(page);
  await page.goto("/admin");

  const tasks = page.getByTestId("dashboard-tasks");
  await expect(tasks).toContainText("Checks: 1 rot, 1 gelb");
});
