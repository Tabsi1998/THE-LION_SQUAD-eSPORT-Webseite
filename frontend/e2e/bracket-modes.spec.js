const { test, expect } = require("@playwright/test");
const FFA = require("./fixtures/ffaGenerated.json");

// Weiterkommen in vier Modi (#1590): der Web-Turnierbaum bei „sofort zufällig“ (vorher, mittendrin, danach - die
// Plätze füllen sich einzeln, die Sammelschiene bleibt) und die Karte „Auslosung bereit“ in der Turnierleitung. Die API
// ist nachgestellt mit Bäumen aus dem echten Generator; die Namen sind erfunden. Mit SHOT_DIR entstehen Screenshots.

const SHOTS = process.env.SHOT_DIR || "";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

async function shot(page, name) {
  if (!SHOTS) return;
  // Die Linien zeichnen sich beim ersten Erscheinen - für das Bild kurz warten.
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function mockBracket(page, holder) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill(json({}, 401));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD" }));
    if (path === "/api/tournaments/smash-cup-8-sofort") return route.fulfill(json(holder.state.tournament));
    if (path.startsWith(`/api/tournaments/${holder.state.tournament.id}/bracket`)) return route.fulfill(json(holder.state));
    return route.fulfill(json([]));
  });
}

test.describe("Sofort zufällig im Web-Turnierbaum", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  test("vorher, mittendrin, danach: die Plätze füllen sich einzeln, die Schiene bleibt", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
    });
    const holder = { state: FFA.se8_instant_0 };
    await mockBracket(page, holder);
    await page.goto("/tournaments/smash-cup-8-sofort/bracket");
    // Nur die Plätze der gelosten Runde zählen (das Finale wartet regulär auf „Sieger aus E“).
    const pending = page.getByText("Platz aus Runde 1");
    await expect(pending).toHaveCount(4);
    await expect(page.locator("path[data-rail-spine]")).toHaveCount(1);
    await shot(page, "web-baum-sofort-1-vorher");

    for (const [state, left, name] of [["se8_instant_1", 3, "web-baum-sofort-2-ein-platz"], ["se8_instant_2", 2, "web-baum-sofort-3-mittendrin"], ["se8_instant_4", 0, "web-baum-sofort-4-danach"]]) {
      holder.state = FFA[state];
      await page.reload();
      await expect(pending).toHaveCount(left);
      // Je gezogenem Platz eine echte Linie über die Schiene; die Schiene steht, solange ein Platz offen ist.
      await expect(page.locator("path[data-real='1']")).toHaveCount(4 - left);
      await expect(page.locator("path[data-rail-spine]")).toHaveCount(1);
      await shot(page, name);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("Show-Auslosung in der Turnierleitung", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  test("Auslosung bereit · 4 Namen, Topf, Restzeit und „Jetzt auslosen“", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-31T14:03:00+00:00") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
    });
    const posts = [];
    let drawn = false;
    const card = {
      id: "draw-WB:2", stage_id: "s1", stage_name: "Turnierbaum", group: "WB:2", label: "Runde 1", match_ids: ["m5", "m6"], match_keys: ["E", "F"],
      pot: ["NeonFalke", "KartKönigin", "LuckyLion", "PixelPaula"], pot_size: 4, since: "2026-10-31T14:00:00+00:00",
      remind_minutes: 10, remind_at: "2026-10-31T14:10:00+00:00", due_at: "2026-10-31T14:20:00+00:00", can_draw: true,
    };
    await page.route("**/api/**", (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/me") return route.fulfill(json({ id: "s1", username: "leitung", display_name: "Turnierleitung", role: "tournament_admin", is_tournament_staff: true }));
      if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD" }));
      if (path === "/api/tournaments/smash-cup/lead") {
        return route.fulfill(json({
          tournament: { id: "t1", slug: "smash-cup", title: "Lions Smash-Cup", status: "live" }, now: "2026-10-31T14:03:00+00:00",
          matches: [], recent: [], counts: { open: 0 }, attention: [], stations: [], draws: drawn ? [] : [card],
        }));
      }
      if (request.method() === "POST") {
        posts.push({ path, body: request.postDataJSON() });
        drawn = true;
        return route.fulfill(json({ ok: true }));
      }
      return route.fulfill(json([]));
    });
    await page.goto("/tournaments/smash-cup/leitung");
    const shown = page.getByTestId("lead-draw-WB:2");
    await expect(shown).toContainText("Auslosung bereit · 4 Namen");
    await expect(page.getByTestId("lead-draw-countdown-WB:2")).toHaveText("automatisch in 17 Min.");
    await expect(page.getByTestId("lead-draw-pot-WB:2").locator("li")).toHaveCount(4);
    await shot(page, "leitung-auslosung-bereit-390");
    await page.getByTestId("lead-draw-now-WB:2").click();
    expect(posts[0]).toEqual({ path: "/api/tournaments/smash-cup/stages/s1/draw", body: { group: "WB:2" } });
    // Gelost: die Karte verschwindet mit dem Neuladen von selbst.
    await expect(page.getByTestId("lead-draw-WB:2")).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
