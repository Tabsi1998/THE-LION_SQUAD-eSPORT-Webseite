const { test, expect } = require("@playwright/test");

// Benachrichtigungs-Zentrum (#1662, #1205) bei 390 und 1440 px: Glocke und Postfach nach Tagen und Themen gegliedert,
// Gleichartiges gebündelt („3 neue Ergebnisse in Liga 1“), Einstellungen in Reitern mit der Sammel-Mail. Der Server ist
// nachgestellt; Thema und Wichtigkeit liefert er je Meldung (backend/services/user_notifications.with_topic).
// Bilder:  NOTIFY_SHOTS=<ordner> [NOTIFY_SHOT_PREFIX=vorher-] npx playwright test e2e/notification-center.spec.js --project=chromium --workers=1

const SHOTS = process.env.NOTIFY_SHOTS || "";
const PREFIX = process.env.NOTIFY_SHOT_PREFIX || "";
const TOPICS = ["match_reminders", "tournament_updates", "prize_updates", "achievements", "billing_updates",
  "membership_updates", "community_messages", "news_events", "club_internal", "helper_shifts"];
const modes = (pushed) => Object.fromEntries(TOPICS.map((topic) => [topic, pushed.includes(topic) ? "push" : "app"]));
const OPTIONS = [
  { key: "instant", label: "Sofort", schedule: "Jede Mail sofort" },
  { key: "daily", label: "Täglich", schedule: "Täglich um 07:00 Uhr" },
  { key: "weekly", label: "Wöchentlich", schedule: "Montags um 07:00 Uhr" },
];

const HOUR = 60 * 60 * 1000;
// Feste Uhr (12:00 Wiener Zeit): „Heute“ und „Gestern“ hängen am Kalendertag in Wien. Mit der echten Uhr war der Test
// kurz nach Mitternacht rot (CI-Lauf 23:13 UTC = 00:13 in Wien, #2593) - die Meldungen von „Heute“ lagen dann gestern.
const NOW = Date.parse("2026-11-26T11:00:00.000Z");
function ago(hours) {
  return new Date(NOW - hours * HOUR).toISOString();
}
// Mittag minus Tage und Minuten - „Heute“ liegt höchstens eine halbe Stunde zurück.
function noonDaysAgo(days, minutes = 0) {
  return new Date(NOW - days * 24 * HOUR - (30 - minutes) * 60 * 1000).toISOString();
}

function row(id, kind, topic, importance, title, body, created_at, extra = {}) {
  return { id, kind, topic, importance, title, body, url: "", read: false, created_at, meta: {}, ...extra };
}

function rows() {
  return [
    row("call-1", "match_call", "match_reminders", "urgent", "Du bist dran: Station 3", "Mario Kart Winter Cup · Halbfinale gegen Neon Kings.", ago(0.1),
      { meta: { match_id: "m-7" } }),
    row("res-3", "match_result", "match_reminders", "normal", "Ergebnis bestätigt", "Liga 1: Rudel A 3:1 Rudel B", noonDaysAgo(0, 30),
      { meta: { match_id: "m-3", tournament_id: "liga-1", tournament_title: "Liga 1" } }),
    row("res-2", "match_result", "match_reminders", "normal", "Ergebnis bestätigt", "Liga 1: Rudel C 2:2 Rudel D", noonDaysAgo(0, 20),
      { meta: { match_id: "m-2", tournament_id: "liga-1", tournament_title: "Liga 1" } }),
    row("res-1", "match_result", "match_reminders", "normal", "Ergebnis bestätigt", "Liga 1: Rudel E 0:2 Rudel F", noonDaysAgo(0, 10),
      { meta: { match_id: "m-1", tournament_id: "liga-1", tournament_title: "Liga 1" } }),
    row("prog-1", "tournament_progress", "tournament_updates", "important", "Du bist weiter!", "Mario Kart Winter Cup · Viertelfinale: gewonnen – du bist in der nächsten Runde.",
      noonDaysAgo(1, 40), { url: "/matches/m-7", meta: { tournament_id: "t-1", reason: "advanced" } }),
    row("pause-1", "tournament_pause", "tournament_updates", "important", "Pause bis 14:30", "Mario Kart Winter Cup: Es geht um 14:30 Uhr weiter.", noonDaysAgo(1, 20),
      { url: "/tournaments/mario-kart-winter-cup", meta: { tournament_id: "t-1" } }),
    row("dm-1", "direct_message", "community_messages", "important", "Neue Nachricht von Max", "Bist du am Samstag dabei?", noonDaysAgo(1, 5),
      { meta: { thread_user_id: "user-max" } }),
    row("ach-1", "achievement", "achievements", "normal", "Erfolg freigeschaltet", "Frühaufsteher I (Bronze)", noonDaysAgo(4), { read: true }),
    row("inv-1", "invoice_ready", "billing_updates", "important", "Deine Rechnung ist da", "Weihnachtsfeier · 40,00 € bis 17.12.", noonDaysAgo(6), { read: true }),
  ];
}

