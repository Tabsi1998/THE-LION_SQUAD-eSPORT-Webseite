const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Leitstand der Season (E.4, Nr. 152, 153) im echten Browser, Server nachgestellt: offene Aufgaben je Art mit Zähler, Frist,
// Zuständigkeit und Weg, „Nur meine“, Hinweis bei Befangenheit, Protokoll seitenweise und die Rundnachricht mit Vorschau, Bestätigung
// und genau einem Versand - bei 390 und 1440 px ohne seitliches Scrollen, mit langen Namen. Mit E2E_SCREENS_DIR legt der Test die Bilder
// fürs Handbuch ab (docs/assets/liga/). Nur erfundene Namen.

const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const RULES = { match_points: { win: 3, draw: 0, loss: 0 }, table_tiebreakers: ["score_diff"], head_to_head_criteria: ["points"], allow_draws: false,
  forfeit_score: "best_of", exit_rule: "all_for_opponents" };
const SEASON = {
  id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10, matchday_days: 7,
  default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3, team_size: 4, min_squad_size: 3,
  game_mode_order: [], scoring_rules: RULES, result_confirm_hours: 48, lineup_amend_hours: 48, rules_text: "", visibility: "members", status: "active",
  lineup_mode: "series", blocked_periods: [], updated_at: "2026-11-02T10:00:00Z",
};
const DIVISIONS = [{ id: "d1", level: 1, nickname: "", overrides: {}, label: "Liga 1", status: "active", settings: { best_of: 3, team_size: 4, scoring_rules: RULES },
  calendar: { weeks: [] }, staffeln: [{ tournament_id: "t1", staffel: "A", title: "Probe-Liga Season 1 · Liga 1 · Staffel A" }, { tournament_id: "t2", staffel: "B" }] }];
const SEASON_PAGE = { league: { id: "l1", name: "Probe-Liga", slug: "probe-liga" }, season: SEASON, game: { id: "g1", name: "Probe Shooter", modes: [] },
  calendar: { weeks: [] }, library: [], map_pool: null, default_pool: null, look: { emblem_url: null }, divisions: DIVISIONS };
const inHours = (hours) => new Date(Date.now() + hours * 3600 * 1000).toISOString();
const LONG = "Löwen mit einem sehr, sehr langen Teamnamen · Rudel Alpha gegen Falkenhorst der Nordlichter";
const item = (id, extra = {}) => ({ id, kind: "overdue", title: `Staffel A · Spieltag 2 · ${LONG}`, text: "Nie gemeldet, der Termin ist vorbei. Ergebnis eintragen, kampflos werten oder neuen Termin setzen. Ohne Entscheidung kein Saisonabschluss.",
  url: "/matches/m1", action: "Spiel öffnen", due_at: null, since: inHours(-30), assignee: null, conflict: false, conflict_text: null, mine: true, ...extra });
