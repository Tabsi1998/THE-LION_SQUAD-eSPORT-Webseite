const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Hinweis der Turnierleitung (#1166): in der Turnierleitung schreiben → Banner auf der Turnierseite (390 und 1440 px) →
// Band am Turnierbaum-TV. Die API ist nachgestellt und merkt sich, was geschrieben wurde. Namen sind erfunden.
// LSW_SCREENS=<Ordner> legt die Bildschirmfotos zusätzlich dort ab.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const shots = process.env.LSW_SCREENS || "";
const NOW = "2026-11-14T13:07:00.000Z"; // 14:07 in Wien
const SLUG = "kart-cup-herbst";
const TID = "t1";
const TOURNAMENT = {
  id: TID, slug: SLUG, title: "Kart-Cup Herbst", status: "live", format: "single_elim", is_public: true, visibility: "public",
  participant_count: 8, max_participants: 8, platform: "Switch 2", team_mode: "solo",
};

async function shot(page, testInfo, name, { fullPage = false } = {}) {
  // Erst fotografieren, wenn Einblenden, Aufleuchten und Wippen vorbei sind - die Leiste (Übergang) läuft weiter.
  await page.waitForFunction(() => [...document.querySelectorAll(".tls-notice")]
    .flatMap((node) => node.getAnimations({ subtree: true }))
    .every((item) => !(item instanceof window.CSSAnimation) || item.playState !== "running"), null, { polling: 100 });
  const body = await page.screenshot({ fullPage });
  await testInfo.attach(name, { body, contentType: "image/png" });
  if (shots) require("node:fs").writeFileSync(path.join(shots, name), body);
}

async function prepare(page, { width, height }) {
  await page.clock.install({ time: new Date(NOW) });
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
}

/** Eine kleine API, die sich die Hinweise merkt - wie der Server: einmal je Kennung, nur Text und Zeit nach außen. */
function fakeServer({ full = false } = {}) {
  const notices = [];
  const sent = [];
  const publicView = (row) => ({ id: row.id, text: row.text, created_at: row.created_at, expires_at: row.expires_at, target: row.target, tv: row.tv });
  async function handle(route) {
    const request = route.request();
    const url = new URL(request.url()).pathname;
    const method = request.method();
    if (url === "/api/auth/me") return route.fulfill(json({ id: "s1", username: "schiri", display_name: "Schiri Sam", role: "tournament_admin", is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true }));
    if (url === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (url === `/api/tournaments/${SLUG}/lead`) {
      return route.fulfill(json({ tournament: { ...TOURNAMENT, can_notice: true, can_pause: true, can_check_in: full }, now: NOW, matches: [], attention: [], recent: [], stations: [{ id: "st1", name: "PC 1" }], counts: { open: 0 } }));
    }
    if (url === `/api/tournaments/${SLUG}/live-queue`) return route.fulfill(json(full ? { applies: true, stations: [], summary: null } : { applies: false }));
    if (url === `/api/tournaments/${SLUG}/lead/notices/preview`) return route.fulfill(json({ recipients: 14, target: "tournament" }));
    if (url === `/api/tournaments/${SLUG}/lead/notices` && method === "POST") {
      const body = request.postDataJSON();
      sent.push(body);
      let row = notices.find((item) => item.request_id === body.request_id);
      const replay = Boolean(row);
      if (!row) {
        const created = Date.parse(NOW);
        row = {
          id: `tn-${notices.length + 1}`, request_id: body.request_id, text: body.text, target: body.target, tv: body.show_on_tv,
          created_at: new Date(created).toISOString(), expires_at: new Date(created + body.duration_minutes * 60000).toISOString(),
        };
        notices.unshift(row);
      }
      return route.fulfill(json({ id: row.id, recipients: 14, processed: 14, delivered: 14, state: "sent", replay }));
    }
    if (url === `/api/tournaments/${SLUG}/lead/notices`) {
      return route.fulfill(json({
        can_target_event: false, event_id: null,
        items: notices.map((row) => ({ ...publicView(row), target_label: "Alle im Turnier", author: "Schiri Sam", recipients: 14, processed: 14, delivered: 13, state: "sent", active: true, can_remove: true })),
      }));
    }
    if (url === `/api/tournaments/${SLUG}`) return route.fulfill(json(TOURNAMENT));
    if (url === `/api/tournaments/${TID}/notices`) return route.fulfill(json({ items: notices.map(publicView) }));
    if (url === `/api/tournaments/${TID}/registrations`) return route.fulfill(json([]));
    if (url === `/api/tournaments/${TID}/bracket/display`) {
      return route.fulfill(json({
        tournament: { ...TOURNAMENT }, registrations: [], stages: [], matches: [], matches_v2: [], engine: "stage",
        seats: { taken: 8, capacity: 8 }, notices: notices.filter((row) => row.tv).map(publicView),
      }));
    }
    return route.fulfill(json([]));
  }
  return { handle, notices, sent };
}

test.describe("Hinweis der Turnierleitung", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  test("schreiben am Handy → Banner auf der Turnierseite (390 und 1440 px) → TV", async ({ page }, testInfo) => {
    await prepare(page, { width: 390, height: 844 });
    const server = fakeServer();
    await page.route("**/api/**", server.handle);

    // 1) Turnierleitung am Handy: Reiter „Hinweis“, Vorlage „Pause bis …“, TV-Haken, senden.
    await page.goto(`/tournaments/${SLUG}/leitung?reiter=hinweis`);
    await expect(page.getByTestId("lead-tab-notice")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("notice-recipients")).toContainText("Geht an 14 Personen");
    await page.getByTestId("notice-template-pause").click();
    await expect(page.getByTestId("notice-text-input")).toHaveValue("Pause bis 14:25");
    await expect(page.getByTestId("notice-tv")).toBeChecked();
    await expect(page.getByTestId("notice-pause-row")).toContainText("Turnier gleich pausieren bis 14:25");
    // Doppelklick: zwei Anfragen mit derselben Kennung, ein Hinweis.
    await page.getByTestId("notice-send").dblclick();
    await expect(page.getByTestId("notice-log-tn-1")).toContainText("Pause bis 14:25");
    expect(server.notices).toHaveLength(1);
    expect(new Set(server.sent.map((body) => body.request_id)).size).toBe(1);
    expect(server.sent[0]).toMatchObject({ text: "Pause bis 14:25", target: "tournament", show_on_tv: true, duration_minutes: 120 });
    await expect(page.getByTestId("notice-log-tn-1")).toContainText("Schiri Sam · Alle im Turnier · am TV");
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Für das Bild: der nächste Hinweis im Formular, der erste steht schon im Protokoll. Die Meldung oben ist dann weg.
    await page.getByTestId("notice-template-final").click();
    await page.clock.runFor(6000);
    // Das Formular ganz im Bild (unter der Kopfleiste), darunter der Anfang des Protokolls.
    await page.getByTestId("notice-form").evaluate((node) => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 72));
    await shot(page, testInfo, "1166-hinweis-390.png");

    // 2) Turnierseite am Handy: das Banner steht oben - Text und Zeit, keine Person.
    await page.goto(`/tournaments/${SLUG}`);
    const banner = page.getByTestId("notice-banner");
    await expect(banner).toContainText("Hinweis der Turnierleitung");
    await expect(banner).toContainText("Pause bis 14:25");
    await expect(banner).toContainText("14:07 Uhr · noch 2 Std.");
    await expect(banner).not.toContainText("Schiri Sam");
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // 3) Dieselbe Seite am PC.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(page.getByTestId("notice-banner")).toContainText("Pause bis 14:25");
    await expect(page.locator(".tls-notice").first()).toHaveCSS("opacity", "1");
    await shot(page, testInfo, "1166-banner-1440.png");

    // 4) Turnierbaum-TV: das Band unter der Kopfleiste.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/display/bracket/${TID}`);
    await expect(page.getByTestId("tv-notice-band")).toContainText("Pause bis 14:25");
    await expect(page.getByTestId("tv-notice-time")).toContainText("noch 2 Std.");

    // 5) Abgelaufen: Banner und TV-Band verschwinden von selbst.
    await page.clock.fastForward("02:01:00");
    await expect(page.getByTestId("tv-notice-band")).toHaveCount(0);
  });

  test("Worst Case: 140 Zeichen ohne Leerzeichen und drei Hinweise zugleich brechen nichts", async ({ page }) => {
    await prepare(page, { width: 375, height: 812 });
    const server = fakeServer();
    const long = `Bitte-alle-Teams-von-Ålesund-Zoë-und-Łódź-${"x".repeat(140)}`.slice(0, 140);
    for (const [index, text] of [long, "Finale an PC 1 🏁", "Bitte zum Check-in"].entries()) {
      server.notices.push({ id: `tn-w${index}`, request_id: `w${index}`, text, target: "tournament", tv: true,
        created_at: new Date(Date.parse(NOW) - index * 60000).toISOString(), expires_at: new Date(Date.parse(NOW) + 3600000).toISOString() });
    }
    await page.route("**/api/**", server.handle);
    await page.goto(`/tournaments/${SLUG}`);
    await expect(page.getByTestId("notice-text")).toHaveCount(3);
    await expect(page.getByTestId("notice-text").first()).toContainText("Bitte-alle-Teams");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.goto(`/tournaments/${SLUG}/leitung?reiter=hinweis`);
    await expect(page.getByTestId("notice-log-tn-w0")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/display/bracket/${TID}`);
    // Am TV höchstens zwei, der neueste zuerst - ohne dass etwas quer hinausläuft.
    await expect(page.getByTestId("tv-notice-text")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test("Reiterleiste bei 390 px mit allen fünf Reitern: wischbar, „Hinweis“ erreichbar, nichts läuft aus dem Bild", async ({ page }, testInfo) => {
    await prepare(page, { width: 390, height: 844 });
    const server = fakeServer({ full: true });
    await page.route("**/api/**", server.handle);
    await page.goto(`/tournaments/${SLUG}/leitung`);
    for (const key of ["attention", "checkin", "stations", "results", "notice"]) await expect(page.getByTestId(`lead-tab-${key}`)).toHaveCount(1);
    await expect(page.getByTestId("lead-tab-stations")).toHaveAttribute("aria-selected", "true");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Erst wenn die Seite fertig eingeblendet ist (Einblenden der Ansicht, echte Zeit - die installierte Uhr hält die
    // Abfrage im Browser an, darum hier warten).
    await page.waitForTimeout(600);
    await shot(page, testInfo, "1166-reiter-390.png");
    await page.getByTestId("lead-tab-notice").click();
    await expect(page.getByTestId("lead-tab-notice")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("notice-form")).toBeVisible();
  });
});
