const { test, expect } = require("@playwright/test");

// Rückblick nach dem Event (#1187) und Freunde beim Event (#1188): ein beendetes Event zeigt oben den Rückblick mit
// Treppchen und Zahlen - am Handy (390 px) ohne seitliches Scrollen. Angemeldete Teilnehmer sehen „Du warst dabei“ und
// ihre bestätigten Freunde. Die API ist nachgestellt, die Uhr steht fest.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const EVENT = {
  id: "e1", slug: "gamers-fest-2026", name: "Gamers Fest 2026", status: "scheduled", visibility: "public", event_type: "lan",
  start_date: "2026-06-20T08:00:00+00:00", end_date: "2026-06-21T18:00:00+00:00", location: "Vereinsheim", city: "Telfs", has_registration: true,
  public_phase: { state: "completed", label: "Beendet" },
  registrations: [], sponsors: [], albums: [], news: [], f1_challenges: [], partners: [],
  tournaments: [{ id: "t1", slug: "mk-summer-cup", title: "Mario Kart Summer Cup", status: "results_published", format: "single_elim" }],
};

const RECAP = {
  available: true, event_id: "e1",
  winners: [{ kind: "tournament", id: "t1", slug: "mk-summer-cup", title: "Mario Kart Summer Cup", team: false, podium: [
    { rank: 1, name: "NeonFalke", team: false, detail: "3 Siege" },
    { rank: 2, name: "Schattenwolf mit einem sehr langen Spielernamen", team: false, detail: "2 Siege" },
    { rank: 3, name: "Pixelkatze", team: false, detail: "1 Sieg" },
  ] }],
  fastlaps: [{ kind: "fastlap", id: "f1", slug: "spa", title: "Fast Lap Spa", track: "Spa", tracks: 1, podium: [
    { rank: 1, name: "NeonFalke", time_ms: 91234, detail: "1:31.234" },
  ] }],
  numbers: { participants: 42, matches: 31, tournaments: 1, fastlaps: 1, photos: 120 },
  report: { id: "n1", slug: "rueckblick-gamers-fest", title: "Rückblick: Gamers Fest 2026", excerpt: "Zwei Tage, 42 Leute, viel Mario Kart." },
  mine: null,
};

async function mockApi(page, { user = null } = {}) {
  await page.clock.setFixedTime(new Date("2026-10-07T10:00:00+00:00"));
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const recap = user ? { ...RECAP, mine: { was_there: true, results: [{ kind: "tournament", id: "t1", slug: "mk-summer-cup", title: "Mario Kart Summer Cup", rank: 3, of: 16, team_name: null }] } } : RECAP;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/events/gamers-fest-2026") return route.fulfill(json({ ...EVENT, own_registration: user ? { id: "r1", status: "checked_in", seat_count: 1 } : null }));
    if (path === "/api/events/gamers-fest-2026/recap") return route.fulfill(json(recap));
    if (path === "/api/events/gamers-fest-2026/friends") {
      if (!user) return route.fulfill(json({ detail: "Nicht angemeldet" }, 401));
      return route.fulfill(json({ sharing: true, hint: false, friends: [
        { id: "u2", display_name: "Finn", avatar_url: null, username: "finn", where: [{ kind: "event" }, { kind: "tournament", id: "t1", title: "Mario Kart Summer Cup", team_name: null }] },
      ] }));
    }
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/auth/me") return user ? route.fulfill(json(user)) : route.fulfill(json({ detail: "anonym" }, 401));
    return route.abort();
  });
}

test.describe("Rückblick nach dem Event", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  test("Gast bei 390 px: Treppchen, Zahlen und Bericht, keine Anmeldung, nichts ragt hinaus", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page);
    await page.goto("/events/gamers-fest-2026");
    const recap = page.getByTestId("event-recap");
    await expect(recap).toBeVisible();
    await expect(page.getByTestId("event-recap-podium-t1-1")).toContainText("NeonFalke");
    await expect(page.getByTestId("event-recap-number-participants")).toContainText("42");
    await expect(page.getByTestId("event-recap-report")).toHaveAttribute("href", "/news/rueckblick-gamers-fest");
    await expect(page.getByTestId("event-recap-mine")).toHaveCount(0);
    await expect(page.getByTestId("event-friends")).toHaveCount(0);
    await expect(page.getByTestId("event-over")).toHaveCount(0);
    await expect(page.getByTestId("event-yours")).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await testInfo.attach("rueckblick-390.png", { body: await recap.screenshot(), contentType: "image/png" });
  });

  test("Teilnehmer bei 1440 px: „Du warst dabei“ und die Freunde, die dabei waren", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page, { user: { id: "u1", username: "lena", display_name: "Lena", role: "player", roles: ["player"], areas: [] } });
    await page.goto("/events/gamers-fest-2026");
    await expect(page.getByTestId("event-recap-mine")).toContainText("Platz 3 von 16");
    await expect(page.getByTestId("event-friends")).toContainText("Deine Freunde waren dabei");
    await expect(page.getByTestId("event-friend-u2")).toContainText("Event · Mario Kart Summer Cup");
    await testInfo.attach("rueckblick-1440.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });
});
