const { test, expect } = require("@playwright/test");

// Fehler-Sammler (#1657): Admin → Betrieb & Logs → Fehler zeigt Gruppen aus Server, Website und App mit Quelle, Anzahl,
// erstem und letztem Auftreten, Version und oberster Code-Stelle; darüber die Erreichbarkeit. Filter nach Quelle und
// Text. Am Handy (390 px) und am PC (1440 px) ohne Querlauf. Alle Werte sind erfunden.

const ADMIN = { id: "admin-1", email: "admin@example.test", display_name: "Admin", username: "admin", role: "superadmin", is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true };

const GROUPS = [
  {
    fingerprint: "a1b2c3d4e5f60718", source: "web", error_type: "TypeError", route: "/tournaments/:slug/bracket", method: "", status_code: 0, count: 37,
    version: "2.3", first_seen_at: "2026-11-24T07:12:00Z", last_seen_at: "2026-11-24T09:28:00Z", resolved_at: null,
    stack: "renderBracketRound (BracketView.js:412:19)\nmapRounds (BracketView.js:388:7)\nindex.js:1:20",
  },
  {
    fingerprint: "0f9e8d7c6b5a4932", source: "server", error_type: "KeyError", route: "/api/teams/{team_id}", method: "GET", status_code: 500, count: 4,
    version: "2.3", actor: "angemeldet", first_seen_at: "2026-11-23T18:40:00Z", last_seen_at: "2026-11-24T08:05:00Z", resolved_at: null,
    stack: "routes/team_routes.py:118 in get_team\nservices/teams.py:52 in public_view",
  },
  {
    fingerprint: "1122334455667788", source: "app", error_type: "Error", route: "/matches/:id", method: "", status_code: 0, count: 2,
    version: "1.9.4", first_seen_at: "2026-11-22T20:00:00Z", last_seen_at: "2026-11-22T20:03:00Z", resolved_at: null,
    stack: "submitScore (index.android.bundle:1:88231)",
  },
];

const SUMMARY = {
  open_error_groups: 3, error_groups_24h: 2, slow_requests_24h: 0, slowest_route_24h: null, threshold_ms: 1000,
  checks: { at: "2026-11-24T09:30:00Z", status: "ok", counts: { ok: 14, warn: 0, crit: 0 }, failing: [] },
  reachability: { overall: "ok", checked_at: "2026-11-24T09:31:00Z", targets: { web: { state: "up" }, api: { state: "up" }, database: { state: "up" } } },
};

async function mockAdmin(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  const asked = [];
  await page.route("**/api/**", json([]));
  await page.route("**/api/auth/me", json(ADMIN));
  await page.route("**/api/settings/public", json({ club_name: "THE LION SQUAD" }));
  await page.route("**/api/admin/ops/summary", json(SUMMARY));
  await page.route("**/api/admin/ops/errors**", (route) => {
    const url = new URL(route.request().url());
    asked.push(url.search);
    const source = url.searchParams.get("source") || "all";
    const rows = GROUPS.filter((row) => source === "all" || row.source === source);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(rows) });
  });
  await page.route("**/api/admin/ops/slow**", json({ hours: 24, threshold_ms: 1000, total: 0, routes: [], recent: [] }));
  await page.route("**/api/admin/ops/vitals**", json({ days: 7, retention_days: 30, samples: 0, overall: {}, routes: [] }));
  await page.route("**/api/admin/ops/checks", json({ interval_minutes: 5, history_days: 7, latest: SUMMARY.checks, history: [], recent_bad: [] }));
  return asked;
}

for (const size of [{ name: "Handy", width: 390, height: 844 }, { name: "PC", width: 1440, height: 900 }]) {
  test.describe(`Betrieb → Fehler ${size.name} (${size.width} px)`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("Gruppen aus Server, Website und App mit Quelle, Version und Stelle; Filter nach Quelle", async ({ page }) => {
      const asked = await mockAdmin(page);
      await page.goto("/admin/ops?tab=errors");
      const web = page.getByTestId("ops-error-a1b2c3d4e5f60718");
      await expect(web).toBeVisible();
      await expect(web).toContainText("Website");
      await expect(web).toContainText("renderBracketRound (BracketView.js:412:19)");
      await expect(web).toContainText("Version 2.3");
      await expect(web).toContainText("37×");
      await expect(page.getByTestId("ops-error-0f9e8d7c6b5a4932")).toContainText("HTTP 500");
      await expect(page.getByTestId("ops-reachability")).toContainText("Website: läuft");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      await page.getByTestId("ops-errors-source").selectOption("app");
      await expect(page.getByTestId("ops-error-1122334455667788")).toBeVisible();
      await expect(page.getByTestId("ops-error-a1b2c3d4e5f60718")).toHaveCount(0);
      expect(asked.some((search) => search.includes("source=app"))).toBe(true);
    });

    test("die Kennung von der Fehlerseite sucht gleich", async ({ page }) => {
      const asked = await mockAdmin(page);
      await page.goto("/admin/ops?tab=errors&q=a1b2c3d4");
      await expect(page.getByTestId("ops-errors-search")).toHaveValue("a1b2c3d4");
      await expect.poll(() => asked.some((search) => search.includes("q=a1b2c3d4"))).toBe(true);
    });
  });
}