const DESK = {
  season: { id: "s1", name: "Season 1" }, total: 6, mine: 4, can_broadcast: true,
  groups: [
    { key: "incidents", label: "Vorfälle", responsible: "„Ergebnisse korrigieren“ oder „Proteste“", failed: false, items: [
      item("incidents:m4", { kind: "incidents", text: "", detail: { code: "in_review", position: 2 }, url: "/matches/m4#vorfaelle", action: "Entscheiden", since: inHours(-1) })] },
    { key: "no_show", label: "Check-in abgelaufen", responsible: "„Spiele betreuen“ oder „Ergebnisse korrigieren“", failed: false, items: [] },
    { key: "overdue", label: "Überfällige Spiele", responsible: "„Spiele betreuen“ oder „Ergebnisse korrigieren“", failed: false, items: [
      item("overdue:m1"),
      item("overdue:m2", { title: "Staffel B · Spieltag 3", mine: false, conflict: true, conflict_text: "Du bist an diesem Spiel selbst beteiligt. Das entscheidet eine zweite berechtigte Person." })] },
    { key: "lineups", label: "Fehlende Teilnehmerlisten", responsible: "„Spiele betreuen“ oder „Ergebnisse korrigieren“", failed: false, items: [] },
    { key: "procedures", label: "Verfahren", responsible: "„Proteste“", failed: false, items: [
      item("procedures:p1", { kind: "procedures", title: "Staffel A · Spieltag 1", text: "Protest übernommen, Zielfrist läuft. Die Stellungnahme der Gegenseite steht noch aus.",
        url: "/matches/m3#verfahren-p1", action: "Zum Verfahren", due_at: inHours(20), since: inHours(-5), assignee: { name: "Zweitleitung mit langem Namen", own: false }, mine: false })] },
    { key: "sanctions", label: "Strafen und Einsprüche", responsible: "„Strafen“", failed: false, items: [
      item("sanctions:x:provisional", { kind: "sanctions", title: "Vorläufig · Spielsperre · Rudel Alpha", text: "Die Sperre gilt vorläufig. Bestätigen mit Zeitraum oder widerrufen.",
        url: "/admin/leagues/seasons/s1#strafen", action: "Strafe prüfen" })] },
    { key: "applications", label: "Anmeldungen", responsible: "„Teams freigeben“", failed: false, items: [
      item("applications:a1", { kind: "applications", title: "Nordlichter · Rudel Polarstern", text: "Die Anmeldung wartet auf die Entscheidung: annehmen, auf die Warteliste setzen oder ablehnen.",
        url: "/admin/leagues/seasons/s1#anmeldungen", action: "Entscheiden", due_at: inHours(-2) })] },
    { key: "roster", label: "Kaderanträge", responsible: "„Kader prüfen“", failed: false, items: [] },
    { key: "reschedule", label: "Verschiebungen", responsible: "„Spiele betreuen“", failed: false, items: [] },
    { key: "rules", label: "Regelwerk-Freigabe", responsible: "„Regeln veröffentlichen“", failed: false, items: [] },
  ],
};
const LOG_ROWS = [
  { id: "l1", action: "league.broadcast", label: "Rundnachricht", at: inHours(-1), actor: "Leitung",
    broadcast: { audience: "Captains und Vertreter", scope: "Ganze Season", recipients: 12, mail: true }, staffel: null, match_id: null },
  { id: "l2", action: "match.reschedule.request", label: "Verschiebung · beantragt", at: inHours(-3), actor: "Kapitän mit langem Anzeigenamen", staffel: "Probe-Liga Season 1 · Liga 1 · Staffel A", match_id: "m1" },
  { id: "l3", action: "league.application.accept", label: "Anmeldung · angenommen", at: inHours(-6), actor: "Leitung", staffel: null, match_id: null },
];

async function mockServer(page, { desk = DESK } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const calls = { send: [], preview: [] };
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const where = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (where.startsWith("/changes")) return route.abort();
    if (where === "/auth/me") return json(ADMIN)(route);
    if (where === "/admin/leagues/seasons/s1/broadcast/preview") {
      const body = request.postDataJSON();
      calls.preview.push(body);
      return json({ recipients: body.audience === "players" ? 41 : body.scope === "staffel" ? 6 : 14, scope_label: "Ganze Season", audience_label: "x" })(route);
    }
    if (where === "/admin/leagues/seasons/s1/broadcast") {
      calls.send.push(request.postDataJSON());
      return json({ recipients: 14, delivered: 14, mail: false, replay: calls.send.length > 1, state: "sent" })(route);
    }
    if (where === "/admin/leagues/seasons/s1/desk/log") {
      const pageNo = Number(new URL(request.url()).searchParams.get("page") || 1);
      return json({ items: pageNo === 1 ? LOG_ROWS : LOG_ROWS.slice(0, 1), page: pageNo, pages: 2, total: 28, page_size: 25 })(route);
    }
    const bodies = {
      "/admin/leagues/seasons/s1": SEASON_PAGE,
      "/admin/leagues/seasons/s1/desk": desk,
      "/admin/leagues/seasons/s1/readiness": { ok: true, problems: [], warnings: [], requirements: [] },
      "/admin/league-rules/league_season/s1": { current: { version: 1 }, versions: [], draft: null, data_changes: null },
    };
    if (where in bodies) return json(bodies[where])(route);
    if (["/sponsors", "/notifications/me", "/games"].some((prefix) => where.startsWith(prefix))) return json([])(route);
    if (where === "/friends") return json({ incoming: [], friends: [], outgoing: [] })(route);
    return json({})(route);
  });
  return calls;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(page, file, locator = null) {
  const target = locator || page;
  await target.screenshot({ path: test.info().outputPath(file), animations: "disabled", ...(locator ? {} : { fullPage: true }) });
  if (process.env.E2E_SCREENS_DIR) await target.screenshot({ path: path.join(process.env.E2E_SCREENS_DIR, file), animations: "disabled" });
}

