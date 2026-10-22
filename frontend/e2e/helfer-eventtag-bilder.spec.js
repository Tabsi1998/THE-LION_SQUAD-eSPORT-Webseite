const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Helfer-Spickzettel für den Event-Tag (#1686): die drei Problemfälle, wie sie die Turnierleitung sieht - „Nicht
// erschienen?“, ein gemeldeter Streitfall und die Leiste „Offline“, wenn das Internet weg ist. Je Handy (390 px) und
// PC (1280 px). Die API ist nachgestellt, die Namen sind erfunden. Mit E2E_SCREENS_DIR legt der Test die Bilder für
// das Handbuch ab (docs/assets/helfer-eventtag/).

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const consent = () => {
  window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
};

const TOURNAMENT = { id: "t1", slug: "herbst-cup", title: "Herbst-LAN Cup" };
const HEAT = {
  id: "m4", label: "Runde 1 · Durchgang C", stage_name: "Winner Bracket", status: "scheduled", kind: "heat", best_of: 1, ranking_mode: "higher_score",
  allows_draw: false, participants: ["KartKönigin", "NeonFalke", "LunaRacer", "Blitzbirne"].map((name, index) => ({ registration_id: `h${index}`, name })),
  advance: {}, has_result: false, result: [], station_id: "st3", station_text: "Station 3", timing: { missing: false }, can_enter: true,
};
const DISPUTED = {
  id: "m2", label: "Runde 1 · Durchgang A", stage_name: "Winner Bracket", status: "disputed", kind: "heat", best_of: 1, ranking_mode: "higher_score",
  allows_draw: false, participants: ["TurboTina", "Frostbiss", "PistenPia", "Zickzack"].map((name, index) => ({ registration_id: `d${index}`, name })),
  advance: {}, has_result: true, result: [], result_summary: "Weiter: Frostbiss und TurboTina.", station_text: "Station 1", timing: {}, can_enter: true,
  dispute: { by: "PistenPia", at: "2026-10-31T17:22:00+00:00", category: "wrong_result", category_label: "Falsches Ergebnis",
    text: "Ich war Zweite, nicht Dritte – Zielfoto am Bildschirm.", photo: null, result_by: "Helfer Station 1", result_at: "2026-10-31T17:18:00+00:00", reports: [] },
};

const CASES = {
  noshow: {
    matches: [HEAT],
    attention: [{
      id: "ns-m4", kind: "no_show", title: "Nicht erschienen?", action: "no_show", match_id: "m4", station_text: "Station 3",
      label: "Winner Bracket · Runde 1 · Durchgang C", names: "4 Teilnehmer", detail: "10 Min. ab Aufruf um.",
      participants: HEAT.participants,
    }],
  },
  dispute: {
    matches: [DISPUTED],
    attention: [{ id: "ds-m2", kind: "dispute", match_id: "m2", title: "Streitfall gemeldet", detail: "PistenPia: „Falsches Ergebnis“", action: "view",
      station_text: "Station 1", label: "Runde 1 · Durchgang A", names: "4 Teilnehmer" }],
  },
};

async function setup(page, viewport, kind) {
  await page.clock.setFixedTime(new Date("2026-10-31T17:25:00+00:00"));
  await page.setViewportSize(viewport);
  await page.addInitScript(consent);
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/me") return route.fulfill(json({ id: "s1", username: "helfer", display_name: "Helfer Station 1", role: "member", is_tournament_staff: true }));
    if (url.pathname === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (url.pathname === "/api/tournaments/herbst-cup/lead") {
      const view = CASES[kind] || { matches: [HEAT], attention: [] };
      return route.fulfill(json({
        tournament: TOURNAMENT, matches: view.matches, attention: view.attention, recent: [], draws: [],
        counts: { open: view.matches.length, running: 0, missing: 0, attention: view.attention.length },
        stations: [{ id: "st1", name: "Station 1", status: "busy", busy: true }, { id: "st3", name: "Station 3", status: "free", busy: false }],
      }));
    }
    if (url.pathname === "/api/tournaments/herbst-cup/live-queue") return route.fulfill(json({ applies: false }));
    return route.fulfill(json([]));
  });
}

async function shoot(page, testInfo, name) {
  const body = await page.screenshot({ fullPage: false });
  await testInfo.attach(name, { body, contentType: "image/png" });
  if (process.env.E2E_SCREENS_DIR) await page.screenshot({ path: path.join(process.env.E2E_SCREENS_DIR, name), fullPage: false });
}

const SIZES = [
  ["handy", { width: 390, height: 760 }],
  ["pc", { width: 1280, height: 720 }],
];

test.describe("Helfer am Event-Tag: Bilder der Problemfälle", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [device, viewport] of SIZES) {
    test(`Nicht erschienen? (${device})`, async ({ page }, testInfo) => {
      await setup(page, viewport, "noshow");
      await page.goto("/tournaments/herbst-cup/leitung?fall=ns-m4");
      await expect(page.getByTestId("lead-no-show-ns-m4")).toContainText("NeonFalke nicht erschienen");
      await expect(page.getByTestId("lead-no-show-extend-ns-m4")).toBeVisible();
      await page.getByTestId("lead-case-ns-m4").scrollIntoViewIfNeeded();
      await shoot(page, testInfo, `p1-nicht-erschienen-${device}.png`);
    });

    test(`Streitfall (${device})`, async ({ page }, testInfo) => {
      await setup(page, viewport, "dispute");
      await page.goto("/tournaments/herbst-cup/leitung?fall=ds-m2");
      const card = page.getByTestId("lead-dispute-m2");
      await expect(card).toContainText("Falsches Ergebnis");
      await card.scrollIntoViewIfNeeded();
      await shoot(page, testInfo, `p2-strittig-${device}.png`);
    });

    test(`Internet weg (${device})`, async ({ page, context }, testInfo) => {
      await setup(page, viewport, "none");
      await page.goto("/tournaments/herbst-cup/leitung");
      await expect(page.getByTestId("lead-page")).toContainText("Herbst-LAN Cup");
      await context.setOffline(true);
      await expect(page.getByTestId("offline-bar")).toBeVisible();
      await expect(page.getByTestId("offline-bar")).toContainText("Offline");
      await shoot(page, testInfo, `p3-offline-${device}.png`);
      await context.setOffline(false);
    });
  }
});
