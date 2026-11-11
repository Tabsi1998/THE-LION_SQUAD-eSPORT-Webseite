const { test, expect } = require("@playwright/test");
const path = require("node:path");

// Automatische Hinweisbanner (#2352): Einstellungen → Branding zeigt die laufenden automatischen Banner mit Zahlen, die
// Turnier-Bearbeitung die Zahlen unter dem Schalter - am Telefon und am PC, ohne dass die Seite quer läuft.

const SHOTS = process.env.SHOT_DIR || "";
const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });

const AUTO = [
  {
    id: "auto-tournament-registration-t-1", kind: "tournament", template: "registration", title: "Winter Cup 2026",
    text: "Anmeldung offen: Winter Cup 2026", period_start: "2026-11-10T17:00:00+00:00", period_end: "2026-11-20T17:00:00+00:00",
    manage_url: "/admin/tournaments/t-1?tab=edit", stats: { impressions: 128, clicks: 17, last_impression_at: "2026-11-11T09:00:00+00:00", last_click_at: "" },
  },
  {
    id: "auto-server-maintenance-srv", kind: "server", template: "maintenance", title: "Minecraft",
    text: "Minecraft ist in Wartung: Update auf die neue Version", period_start: "", period_end: "",
    manage_url: "/admin/game-servers", stats: { impressions: 3, clicks: 0, last_impression_at: "", last_click_at: "" },
  },
];

const TOURNAMENT = {
  id: "t-1", slug: "winter-cup", title: "Winter Cup 2026", status: "registration_open", format: "single_elim", team_mode: "solo",
  max_participants: 16, site_banner_enabled: true, can_manage_structure: true, can_manage_results: true, can_manage_all_results: true,
  can_plan_matches: true, staff_scopes: [], can_check_in: true, can_manage_participants: true, can_assign_stations: true, can_use_staff_tools: true,
};

async function mockSession(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  await page.route("**/api/auth/me", json({
    id: "admin-1", email: "admin@example.test", display_name: "Admin", username: "admin",
    role: "superadmin", is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true,
  }));
  await page.route("**/api/settings/public", json({ club_name: "THE LION SQUAD" }));
}

async function noOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const [label, width, height] of [["Handy", 390, 844], ["PC", 1440, 900]]) {
  test(`${label}: Einstellungen zeigen die automatischen Banner mit Zahlen und Link`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockSession(page);
    await page.route("**/api/settings/**", json({}));
    await page.route("**/api/settings/site-banners/admin", json([]));
    await page.route("**/api/settings/site-banners/admin/auto", json({ items: AUTO }));
    await page.goto("/admin/settings/branding");
    const list = page.getByTestId("auto-banner-list");
    await expect(list).toContainText("Automatische Banner");
    const row = page.getByTestId("auto-banner-auto-tournament-registration-t-1");
    await expect(row).toContainText("Turnier · Anmeldung / Check-in");
    await expect(row).toContainText("Views 128 · Klicks 17");
    await expect(row.getByRole("link", { name: "Zum Turnier" })).toHaveAttribute("href", "/admin/tournaments/t-1?tab=edit");
    await expect(page.getByTestId("auto-banner-auto-server-maintenance-srv")).toContainText("bis die Wartung endet");
    await noOverflow(page);
    await list.scrollIntoViewIfNeeded();
    // Am Telefon passt der Kasten in die Breite (vorher zog die Lauftext-Vorschau die Spalte auf über 1300 px).
    const box = await list.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    if (SHOTS) await list.screenshot({ path: path.join(SHOTS, `auto-banner-einstellungen-${width}.png`) });
  });

  test(`${label}: Turnier-Bearbeitung zeigt die Zahlen unter dem Schalter`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockSession(page);
    await page.route("**/api/**", json([]));
    await page.route("**/api/auth/me", json({
      id: "admin-1", email: "admin@example.test", display_name: "Admin", username: "admin",
      role: "superadmin", is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true,
    }));
    await page.route("**/api/settings/public", json({ club_name: "THE LION SQUAD" }));
    await page.route("**/api/tournaments/t-1/bracket**", json({ rounds: [] }));
    await page.route("**/api/tournaments/t-1?**", json(TOURNAMENT));
    await page.route("**/api/tournaments/t-1", json(TOURNAMENT));
    await page.route("**/api/settings/site-banners/admin/stats/tournament/t-1", json({
      items: [
        { id: "auto-tournament-registration-t-1", template: "registration", stats: { impressions: 128, clicks: 17, last_impression_at: "2026-11-11T09:00:00+00:00", last_click_at: "" } },
        { id: "auto-tournament-event-t-1", template: "event", stats: { impressions: 40, clicks: 6, last_impression_at: "2026-11-01T09:00:00+00:00", last_click_at: "" } },
      ],
      total: { impressions: 168, clicks: 23, last_impression_at: "2026-11-11T09:00:00+00:00" },
    }));
    await page.goto("/admin/tournaments/t-1?tab=edit");
    const stats = page.getByTestId("auto-banner-stats-tournament");
    await expect(stats).toContainText("Views 168 · Klicks 23 · zuletzt angezeigt");
    await expect(stats).toContainText("Anmeldung / Check-in: Views 128 · Klicks 17");
    await expect(stats).toContainText("Startet bald: Views 40 · Klicks 6");
    await noOverflow(page);
    await stats.scrollIntoViewIfNeeded();
    if (SHOTS) {
      const box = await stats.boundingBox();
      const top = Math.max(0, box.y - 160);
      await page.screenshot({ path: path.join(SHOTS, `auto-banner-turnier-${width}.png`), clip: { x: 0, y: top, width, height: Math.min(height - top, box.height + 260) } });
    }
  });
}
