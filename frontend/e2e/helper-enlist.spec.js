const { test, expect } = require("@playwright/test");

// Helfer eintragen (#1384): Die Turnierleitung trägt im Reiter „Helfer“ eine Person ein - unter der Rolle steht, was sie
// darf. Danach liegt beim Helfer die Nachricht mit Rolle, Satz und Link zu „Mein Dienst“ in der Glocke. Bei 390, 768 und
// 1440 px, ohne seitliches Scrollen. Server nachgestellt, Namen erfunden.

const WIDTHS = [["handy", 390, 844], ["tablet", 768, 1024], ["pc", 1440, 900]];
const LEAD = { id: "u-lead", username: "tom.turnier", display_name: "Tom Turnier", role: "tournament_admin", areas: ["tournaments"],
  is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true };
const HELPER = { id: "u-7", username: "erika", display_name: "Erika Beispiel", role: "player", has_staff_assignment: true, is_tournament_staff: true };
const HITS = [{ id: "u-7", name: "Erika Beispiel", avatar_url: null, context: "Mitglied", is_club_member: false }];
const TOURNAMENT = { id: "t-1", slug: "mario-kart-cup", title: "Mario Kart Cup", status: "registration_open", format: "single_elim", team_mode: "solo",
  max_participants: 16, can_manage_structure: true, can_manage_results: true, can_manage_all_results: true, can_plan_matches: true, staff_scopes: [],
  can_check_in: true, can_manage_participants: true, can_assign_stations: true, can_use_staff_tools: true };
const SENTENCE = "Darf hier: Teilnehmer, Ergebnisse und Check-in.";

async function mockServer(page, state) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false,
      tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.startsWith("/changes")) return route.abort();
    if (path === "/auth/me") return json(state.user);
    if (path === "/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (path === "/friends") return json({ incoming: [], friends: [], outgoing: [] });
    if (path === "/admin/people/search") return json(url.searchParams.get("q") ? HITS : []);
    if (path === "/tournaments/t-1/staff" && request.method() === "POST") {
      const body = request.postDataJSON();
      state.posted.push(body);
      // Was der Server beim Eintragen tut (tournament_staff_routes): genau eine Nachricht an die Person.
      state.notes.push({ id: "n-1", kind: "tournament_staff", title: `Einsatz: ${TOURNAMENT.title}`, read: false, url: "/admin/dienst",
        body: `Du hilfst bei ${TOURNAMENT.title} als Ergebnisdienst. ${SENTENCE} Unter „Mein Dienst“ siehst du, was du tun kannst.`,
        meta: { category: "tournament_updates" }, created_at: new Date().toISOString() });
      return json({ id: "s-1", ...body, is_active: true, user: { display_name: "Erika Beispiel", username: "erika" }, idempotent_replay: false });
    }
    if (path.startsWith("/tournaments/t-1/staff")) return json(state.posted.map((row, index) => ({ id: `s-${index + 1}`, ...row, is_active: true,
      user: { display_name: "Erika Beispiel", username: "erika" } })));
    if (path === "/tournaments/t-1" || path === "/tournaments/mario-kart-cup") return json(TOURNAMENT);
    if (path.startsWith("/tournaments/t-1/bracket")) return json({ rounds: [] });
    if (path === "/admin/notifications") return json(state.user.id === HELPER.id ? state.notes : []);
    if (request.method() !== "GET") return json({ ok: true });
    const list = /notifications|sponsors|partners|registrations|stages|matches|groups|stations|users|teams|games$|events|access-links|challenges|site-banners/.test(path);
    return json(list ? [] : {});
  });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const [label, width, height] of WIDTHS) {
  test(`Helfer eintragen (${label}): Satz zur Rolle, danach die Nachricht in der Glocke`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const state = { user: LEAD, posted: [], notes: [] };
    await mockServer(page, state);

    await page.goto("/admin/tournaments/t-1");
    await page.getByTestId("admin-tr-tab-staff").click();
    await expect(page.getByTestId("admin-tr-tab-staff")).toHaveText(/Helfer/i);
    await expect(page.getByTestId("tournament-staff-role-sentence")).toHaveText(SENTENCE);
    await page.getByTestId("tournament-staff-person-search").fill("Erika");
    await page.getByTestId("tournament-staff-person-option-u-7").click();
    await page.getByRole("button", { name: "Eintragen" }).click();
    await expect.poll(() => state.posted.length).toBe(1);
    expect(state.posted[0]).toMatchObject({ user_id: "u-7", role: "scorekeeper", scope: "tournament" });
    await noSideScroll(page);

    // Jetzt als Helfer: die Glocke trägt die Nachricht mit Rolle, Satz und Weg zu „Mein Dienst“.
    state.user = HELPER;
    await page.goto("/");
    await page.getByTestId("notification-bell").click();
    const panel = page.getByTestId("notification-panel");
    await expect(panel).toContainText("Einsatz: Mario Kart Cup");
    // Die Glocke zeigt den Anfang; der ganze Satz steht in der Nachricht selbst.
    await expect(panel).toContainText("als Ergebnisdienst. Darf hier: Teilnehmer");
    await noSideScroll(page);
  });
}
