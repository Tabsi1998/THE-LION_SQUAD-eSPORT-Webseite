const { test, expect } = require("@playwright/test");

// Matchseite im Klartext (#1220): ein beendetes Freilos-Match zeigt bei 390 und 1440 px die Überschrift mit Namen,
// „Beendet“ mit dem Satz zum Freilos und die Station einmal im Klartext - am PC rechts im Kopf, am Handy in einer
// Zeile. Die API ist nachgestellt, die Namen sind erfunden; die Uhr steht fest.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const PAGE = {
  match: {
    id: "m1", match_key: "A", status: "completed", winner_id: "r1", round: 1, round_name: "Achtelfinale", scheduled_at: "2026-05-23T16:00:00+00:00",
    slots: [{ slot: 1, status: "filled", registration_id: "r1" }, { slot: 2, status: "bye", registration_id: null }],
    results: [{ registration_id: "r1", rank: 1 }], result_meta: { source: "auto_bye" },
    station_id: "s1", station_label: "Station A - switch2", station_text: "Station A · Switch 2",
  },
  tournament: { id: "t1", slug: "mk-summer-cup", title: "Mario Kart Summer Cup" },
  participants: [
    { slot: 1, status: "filled", registration_id: "r1", display_name: "NeonFalke" },
    { slot: 2, status: "bye", registration_id: null, display_name: null },
  ],
  schedule_proposals: [], can_act: false, can_report_score: false, can_player_report_result: false, can_submit_result: false,
  can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false, can_forfeit: false,
  event_mode: "local", result_entry_mode: "staff_only", schedule_mode: "fixed_by_staff", collection: "matches_v2", matchday: 1, matchday_label: "Achtelfinale",
};

test.describe("Matchseite: beendetes Freilos-Match", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breiten werden hier selbst gesetzt");

  for (const width of [390, 1440]) {
    test(`bei ${width} px: Namen, „Beendet“ mit Satz, Station einmal`, async ({ page }, testInfo) => {
      await page.clock.setFixedTime(new Date("2026-05-20T10:00:00+00:00"));
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => {
        window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
      });
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/matches/m1/page") return route.fulfill(json(PAGE));
        if (path === "/api/matches/m1/chat") return route.fulfill(json([]));
        if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
        if (path === "/api/auth/me") return route.fulfill(json({ detail: "anonym" }, 401));
        return route.abort();
      });
      await page.goto("/matches/m1");

      const headline = page.getByTestId("match-headline");
      await expect(headline).toHaveText("NeonFalke gegen Freilos");
      const box = page.getByTestId("match-finished");
      await expect(box).toContainText("Beendet");
      await expect(box).toContainText("Sa 23. Mai · 18:00");
      await expect(page.getByTestId("match-outcome")).toHaveText("Freilos – NeonFalke kommt kampflos weiter.");
      const station = page.getByTestId("match-station");
      await expect(station).toHaveText("Station A · Switch 2");
      await expect(page.getByText("Terminstatus")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("Station Station");

      // Station in einer Zeile.
      const lines = await station.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
      expect(lines).toBe(1);
      // Am PC steht der Kasten rechts neben der Überschrift, am Handy darunter.
      const head = await headline.boundingBox();
      const side = await box.boundingBox();
      if (width >= 1024) expect(side.x).toBeGreaterThan(head.x + head.width - 1);
      else expect(side.y).toBeGreaterThan(head.y + head.height - 1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await testInfo.attach(`matchseite-freilos-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
    });
  }
});
