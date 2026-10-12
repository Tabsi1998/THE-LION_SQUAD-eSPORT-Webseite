const { test, expect } = require("@playwright/test");

// Braucht Aufmerksamkeit (#1160) bei 390 px: Station defekt → Eintrag mit „Umlegen“ → freie Station wählen → der Fall
// ist weg. Ein fehlendes Ergebnis hat gleich „Eintragen“. Die API ist nachgestellt, die Namen sind erfunden.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const MATCH = {
  id: "m7", label: "Durchgang 3", stage_name: "Vorläufe", status: "scheduled", kind: "heat", best_of: 1, ranking_mode: "higher_score", allows_draw: false,
  participants: ["KartKönigin", "NeonFalke", "LunaRacer", "Blitzbirne"].map((name, index) => ({ registration_id: `h${index}`, name })),
  advance: {}, has_result: false, result: [], station_id: "sw2", station_text: "Switch 2", timing: {}, can_enter: true,
};
const LATE = { ...MATCH, id: "m8", label: "Halbfinale B", kind: "duel", station_id: "pc4", station_text: "PC 4", timing: { missing: true, overdue_minutes: 12 },
  participants: [{ registration_id: "r3", name: "TurboTina" }, { registration_id: "r4", name: "Frostbiss" }] };

test.describe("Braucht Aufmerksamkeit", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  test("Station defekt → umlegen → weg", async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date("2026-10-10T13:12:00+00:00"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
    });
    let moved = null;
    await page.route("**/api/**", (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/me") return route.fulfill(json({ id: "s1", username: "leitung", display_name: "Turnierleitung", role: "tournament_admin", is_tournament_staff: true }));
      if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
      if (path === "/api/matches/m7" && request.method() === "PATCH") {
        moved = request.postDataJSON();
        return route.fulfill(json({ id: "m7", station_id: "sw3" }));
      }
      if (path === "/api/tournaments/mk-cup/lead") {
        const attention = [
          ...(moved ? [] : [{ id: "st-sw2", kind: "station_broken", title: "Station defekt", action: "move", station_id: "sw2", station_text: "Switch 2",
            label: "Durchgang 3", names: "4 Teilnehmer", detail: "1 Spiel wartet darauf", match_ids: ["m7"] }]),
          { id: "rm-m8", kind: "result_missing", title: "Ergebnis fehlt", action: "enter", match_id: "m8", station_text: "PC 4", label: "Halbfinale B",
            names: "TurboTina gegen Frostbiss", detail: "12 Min. über der Zeit" },
        ];
        return route.fulfill(json({
          tournament: { id: "t1", slug: "mk-cup", title: "Herbst-LAN Cup" }, matches: [LATE, moved ? { ...MATCH, station_id: "sw3", station_text: "Switch 3" } : MATCH],
          attention, recent: [], counts: { open: 2, running: 0, missing: 1, attention: attention.length },
          stations: [{ id: "sw2", name: "Switch 2", status: "broken", busy: false }, { id: "sw3", name: "Switch 3", status: "free", busy: false }, { id: "pc4", name: "PC 4", status: "busy", busy: true }],
        }));
      }
      return route.fulfill(json([]));
    });
    await page.goto("/tournaments/mk-cup/leitung?fall=st-sw2");

    await expect(page.getByTestId("lead-tab-attention")).toHaveText("Braucht Aufmerksamkeit (2)");
    const broken = page.getByTestId("lead-case-st-sw2");
    await expect(broken).toContainText("Station defekt");
    await expect(broken).toContainText("1 Spiel wartet darauf");
    await expect(page.getByTestId("lead-case-enter-rm-m8")).toBeVisible();
    await testInfo.attach("braucht-aufmerksamkeit-390.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.getByTestId("lead-case-move-st-sw2").click();
    await expect(page.getByTestId("lead-case-stations-st-sw2")).toContainText("Switch 3");
    await expect(page.getByTestId("lead-move-to-pc4")).toHaveCount(0);
    await page.getByTestId("lead-move-to-sw3").click();
    await expect(page.getByTestId("lead-case-st-sw2")).toHaveCount(0);
    expect(moved).toEqual({ station_id: "sw3" });
    await expect(page.getByTestId("lead-tab-attention")).toHaveText("Braucht Aufmerksamkeit (1)");
  });
});
