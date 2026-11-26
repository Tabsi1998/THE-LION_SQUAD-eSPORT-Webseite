const { test, expect } = require("@playwright/test");

// Browser-Benachrichtigungen (#1163, #1208) bei 390 und 1440 px: die Frage kommt nie beim ersten Besuch, sondern nach einer
// Anmeldung - zuerst die eigene Erklärung, erst „Ja, rufen“ holt die Zustimmung des Browsers und meldet ihn beim Server an.
// Hat der Browser abgelehnt, steht auf der Turnierseite leise „Aufrufe sind aus – einschalten“. In den
// Einstellungen stehen Kanal „Browser“ und „Dieser Browser“. Zustimmung und Push-Dienst sind nachgestellt (headless gibt
// es keinen echten Push-Dienst); was ein Tipp auf die Meldung öffnet, prüft src/lib/serviceWorker.test.js. Seit #1204 gilt
// „Push“ je Thema für App und Browser; den Kanal „Browser“ ganz abschalten geht unter „Weitere Wege“.

const ME = { id: "u-push", username: "pushloewe", display_name: "PushLöwe", role: "player", email: "push@lionsquad-test.at", updated_at: "2026-11-01T10:00:00.000000+00:00" };
const CONFIG = { enabled: true, public_key: `B${"Q".repeat(86)}`, subscriptions: 0 };
const SHOTS = process.env.WEB_PUSH_SHOTS || "";

const TOURNAMENT = {
  id: "tournament-push", slug: "probe-cup", title: "Probe Cup", status: "registration_open", registration_enabled: true,
  participant_count: 0, max_participants: 16, team_mode: "solo", event_mode: "online", start_date: "2099-10-04T18:00:00+00:00",
  game: { id: "game-1", slug: "probe-game", name: "Probespiel", player_id_fields: [] },
  public_phase: { state: "registration_open", label: "Anmeldung" },
};

async function mockServer(page, { storage = {}, permission: startPermission = "default" } = {}) {
  await page.addInitScript(({ storage: values, startPermission: initial }) => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
    for (const [key, value] of Object.entries(values)) {
      if (!window.localStorage.getItem(`${key}:gesetzt`)) {
        window.localStorage.setItem(key, value);
        window.localStorage.setItem(`${key}:gesetzt`, "1");
      }
    }
    // Zustimmung und Push-Dienst nachgestellt: der Browser sagt „erlaubt“, die Anmeldung hat eine erfundene Adresse.
    let permission = initial;
    let current = null;
    window.__pushAsked = 0;
    const Notification = function Notification() {};
    Object.defineProperty(Notification, "permission", { get: () => permission });
    Notification.requestPermission = async () => { window.__pushAsked += 1; permission = "granted"; return permission; };
    window.Notification = Notification;
    window.PushManager = window.PushManager || function PushManager() {};
    const pushManager = {
      getSubscription: async () => current,
      subscribe: async () => {
        current = {
          endpoint: "https://fcm.googleapis.com/fcm/send/e2e-browser",
          options: { applicationServerKey: null },
          toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/e2e-browser", keys: { p256dh: "B".padEnd(87, "A"), auth: "A".repeat(22) } }),
          unsubscribe: async () => { current = null; return true; },
        };
        return current;
      },
    };
    Object.defineProperty(window.navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve({ pushManager }), register: async () => ({}), getRegistration: async () => undefined, addEventListener() {} } });
  }, { storage, startPermission });
  const seen = { subscribed: [], registered: 0 };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.startsWith("/changes")) return route.abort();
    if (path === "/auth/me") return json(ME);
    if (path === "/web-push/config") return json({ ...CONFIG, subscriptions: seen.subscribed.length });
    if (path === "/web-push/subscriptions" && request.method() === "POST") {
      const body = request.postDataJSON();
      seen.subscribed.push(body);
      if (typeof body.private === "boolean") seen.private = body.private;
      return json({ ok: true, private: Boolean(seen.private) });
    }
    if (path === "/settings/public") return json({ club_name: "THE LION SQUAD" });
    if (path === "/tournaments/probe-cup") return json({ ...TOURNAMENT, participant_count: seen.registered });
    if (path === "/mobile/dashboard") return json(seen.dashboard || { me: { tournaments: [], events: [], matches: [], staff_matches: [], actions: [] } });
    if (path === `/tournaments/${TOURNAMENT.id}/register` && request.method() === "POST") {
      seen.registered += 1;
      return json({ id: "registration-push", user_id: ME.id, display_name: ME.display_name, status: "approved" });
    }
    if (path === `/tournaments/${TOURNAMENT.id}/registrations`) {
      return json(seen.registered ? [{ id: "registration-push", user_id: ME.id, display_name: ME.display_name, status: "approved" }] : []);
    }
    if (path === "/users/me" && request.method() === "GET") return json(ME);
    if (request.method() !== "GET") return json({ ok: true });
    if (path === "/me/platform-links") return json({ links: [], available: {}, platforms: {} });
    if (path === "/users/me/notification-preferences") return json({ discord: { linked: false } });
    return json(["/home/about", "/chats/unread", "/seasonal/active"].includes(path) ? {} : []);
  });
  return seen;
}

