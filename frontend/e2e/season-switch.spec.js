const { test, expect } = require("@playwright/test");

// Adventkalender (#1360): die Redaktion schaltet ihn oben auf der eigenen Seite ein - ohne Umweg über Auftritt →
// Jahreszeiten. Bei 390, 768 und 1440 px; der Server ist eine Attrappe.

const WIDTHS = [["handy", 390, 844], ["tablet", 768, 1024], ["pc", 1440, 900]];
const EDITOR = { id: "u-red", username: "rita", display_name: "Rita Redaktion", role: "player", areas: ["content"], mfa_enabled: true, auth_mfa_verified: true };

function adventView() {
  const doors = [];
  for (let day = 1; day <= 24; day += 1) {
    const door = day <= 3 ? { id: `d${day}`, year: 2026, day, kind: "text", title: `Türchen ${day}`, body: "Hallo" } : null;
    doors.push({ day, opens_at: `2026-12-${String(day).padStart(2, "0")}T06:00:00+01:00`, is_open: false, seed: day * 97 + 3, door,
      problem: door ? null : "Noch nichts eingetragen – an diesem Tag grüßt nur der Löwe.", stats: { opened: 0, same_day: 0, later: 0, views: 0, quiz_done: 0 }, raffle: null });
  }
  return { year: 2026, kinds: [{ key: "text", label: "Text" }], door_hour: 6, order: Array.from({ length: 24 }, (_, index) => index + 1), doors, filled: 3, total: 24,
    years: [2026], people: 0, running: false };
}

async function mockApi(page, state) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const switchView = () => ({ key: "advent_calendar", label: "Adventkalender", enabled: state.enabled, channels: ["web", "app"], supported_channels: ["web", "app"], mode: "auto",
      until: null, active_now: false, next_start: "2026-12-01T06:00:00+01:00", next_end: "2027-01-06T23:59:59+01:00", seasons_enabled: true });
    if (url.pathname === "/api/seasonal/switch/advent_calendar") {
      if (request.method() === "PUT") {
        state.saved = request.postDataJSON();
        state.enabled = Boolean(state.saved.enabled);
      }
      return json(switchView());
    }
    if (request.method() !== "GET") return json({ ok: true });
    if (url.pathname === "/api/auth/me") return json(EDITOR);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (url.pathname === "/api/seasonal/advent/admin/options") return json({ news: [], events: [], members: [], stickers: [], audiences: [], max_winners: 20 });
    if (/^\/api\/seasonal\/advent\/admin\/\d+$/.test(url.pathname)) return json(adventView());
    const list = /notifications|games$|nav$|site-banners|sponsors|partners|tournaments|challenges|events/.test(url.pathname);
    return json(list ? [] : {});
  });
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
      await page.setViewportSize({ width, height });
    });

    test("Redaktion schaltet den Adventkalender auf seiner Seite ein", async ({ page }) => {
      const state = { enabled: false, saved: null };
      await mockApi(page, state);
      await page.goto("/admin/advent");
      await expect(page.getByTestId("season-switch-title")).toHaveText("Adventkalender ist aus");
      await expect(page.getByTestId("season-switch-window")).toContainText("Eingeschaltet zu sehen von 1. Dezember 2026");
      await page.getByTestId("season-switch-enabled").check();
      await expect.poll(() => state.saved).toEqual({ enabled: true });
      await expect(page.getByTestId("season-switch-title")).toHaveText("Adventkalender ist an");
      await expect(page.getByTestId("season-switch-window")).toContainText("Sichtbar von 1. Dezember 2026");
      await expect(page.getByRole("link", { name: "Auftritt → Jahreszeiten" })).toHaveCount(0);
      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(2);
    });
  });
}
