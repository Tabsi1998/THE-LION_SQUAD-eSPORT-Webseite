const { test, expect } = require("@playwright/test");
const MERGED = require("./fixtures/mergedHeatsGenerated.json");

// Läufe-Cup mit zusammengelegten Läufen (#2452) im echten Browser, Server nachgestellt mit dem Baum aus dem echten
// Generator und Umbau (scripts/make_ffa_bracket_fixture.py --merged): 14 Läufe, fünf davon zusammengelegt, Ergebnisse
// veröffentlicht. Der Turnier-Ablauf der Verwaltung zählt nur die gefahrenen Läufe („9/9“), der öffentliche Baum nennt
// die zusammengelegten Läufe und zeigt in gefahrenen Läufen kein „Plätze frei“. Bei 390 und 1440 px ohne seitliches
// Scrollen. Mit SHOT_DIR entstehen Screenshots. Nur erfundene Namen.

const SHOTS = process.env.SHOT_DIR || "";
const DONE = MERGED.lb8_merged_done;
const TID = DONE.tournament.id;
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments"], mfa_enabled: true, auth_mfa_verified: true };
const RIGHTS = { can_manage_structure: true, can_manage_results: true, can_manage_all_results: true, can_plan_matches: true, staff_scopes: [],
  can_check_in: true, can_manage_participants: true, can_assign_stations: false, can_use_staff_tools: true };
const key = (match) => match.match_key;
const byKey = (name) => DONE.matches_v2.find((match) => key(match) === name);

async function consent(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false,
      tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
}

async function mockServer(page, { admin = false } = {}) {
  await consent(page);
  const json = (body, status = 200) => (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", json([]));
  await page.route("**/api/settings/public", json({ club_name: "THE LION SQUAD" }));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", admin ? json(ADMIN) : json({}, 401));
  await page.route(`**/api/tournaments/${TID}/registrations`, json(DONE.registrations));
  await page.route(`**/api/tournaments/${TID}/matches-v2`, json(DONE.matches_v2));
  await page.route(`**/api/tournaments/${TID}/stages`, json(DONE.stages));
  await page.route(`**/api/tournaments/${TID}/bracket**`, json(DONE));
  const tournament = { ...DONE.tournament, ...(admin ? RIGHTS : {}) };
  await page.route(new RegExp(`/api/tournaments/(${TID}|${DONE.tournament.slug})(\\?.*)?$`), json(tournament));
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.describe("Läufe-Cup mit zusammengelegten Läufen", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Turnier-Ablauf zählt nur die gefahrenen Läufe (${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, { admin: true });
      await page.goto(`/admin/tournaments/${TID}`);
      const stepper = page.getByTestId("tournament-flow-stepper");
      await expect(page.getByTestId("flow-step-bracket")).toContainText("9 Spiele");
      await expect(page.getByTestId("flow-step-results")).toContainText("9/9");
      await expect(stepper).not.toContainText("9/14");
      await expect(page.getByTestId("flow-step-standings")).toHaveAttribute("aria-current", "step");
      await noSideScroll(page);
      await stepper.scrollIntoViewIfNeeded();
      await shot(page, `ablauf-${width}`);
    });

    test(`Baum: zusammengelegte Läufe, kein „Plätze frei“ nach dem Ende (${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await page.goto(`/tournaments/${DONE.tournament.slug}/bracket`);
      await expect(page.getByTestId(`bracket-heat-${byKey("FINAL").id}`).first()).toBeVisible();
      // Schmal zeigt der Baum die Runden als Schritte - dort stehen die erste Winner- und Loser-Runde offen.
      const merged = width < 768 ? [["B", "A"], ["D", "C"], ["LB", "LA"]] : [["B", "A"], ["D", "C"], ["F", "E"], ["LB", "LA"], ["LD", "LC"]];
      for (const [from, into] of merged) {
        await expect(page.getByTestId(`bracket-fate-${byKey(from).id}`).first()).toContainText(`zusammengelegt in ${into}`);
      }
      await expect(page.getByText("Plätze frei")).toHaveCount(0);
      // Das Grand Final mit 2 von 4 Plätzen: „2 Spieler“, keine Zeile „2 Plätze frei“ mehr.
      await expect(page.getByTestId(`bracket-heat-meta-${byKey("FINAL").id}`).first()).toContainText("2 Spieler");
      await expect(page.getByTestId(`bracket-heat-free-${byKey("FINAL").id}`)).toHaveCount(0);
      await noSideScroll(page);
      await shot(page, `baum-${width}`);
    });
  }
});