const SETTINGS = {
  discord: { linked: false },
  topics: TOPICS,
  levels: [
    { key: "all", label: "Alles", description: "Jedes Thema per Push – nichts verpasst.", modes: modes(TOPICS) },
    { key: "important", label: "Wichtiges", description: "Spiele, Turniere, Rechnungen, Mitgliedschaft, Nachrichten an dich und Helferdienste per Push. Der Rest liegt in der Glocke.",
      modes: modes(["match_reminders", "tournament_updates", "billing_updates", "membership_updates", "community_messages", "helper_shifts"]) },
    { key: "few", label: "Wenig", description: "Nur Spiele und Aufrufe sowie Rechnungen per Push. Alles andere liegt in der Glocke.", modes: modes(["match_reminders", "billing_updates"]) },
  ],
  quiet_hours_exceptions: ["Aufruf zu deinem Spiel und „Match startet jetzt“"],
};

async function mockServer(page) {
  await page.clock.install({ time: new Date(NOW) });
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const seen = { patches: [], reads: [], digest: "instant",
    me: { id: "u-zentrum", username: "paula", display_name: "Paula", role: "player", email: "paula@lionsquad-test.at", notification_preferences: {}, newsletter_consent: false, updated_at: "2026-11-01T10:00:00.000000+00:00" } };
  const list = rows();
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.startsWith("/changes")) return route.abort();
    if (path === "/auth/me") return json(seen.me);
    if (path === "/settings/public") return json({ club_name: "THE LION SQUAD" });
    if (path === "/admin/notifications") return json(list);
    if (/^\/admin\/notifications\/[^/]+\/read$/.test(path)) {
      seen.reads.push(path.split("/")[3]);
      return json({ ok: true });
    }
    if (path === "/users/me" && request.method() === "PATCH") {
      const body = request.postDataJSON();
      seen.patches.push(body);
      if (body.mail_digest) seen.digest = body.mail_digest;
      seen.me = { ...seen.me, ...body };
      return json(seen.me);
    }
    if (path === "/users/me" && request.method() === "GET") return json(seen.me);
    if (path === "/users/me/notification-preferences") {
      return json({ ...SETTINGS, mail_digest: { rhythm: seen.digest, own: seen.digest === "instant" ? null : seen.digest, default: "instant", options: OPTIONS } });
    }
    if (path === "/web-push/config") return json({ enabled: false });
    if (request.method() !== "GET") return json({ ok: true });
    if (path === "/me/platform-links") return json({ links: [], available: {}, platforms: {} });
    return json(["/home/about", "/chats/unread", "/seasonal/active"].includes(path) ? {} : []);
  });
  return seen;
}

