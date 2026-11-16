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
  // Wie der Server: nach „Jetzt prüfen“ liefert die Übersicht den neuen Lauf.
  const green = { ...CHECKS.latest, status: "ok", counts: { ok: 8, warn: 0, crit: 0 }, failing: [], checks: CHECKS.latest.checks.map((c) => ({ ...c, status: "ok" })) };
  let latest = CHECKS.latest;
  await page.route("**/api/admin/ops/checks", (route) => json({ ...CHECKS, latest })(route));
  await page.route("**/api/admin/ops/checks/run", (route) => {
    latest = green;
    return json(green)(route);
  });
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

// Quittieren (#2447): Überblick zeigt nur Offenes, quittieren einzeln und alle (Rückfrage in der Seite), dann „Alles
// erledigt“; Fehlergruppen direkt in der Zeile lösen. Bei 390 und 1440 px, ohne seitliches Scrollen, Tippflächen ≥ 44 px.
const WIDTHS = [["handy", 390, 844], ["pc", 1440, 900]];
const SHOTS = process.env.E2E_SHOTS || "";
// Bilder fürs Handbuch bzw. den Bericht (E2E_SHOTS): erst wenn Farbwechsel der Kacheln durch sind.
async function shot(page, options) {
  await page.waitForTimeout(400);
  await page.screenshot(options);
}

function opsWorld() {
  const at = "2026-11-16T07:00:00Z";
  const rows = [
    { id: "ep1", ack_id: "ep1", source: "checks", source_label: "Auto-Checks", href: "/admin/ops?tab=checks", severity: "warn", status: "warn", time: "2026-11-13T08:00:00Z",
      title: "Auto-Checks gelb", subtitle: "disk", detail: "seit 13.11. 09:00 · 92× geprüft · zuletzt 16.11. 08:00\n0 rot · 1 gelb · 16 grün" },
    { id: "m1", ack_id: "m1", source: "email", source_label: "E-Mail-Versand", href: "/admin/ops?tab=events&source=email", severity: "error", status: "failed", time: at,
      title: "password_reset", subtitle: "email · s***@beispiel-verein-mit-langer-domain.example", detail: "550 5.1.1 mailbox unavailable" },
    { id: "c1", ack_id: "c1", source: "client", source_label: "App-Logs", href: "/admin/ops?tab=app", severity: "error", status: "open", time: at,
      title: "TypeError: Cannot read properties of undefined (reading 'participants') im Turnierbaum", subtitle: "bracket · android", detail: "" },
  ].map((row) => ({ ...row, open: true, ackable: true, acknowledged_at: "", acknowledged_by: "", resolved_at: "", resolved_label: "" }));
  const labels = { server: "Serverfehler", checks: "Auto-Checks", alerts: "Alarme", client: "App-Logs", email: "E-Mail-Versand", mail_queue: "Mail-Queue",
    audit: "Adminaktionen", uploads: "Uploads", sync: "Dolibarr-Abgleich", bot: "Discord-Bot" };
  const world = { rows, calls: [] };
  world.payload = (state) => {
    const open = world.rows.filter((row) => row.open);
    const items = state === "open" ? open : world.rows.filter((row) => state === "all" || !row.acknowledged_at);
    const sources = Object.entries(labels).map(([key, label]) => ({ key, label, total: 12, latest_at: at, problem_count: open.filter((row) => row.source === key).length }));
    return { items, sources, summary: { shown: items.length, problem_count: open.length }, guilds: [] };
  };
  world.ack = (ids) => {
    for (const row of world.rows) {
      if (ids.includes(row.id)) Object.assign(row, { open: false, ackable: false, acknowledged_at: "2026-11-16T08:15:00Z", acknowledged_by: "Obmann" });
    }
  };
  return world;
}