test.describe("Liga: Leitstand der Season", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Aufgaben je Art mit Frist, Zuständigkeit und Weg, „Nur meine“ und Protokoll bei ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await mockServer(page);
      await page.goto("/admin/leagues/seasons/s1#leitstand");
      await expect(page.getByTestId("season-tab-leitstand")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("desk-total")).toHaveText("6");
      await expect(page.getByTestId("desk-group-count-overdue")).toHaveText("2");
      await expect(page.getByTestId("desk-item-overdue:m2")).toContainText("zweite berechtigte Person");
      await expect(page.getByTestId("desk-item-incidents:m4")).toContainText("Map 2 ist in Klärung");
      await expect(page.getByTestId("desk-item-responsible-procedures:p1")).toContainText("Übernommen von Zweitleitung");
      await expect(page.getByTestId("desk-item-when-procedures:p1")).toContainText("Frist noch");
      await expect(page.getByTestId("desk-item-open-applications:a1")).toHaveAttribute("href", "/admin/leagues/seasons/s1#anmeldungen");
      await expect(page.getByTestId("desk-quiet")).toContainText("Kaderanträge");
      await expect(page.getByTestId("desk-log-l1")).toContainText("12 Empfänger, mit Mail");
      // Die Wege in die Arbeit sind Daumen-groß.
      const open = await page.getByTestId("desk-item-open-overdue:m1").boundingBox();
      expect(open.height).toBeGreaterThanOrEqual(44);
      await noSideScroll(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, `liga-leitstand-${width === 390 ? "handy" : "pc"}.png`, width === 390 ? null : page.getByTestId("season-panel-leitstand"));

      await page.getByTestId("desk-filter-mine").click();
      await expect(page.getByTestId("desk-total")).toHaveText("4");
      await expect(page.getByTestId("desk-item-overdue:m2")).toHaveCount(0);
      await expect(page.getByTestId("desk-item-procedures:p1")).toHaveCount(0);
      await page.getByTestId("desk-log-older").click();
      await expect(page.getByTestId("desk-log-page")).toHaveText("Seite 2 von 2");
      await noSideScroll(page);
    });
  }

  test("Rundnachricht am Handy: Vorgabe Captains, Kreis und Empfänger mit Zahl, Bestätigung, genau ein Versand", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const calls = await mockServer(page);
    await page.goto("/admin/leagues/seasons/s1#leitstand");
    await page.getByTestId("desk-broadcast-open").click();
    const sheet = page.getByTestId("broadcast-sheet");
    await expect(sheet.getByTestId("broadcast-preview")).toContainText("Geht an 14 Personen");
    await sheet.getByTestId("broadcast-scope").selectOption("staffel:t1");
    await expect(sheet.getByTestId("broadcast-preview")).toContainText("Geht an 6 Personen");
    await sheet.getByTestId("broadcast-scope").selectOption("season:");
    await sheet.getByTestId("broadcast-title").fill("Spieltag 3: Check-in ab 19:45");
    await sheet.getByTestId("broadcast-text").fill("Hallo zusammen, am Sonntag öffnet der Check-in um 19:45. Bitte meldet eure Teilnehmerliste rechtzeitig.");
    await expect(sheet.getByTestId("broadcast-preview")).toContainText("Geht an 14 Personen");
    await noSideScroll(page);
    await shot(page, "liga-rundnachricht-handy.png", sheet);

    await sheet.getByTestId("broadcast-send").dblclick();
    await expect(page.getByTestId("confirm-dialog")).toContainText("An 14 Personen schicken?");
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(sheet).toHaveCount(0);
    expect(calls.send).toHaveLength(1);
    expect(calls.send[0]).toMatchObject({ audience: "captains", scope: "season", mail: false });
  });

  test("ohne Aufgabe „Alles erledigt“; mit Bewegung zählen die Zähler hoch und die Liste steht danach ruhig", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page, { desk: { ...DESK, total: 0, mine: 0, groups: DESK.groups.map((group) => ({ ...group, items: [] })) } });
    await page.goto("/admin/leagues/seasons/s1#leitstand");
    await expect(page.getByTestId("desk-empty")).toContainText("Alles erledigt");
    await noSideScroll(page);

    const busy = await page.context().newPage();
    await mockServer(busy);
    await busy.goto("/admin/leagues/seasons/s1#leitstand");
    await expect(busy.getByTestId("desk-total")).toHaveText("6");
    await expect(busy.getByTestId("desk-item-overdue:m1")).toBeVisible();
    await expect.poll(() => busy.getByTestId("desk-item-overdue:m1").evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
    await busy.close();
  });
});