const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function shot(page, locator, name, width) {
  if (!SHOTS) return;
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(350);
  await locator.screenshot({ path: `${SHOTS}/${PREFIX}${name}-${width}.png` });
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test.describe(`${width} px`, () => {
    test.skip(({ isMobile }) => Boolean(isMobile), "die Breiten stehen hier ausdrücklich");
    test.use({ viewport: { width, height } });

    test("Postfach nach Tagen und Themen, Ergebnisse gebündelt", async ({ page }) => {
      const seen = await mockServer(page);
      await page.goto("/notifications");
      const groups = page.getByTestId("notifications-groups");
      await expect(groups.getByTestId("notifications-groups-day-today")).toContainText("Heute");
      await expect(groups.getByTestId("notifications-groups-day-yesterday")).toContainText("Gestern");
      await expect(groups.getByTestId("notifications-groups-day-earlier")).toContainText("Früher");
      await expect(groups.getByText("3 neue Ergebnisse in Liga 1", { exact: true })).toBeVisible();
      await expect(groups.getByText("Dringend, Spiele & Aufrufe")).toHaveCount(1);
      // Ein Thema antippen: nur noch Turnier-Updates.
      await groups.getByTestId("notifications-groups-topic-tournament_updates").click();
      await expect(groups.getByText("Du bist weiter!", { exact: true })).toBeVisible();
      await expect(groups.getByText("3 neue Ergebnisse in Liga 1", { exact: true })).toHaveCount(0);
      await expect(groups.getByTestId("notifications-groups-day-today")).toHaveCount(0);
      await groups.getByTestId("notifications-groups-topic-all").click();
      // Das Bündel öffnen markiert alle drei als gelesen.
      await groups.getByText("3 neue Ergebnisse in Liga 1", { exact: true }).click();
      await expect.poll(() => seen.reads.slice().sort()).toEqual(["res-1", "res-2", "res-3"]);
      expect(await noSidewaysScroll(page)).toBe(true);
    });

    test("Glocke: dieselbe Gliederung, Themen wischbar", async ({ page }) => {
      await mockServer(page);
      await page.goto("/notifications");
      await page.getByTestId("notification-bell").click();
      const panel = page.getByTestId("notification-panel");
      await expect(panel.getByTestId("notification-groups-day-today")).toContainText("Heute");
      await expect(panel.getByText("3 neue Ergebnisse in Liga 1", { exact: true })).toBeVisible();
      await expect(panel.getByTestId("notification-groups-topics")).toBeVisible();
      expect(await noSidewaysScroll(page)).toBe(true);
    });

    test("Sammel-Mail einstellen - auch über den Link aus der Mail", async ({ page }) => {
      const seen = await mockServer(page);
      await page.goto("/profile?tab=notifications&bereich=mail");
      await expect(page.getByTestId("notification-section-mail")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("notification-digest-instant")).toHaveAttribute("aria-checked", "true");
      await expect(page.getByTestId("notification-digest-default")).toContainText("Vorgabe des Vereins: Sofort");
      await page.getByTestId("notification-digest-daily").click();
      await expect(page.getByTestId("notification-digest-daily")).toHaveAttribute("aria-checked", "true");
      await expect(page.getByTestId("notification-digest-summary")).toContainText("Täglich um 07:00 Uhr.");
      await expect.poll(() => seen.patches.at(-1)?.mail_digest).toBe("daily");
      expect(await noSidewaysScroll(page)).toBe(true);
      // Reiter wechseln und zurück: die Wahl bleibt.
      await page.getByTestId("notification-section-themen").click();
      await page.getByTestId("notification-section-mail").click();
      await expect(page.getByTestId("notification-digest-daily")).toHaveAttribute("aria-checked", "true");
    });

    test("Bilder: Postfach, Glocke und Einstellungen", async ({ page }) => {
      test.skip(!SHOTS, "nur für Bilder");
      await mockServer(page);
      await page.goto("/notifications");
      await expect(page.getByTestId("notifications-page")).toBeVisible();
      await page.setViewportSize({ width, height: 1500 });
      await shot(page, page.getByTestId("notifications-page"), "postfach", width);
      await page.setViewportSize({ width, height });
      await page.getByTestId("notification-bell").click();
      await expect(page.getByTestId("notification-panel")).toBeVisible();
      await page.getByTestId("notification-panel").getByText("Alle", { exact: true }).first().click();
      await shot(page, page.getByTestId("notification-panel"), "glocke", width);
      await page.keyboard.press("Escape");
      await page.goto("/profile?tab=notifications");
      await expect(page.locator(".tls-notify")).toBeVisible();
      await page.setViewportSize({ width, height: 2600 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, page.locator(".tls-notify"), "einstellungen", width);
      const mail = page.getByTestId("notification-section-mail");
      if (await mail.count()) {
        await mail.click();
        await page.getByTestId("notification-digest-daily").click();
        await shot(page, page.locator(".tls-notify"), "einstellungen-email", width);
      }
    });
  });
}

// Prüfung 26.11.: „Wöchentlich“ war bei 360 und 320 px abgeschnitten. Nichts abschneiden - bei 320, 360 und 390 px.
for (const width of [320, 360, 390]) {
  test.describe(`Segment bei ${width} px`, () => {
    test.skip(({ isMobile }) => Boolean(isMobile), "die Breiten stehen hier ausdrücklich");
    test.use({ viewport: { width, height: 800 } });

    test("Sofort, Täglich, Wöchentlich und die Themen ohne Abschneiden; Vorgabe des Vereins wählbar", async ({ page }) => {
      const seen = await mockServer(page);
      await page.goto("/profile?tab=notifications&bereich=mail");
      await page.getByTestId("notification-digest-weekly").click();
      await expect(page.getByTestId("notification-digest-weekly")).toHaveAttribute("aria-checked", "true");
      const clipped = await page.locator(".tls-seg__option").evaluateAll((nodes) => nodes
        .filter((node) => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1)
        .map((node) => node.textContent));
      expect(clipped).toEqual([]);
      expect(await noSidewaysScroll(page)).toBe(true);
      await shot(page, page.getByTestId("notification-digest"), "segment", width);
      await page.getByTestId("notification-digest-use-default").click();
      await expect.poll(() => seen.patches.some((patch) => "mail_digest" in patch && patch.mail_digest === null)).toBe(true);
      await expect(page.getByTestId("notification-digest-default")).toContainText("Vorgabe des Vereins: Sofort");
      await page.getByTestId("notification-section-themen").click();
      const topicClipped = await page.locator(".tls-seg__option").evaluateAll((nodes) => nodes
        .filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.textContent));
      expect(topicClipped).toEqual([]);
    });
  });
}

