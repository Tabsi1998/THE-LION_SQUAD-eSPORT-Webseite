const { test, expect } = require("@playwright/test");

// Turnierleitung am Handy (#1156): bei 390 px eintragen → rückgängig → erneut eintragen. Die Liste zeigt zuerst, wo ein
// Ergebnis fehlt; das Ergebnis-Fenster kommt als Blatt von unten, vor dem Speichern steht der Satz, danach 10 Sekunden
// „Rückgängig“. Die API ist nachgestellt, die Namen sind erfunden, die Uhr läuft nach Vorgabe.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const DUEL = {
  id: "m1", match_key: "HF-A", label: "Halbfinale A", stage_name: "K.-o.", status: "in_progress", kind: "duel", best_of: 1,
  ranking_mode: "higher_score", allows_draw: false,
  participants: [{ registration_id: "r1", name: "NeonFalke", slot: 1 }, { registration_id: "r2", name: "PixelPanther", slot: 2 }],
  advance: { 1: { text: "ins Finale", flow: "W" } }, has_result: false, result: [], hold: null,
  station_id: "st3", station_text: "PC 3", scheduled_at: "2026-10-10T12:50:00+00:00", started_at: "2026-10-10T12:51:00+00:00",
  timing: { running_minutes: 21, overdue_minutes: null, missing: false }, can_enter: true,
};
const LATE = {
  ...DUEL, id: "m2", match_key: "HF-B", label: "Halbfinale B", status: "scheduled", station_id: "st4", station_text: "PC 4",
  participants: [{ registration_id: "r3", name: "TurboTina", slot: 1 }, { registration_id: "r4", name: "Frostbiss", slot: 2 }],
  timing: { running_minutes: null, overdue_minutes: 12, missing: true },
};
const LEAD = {
  tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup", status: "live" },
  matches: [LATE, DUEL], recent: [], counts: { open: 2, running: 1, missing: 1 },
};

test.describe("Turnierleitung am Handy", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  test("eintragen, rückgängig, erneut eintragen", async ({ page }, testInfo) => {
    await page.clock.install({ time: new Date("2026-10-10T13:12:00+00:00") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
    });
    const posts = [];
    let leadLoads = 0;
    await page.route("**/api/**", (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/me") return route.fulfill(json({ id: "s1", username: "leitung", display_name: "Turnierleitung", role: "tournament_admin", is_tournament_staff: true }));
      if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
      if (path === "/api/tournaments/fc-cup/lead") {
        leadLoads += 1;
        return route.fulfill(json(LEAD));
      }
      if (request.method() === "POST") {
        posts.push({ path, body: request.postDataJSON() });
        if (path.endsWith("/undo")) return route.fulfill(json({ ok: true, undone: true, held: true }));
        return route.fulfill(json({ ok: true, held: true, hold: { id: `h${posts.length}`, undo_seconds: 10, mine: true } }));
      }
      return route.fulfill(json([]));
    });
    await page.goto("/tournaments/fc-cup/leitung");

    const rows = page.locator("[data-testid^='lead-row-']");
    await expect(rows.first()).toHaveAttribute("data-testid", "lead-row-m2");
    await expect(page.getByTestId("lead-line-m2")).toHaveText("Ergebnis fehlt · 12 Min. über der Zeit");
    await page.getByTestId("lead-filter-missing").click();
    await expect(rows).toHaveCount(1);
    await page.getByTestId("lead-filter-all").click();

    await page.getByTestId("lead-enter-m1").click();
    const sheet = page.getByTestId("result-window");
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(843);
    await page.getByTestId("result-score-r1-plus").click();
    await page.getByTestId("result-score-r1-plus").click();
    await page.getByTestId("result-score-r2-plus").click();
    await expect(page.getByTestId("result-sentence")).toHaveText("NeonFalke gewinnt 2:1 – weiter ins Finale");
    await testInfo.attach("turnierleitung-fenster-390.png", { body: await page.screenshot(), contentType: "image/png" });
    await page.getByTestId("result-save").click();
    expect(posts[0]).toEqual({ path: "/api/matches/m1/result", body: { results: [{ registration_id: "r1", rank: 1, score: 2 }, { registration_id: "r2", rank: 2, score: 1 }], hold: true, reason: null } });
    await expect(page.getByTestId("result-undo-sentence")).toHaveText("NeonFalke gewinnt 2:1 – weiter ins Finale");
    await expect(page.getByTestId("result-undo")).toContainText("Rückgängig (10)");

    await page.getByTestId("result-undo").click();
    expect(posts[1]).toEqual({ path: "/api/matches/m1/result/undo", body: { hold_id: "h1" } });
    await expect(page.getByTestId("result-undo-bar")).toHaveCount(0);

    // Erneut - diesmal gewinnt die andere Seite; nach 10 Sekunden ist die Leiste weg und die Liste lädt neu.
    await page.getByTestId("lead-enter-m1").click();
    await page.getByTestId("result-score-r2-plus").click();
    await page.getByTestId("result-score-r2-plus").click();
    await expect(page.getByTestId("result-sentence")).toHaveText("PixelPanther gewinnt 2:0 – weiter ins Finale");
    await page.getByTestId("result-save").click();
    await expect(page.getByTestId("result-undo-bar")).toBeVisible();
    const loadsBefore = leadLoads;
    await page.clock.runFor(10_500);
    await expect(page.getByTestId("result-undo-bar")).toHaveCount(0);
    await page.clock.runFor(3_000);
    await expect.poll(() => leadLoads).toBeGreaterThan(loadsBefore);
    expect(posts.filter((post) => post.path.endsWith("/undo"))).toHaveLength(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