const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test.describe(`${width} px`, () => {
    test.skip(({ isMobile }) => Boolean(isMobile), "die Breiten stehen hier ausdrücklich");
    test.use({ viewport: { width, height } });

    test("beim ersten Besuch keine Frage, auch nicht nach einer Anmeldung", async ({ page }) => {
      await mockServer(page, { storage: { "tls-web-push-ask": "pending" } });
      await page.goto("/notifications");
      await expect(page.getByTestId("notifications-settings-link")).toBeVisible();
      await page.waitForTimeout(600);
      await expect(page.getByTestId("web-push-hint")).toHaveCount(0);
    });

    test("beim nächsten Besuch nach der Anmeldung: Frage, Zustimmung, Browser angemeldet", async ({ page }) => {
      const seen = await mockServer(page, { storage: { "tls-web-push-ask": "pending", "tls-web-push-first-visit": "frueher" } });
      await page.goto("/notifications");
      const hint = page.getByTestId("web-push-hint");
      await expect(hint).toBeVisible();
      await expect(hint).toContainText("Sollen wir dich rufen, wenn du dran bist?");
      expect(await page.evaluate(() => window.__pushAsked)).toBe(0);
      expect(await noSidewaysScroll(page)).toBe(true);
      if (SHOTS && width === 390) await page.screenshot({ path: `${SHOTS}/1163-frage-390.png` });
      await page.getByTestId("web-push-hint-allow").click();
      await expect(hint).toHaveCount(0);
      expect(await page.evaluate(() => window.__pushAsked)).toBe(1);
      await expect.poll(() => seen.subscribed.length).toBe(1);
      expect(seen.subscribed[0].endpoint).toBe("https://fcm.googleapis.com/fcm/send/e2e-browser");
      expect(await page.evaluate(() => window.localStorage.getItem("tls-web-push-ask"))).toBe("asked");
    });

    test("„Später“ - nach dem Neuladen keine Frage, erst bei der nächsten Anmeldung", async ({ page }) => {
      await mockServer(page, { storage: { "tls-web-push-ask": "pending", "tls-web-push-first-visit": "frueher" } });
      await page.goto("/notifications");
      await page.getByTestId("web-push-hint-later").click();
      await expect(page.getByTestId("web-push-hint")).toHaveCount(0);
      expect(await page.evaluate(() => window.localStorage.getItem("tls-web-push-ask"))).toBe("later");
      await page.reload();
      await expect(page.getByTestId("notifications-settings-link")).toBeVisible();
      await page.waitForTimeout(600);
      await expect(page.getByTestId("web-push-hint")).toHaveCount(0);
      expect(await page.evaluate(() => window.__pushAsked)).toBe(0);
    });

    test("Turnier-Anmeldung: erst die Erklärung mit Aufruf, Check-in und Ergebnis, „Ja, rufen“ fragt den Browser (#1208)", async ({ page }) => {
      const seen = await mockServer(page, { storage: { "tls-web-push-first-visit": "frueher" } });
      await page.goto("/tournaments/probe-cup");
      await page.getByTestId("tournament-register-btn").click();
      await page.getByTestId("tournament-register-submit").click();
      const hint = page.getByTestId("web-push-hint");
      await expect(hint).toBeVisible();
      await expect(hint).toContainText("Sollen wir dich rufen, wenn du dran bist?");
      for (const line of ["Aufruf", "Check-in", "Ergebnis"]) await expect(page.getByTestId(`web-push-hint-line-${line}`)).toBeVisible();
      expect(await page.evaluate(() => window.__pushAsked)).toBe(0);
      for (const id of ["web-push-hint-allow", "web-push-hint-later"]) {
        const box = await page.getByTestId(id).boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      expect(await noSidewaysScroll(page)).toBe(true);
      if (SHOTS) {
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${SHOTS}/1208-erklaerung-${width}.png` });
      }
      await page.getByTestId("web-push-hint-allow").click();
      await expect(hint).toHaveCount(0);
      expect(await page.evaluate(() => window.__pushAsked)).toBe(1);
      await expect.poll(() => seen.subscribed.length).toBe(1);
    });

    test("Browser hat abgelehnt: leise „Aufrufe sind aus – einschalten“ führt zu den Einstellungen, keine Frage (#1208)", async ({ page }) => {
      await mockServer(page, { storage: { "tls-web-push-first-visit": "frueher" }, permission: "denied" });
      await page.goto("/tournaments/probe-cup");
      const off = page.getByTestId("tournament-push-off");
      await expect(off).toBeVisible();
      await expect(off).toHaveText("Aufrufe sind aus – einschalten");
      expect((await off.boundingBox()).height).toBeGreaterThanOrEqual(44);
      expect(await noSidewaysScroll(page)).toBe(true);
      if (SHOTS) {
        await off.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${SHOTS}/1208-hinweis-${width}.png` });
      }
      // Auch nach einer Anmeldung keine Frage - der Browser hat entschieden.
      await page.getByTestId("tournament-register-btn").click();
      await page.getByTestId("tournament-register-submit").click();
      await expect(page.getByTestId("tournament-my-stand")).toBeVisible();
      await page.waitForTimeout(600);
      await expect(page.getByTestId("web-push-hint")).toHaveCount(0);
      await off.click();
      // Direkt zur Karte „Dieser Browser“, die erklärt, wie man es im Browser erlaubt.
      await expect(page).toHaveURL(/\/mein-bereich\/benachrichtigungen#dieser-browser$/);
      await expect(page.getByTestId("profile-browser-push")).toHaveAttribute("data-status", "denied");
      await expect(page.getByTestId("profile-browser-push")).toBeInViewport();
      if (SHOTS) {
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${SHOTS}/1208-hinweis-ziel-v2-${width}.png` });
      }
    });

    test("Team angemeldet: beim nächsten Öffnen der Übersicht die Frage mit „Dein Team ist angemeldet“ (#1208)", async ({ page }) => {
      // Ausgangsstand von früher: dieser Browser kannte für das Konto noch keine Anmeldung.
      const seen = await mockServer(page, { storage: { "tls-web-push-first-visit": "frueher", [`tls-web-push-seen:${ME.id}`]: JSON.stringify({ seen: [] }) } });
      seen.dashboard = { me: { tournaments: [{ ...TOURNAMENT, id: "t-team", title: "Team-Cup", my_registration: { id: "r-team", team_id: "team-1", status: "approved" } }], events: [], matches: [], staff_matches: [], actions: [] } };
      await page.goto("/dashboard");
      const hint = page.getByTestId("web-push-hint");
      await expect(hint).toBeVisible();
      await expect(page.getByTestId("web-push-hint-eyebrow")).toHaveText("Dein Team ist angemeldet");
      expect(await page.evaluate(() => window.__pushAsked)).toBe(0);
      expect(await noSidewaysScroll(page)).toBe(true);
      if (SHOTS) {
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${SHOTS}/1208-erklaerung-team-v2-${width}.png` });
      }
      await page.getByTestId("web-push-hint-later").click();
      await expect(hint).toHaveCount(0);
      // Neu laden: dieselbe Anmeldung ist kein neuer Anlass.
      const reloaded = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/mobile/dashboard");
      await page.reload();
      await reloaded;
      await expect(page.getByTestId("web-push-hint")).toHaveCount(0);
    });

    test("Einstellungen: Kanal Browser und „Dieser Browser“ anmelden", async ({ page }) => {
      const seen = await mockServer(page, { storage: { "tls-web-push-ask": "declined" } });
      await page.goto("/profile?tab=notifications");
      // Push je Thema gilt auch für den Browser (#1204); den Kanal „Browser“ ganz aus gibt es im Reiter „Mehr“ (#1662).
      await expect(page.getByTestId("notification-topic-match_reminders-push")).toBeVisible();
      await page.getByTestId("notification-section-mehr").click();
      await expect(page.getByTestId("profile-notification-channel-browser")).toBeVisible();
      await page.getByTestId("notification-section-themen").click();
      const card = page.getByTestId("profile-browser-push");
      await expect(card).toHaveAttribute("data-status", "available");
      await page.getByTestId("profile-browser-push-enable").click();
      await expect(card).toHaveAttribute("data-status", "subscribed");
      await expect.poll(() => seen.subscribed.length).toBe(1);
      // Inhalt verbergen: der Server bekommt es mit, der Schalter steht danach an.
      const hide = page.getByTestId("profile-browser-push-private");
      await expect(hide).toHaveAttribute("aria-checked", "false");
      await hide.click();
      await expect(hide).toHaveAttribute("aria-checked", "true");
      await expect.poll(() => seen.private).toBe(true);
      expect(await noSidewaysScroll(page)).toBe(true);
      if (SHOTS && width === 1440) {
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${SHOTS}/1163-einstellungen-1440.png` });
      }
    });
  });
}