// Dritte Prüfrunde (26.11.): Die Seiten mit Schlüssel in der Adresse schicken ihn nie als Referer weiter - weder an die eigene API
// noch an Dritte. Im Betrieb setzt nginx „no-referrer“ schon für das Dokument; die Seite setzt es zusätzlich, bevor ein Abruf startet.
for (const [path, ready, confirm, api] of [
  ["/sammel-mail/einzeln?token=u1.sig", "digest-instant", "digest-instant-confirm", "/api/settings/notification-digest/instant"],
  ["/newsletter/abbestellen?token=u1.sig", "newsletter-unsubscribe", "newsletter-unsubscribe-confirm", "/api/settings/newsletter/unsubscribe"],
]) {
  test(`kein Schlüssel im Referer: ${path.split("?")[0]}`, async ({ page }) => {
    const leaked = [];
    const posted = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      const referer = request.headers().referer || "";
      if ((url.pathname.startsWith("/api/") || url.host !== new URL(page.url() || "http://x").host) && referer.includes("u1.sig")) {
        leaked.push(`${url.pathname} ← ${referer}`);
      }
    });
    // Am Handy liegt der Cookie-Hinweis unten über dem Knopf (Pixel 5) - wie in den übrigen Specs vorher beantwortet.
    await page.addInitScript(() => {
      window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
    });
    // Die Seiten sind ohne Anmeldung gedacht: /auth/me sagt „nicht angemeldet“ (sonst stünde am Handy die Leiste der App
    // davor). Der eigentliche Abruf wird mitgeschrieben - der Test prüft den echten Klick, nicht irgendeinen Knopf.
    await page.route("**/api/**", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/auth/me") return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Nicht angemeldet" }) });
      if (url.pathname === api && request.method() === "POST") posted.push({ query: url.search, body: request.postDataJSON() });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rhythm: "instant" }) });
    });
    await page.goto(path);
    await expect(page.getByTestId(ready)).toBeVisible();
    // Nach dem Entfernen des Schlüssels gibt die Seite die übliche Regel zurück (keine Navigation mit „no-referrer“).
    await expect(page).not.toHaveURL(/token=/);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "strict-origin-when-cross-origin");
    await page.getByTestId(confirm).click();
    await expect.poll(() => posted.length).toBe(1);
    // Der Schlüssel geht im Body, nicht in der Adresse.
    expect(posted[0]).toEqual({ query: "", body: { token: "u1.sig" } });
    await expect(page.getByText(/Erledigt/)).toBeVisible();
    expect(leaked).toEqual([]);
  });
}