async function mockOps(page, world) {
  await mockAdmin(page);
  await page.route("**/api/admin/ops/events**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() === "POST") {
      const body = request.postDataJSON() || {};
      world.calls.push({ path: url.pathname, body });
      if (url.pathname.endsWith("/ack-all")) {
        const count = world.rows.filter((row) => row.open).length;
        world.ack(world.rows.map((row) => row.id));
        return json({ acknowledged: { all: count }, total: count });
      }
      world.ack([body.id]);
      return json({ source: body.source, count: 1, kind: "", key: body.id });
    }
    return json(world.payload(url.searchParams.get("state") || ""));
  });
  const group = { fingerprint: "abc123", error_type: "KeyError", message: "'team_id'", route: "/api/teams/{team_id}/members/{member_id}/roles", method: "PATCH",
    status_code: 500, count: 7, first_seen_at: "2026-11-15T08:00:00Z", last_seen_at: "2026-11-16T07:30:00Z", actor: "angemeldet", stack: "Traceback …", resolved_at: null };
  await page.route("**/api/admin/ops/errors**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([group, { ...group, fingerprint: "def456", error_type: "HTTP 503", message: "Antwort 503", route: "/api/shop/checkout", method: "POST", count: 2 }]) }));
  await page.route("**/api/admin/ops/errors/*/resolve", (route) => {
    world.calls.push({ path: new URL(route.request().url()).pathname });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...group, resolved_at: "2026-11-16T08:20:00Z" }) });
  });
}

async function noSideScroll(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
}

async function smallTargets(page, selector) {
  return page.evaluate((sel) => [...document.querySelectorAll(sel)]
    .filter((node) => node.offsetParent !== null)
    .map((node) => ({ text: node.textContent.trim().slice(0, 40), height: Math.round(node.getBoundingClientRect().height) }))
    .filter((node) => node.height < 44), selector);
}

for (const [name, width, height] of WIDTHS) {
  test(`Überblick: offene Probleme quittieren, dann Alles erledigt (${name})`, async ({ page, isMobile }) => {
    test.skip(isMobile, "Breiten stellt der Test selbst ein.");
    await page.setViewportSize({ width, height });
    const world = opsWorld();
    await mockOps(page, world);
    await page.goto("/admin/ops");

    const problems = page.getByTestId("ops-overview-problems");
    await expect(problems.getByTestId("ops-event-email")).toContainText("password_reset");
    await expect(page.getByTestId("ops-overview-source-email")).toContainText("1 auffällig");
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    expect(await smallTargets(page, "[data-testid=ops-overview] button, [data-testid=ops-overview] a")).toEqual([]);
    if (SHOTS) await shot(page, { path: `${SHOTS}/ueberblick-vorher-${width}.png`, fullPage: true });

    await page.getByTestId("ops-event-ack-m1").click();
    await expect(problems.getByTestId("ops-event-email")).toHaveCount(0);
    await expect(page.getByTestId("ops-overview-source-email")).not.toContainText("auffällig");
    expect(world.calls).toContainEqual({ path: "/api/admin/ops/events/ack", body: { source: "email", id: "m1" } });
    if (SHOTS) await shot(page, { path: `${SHOTS}/ueberblick-nachher-${width}.png`, fullPage: true });

    await page.getByTestId("ops-overview-ack-all").click();
    await expect(page.getByTestId("confirm-dialog")).toContainText("2 Einträge quittieren?");
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(page.getByTestId("ops-overview-done")).toContainText("Alles erledigt");
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    if (SHOTS) await shot(page, { path: `${SHOTS}/ueberblick-leer-${width}.png`, fullPage: true });

    // Im Verlauf bleibt es mit „Quittierte zeigen“, mit wer und wann.
    await page.getByTestId("ops-overview-source-email").click();
    await expect(page).toHaveURL(/tab=events&source=email/);
    await page.getByTestId("ops-events-show-acked").click();
    await expect(page.getByTestId("ops-event-state-m1")).toContainText("Quittiert von Obmann");
  });

  test(`Fehlergruppen: als gelöst markieren direkt in der Zeile (${name})`, async ({ page, isMobile }) => {
    test.skip(isMobile, "Breiten stellt der Test selbst ein.");
    await page.setViewportSize({ width, height });
    const world = opsWorld();
    await mockOps(page, world);
    await page.goto("/admin/ops?tab=errors");

    const row = page.getByTestId("ops-error-abc123");
    await expect(row).toContainText("KeyError");
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    expect(await smallTargets(page, "[data-testid=ops-errors] button, [data-testid=ops-errors] label")).toEqual([]);
    await page.getByTestId("ops-error-pick-def456").check();
    await expect(page.getByTestId("ops-errors-bulk")).toContainText("1 ausgewählt");
    if (SHOTS) await shot(page, { path: `${SHOTS}/fehlergruppen-zeile-${width}.png`, fullPage: true });
    await page.getByTestId("ops-error-resolve-abc123").click();
    await expect(page.getByTestId("ops-error-reopen-abc123")).toBeVisible();
    expect(world.calls).toContainEqual({ path: "/api/admin/ops/errors/abc123/resolve" });
  });
}
