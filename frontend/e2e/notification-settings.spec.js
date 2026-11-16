const { test, expect } = require("@playwright/test");

// Einstellungen → Benachrichtigungen (#1204, #1206) bei 390 und 1440 px: oben drei Stufen, darunter je Thema Push, Nur App
// oder Aus, die Ruhezeit und eingeklappt „Weitere Wege“. Eine Stufe setzt alle Themen in einem Speichern; eine eigene
// Stellung zeigt „Eigene Auswahl“. Der Server ist nachgestellt (Stufen wie in backend/services/notification_preferences.py).
// Bilder:  NOTIFY_SHOTS=<ordner> npx playwright test e2e/notification-settings.spec.js --project=chromium --workers=1

const SHOTS = process.env.NOTIFY_SHOTS || "";
const TOPICS = ["match_reminders", "tournament_updates", "prize_updates", "achievements", "billing_updates",
  "membership_updates", "community_messages", "news_events", "club_internal", "helper_shifts"];
const modes = (pushed) => Object.fromEntries(TOPICS.map((topic) => [topic, pushed.includes(topic) ? "push" : "app"]));
const SETTINGS = {
  discord: { linked: false },
  topics: TOPICS,
  levels: [
    { key: "all", label: "Alles", description: "Jedes Thema per Push – nichts verpasst.", modes: modes(TOPICS) },
    { key: "important", label: "Wichtiges", description: "Spiele, Turniere, Rechnungen, Mitgliedschaft, Nachrichten an dich und Helferdienste per Push. Der Rest liegt in der Glocke.",
      modes: modes(["match_reminders", "tournament_updates", "billing_updates", "membership_updates", "community_messages", "helper_shifts"]) },
    { key: "few", label: "Wenig", description: "Nur Spiele und Aufrufe sowie Rechnungen per Push. Alles andere liegt in der Glocke.", modes: modes(["match_reminders", "billing_updates"]) },
  ],
  quiet_hours_exceptions: [
    "Aufruf zu deinem Spiel und „Match startet jetzt“",
    "Liga: Check-in offen und Veto – ihr seid am Zug, für dein eigenes Spiel",
    "Für die Turnierleitung: „Braucht Aufmerksamkeit“, solange dein Turnier läuft",
  ],
};

async function mockServer(page, { failFirst = false } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const seen = { fail: failFirst, patches: [], me: { id: "u-ruhe", username: "nachtloewe", display_name: "NachtLöwe", role: "player", email: "ruhe@lionsquad-test.at", notification_preferences: {}, newsletter_consent: false, updated_at: "2026-11-01T10:00:00.000000+00:00" } };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.startsWith("/changes")) return route.abort();
    if (path === "/auth/me") return json(seen.me);
    if (path === "/settings/public") return json({ club_name: "THE LION SQUAD" });
    if (path === "/users/me" && request.method() === "PATCH") {
      const body = request.postDataJSON();
      seen.patches.push(body);
      seen.me = { ...seen.me, ...body };
      return json(seen.me);
    }
    if (path === "/users/me" && request.method() === "GET") return json(seen.me);
    if (path === "/users/me/notification-preferences") {
      // Bis zum Klick auf „Erneut versuchen“ scheitert jeder Versuch (der API-Client fragt bei 503 selbst noch einmal).
      if (seen.fail) return json({ detail: "kurz weg" }, 503);
      return json(SETTINGS);
    }
    if (path === "/web-push/config") return json({ enabled: false });
    if (request.method() !== "GET") return json({ ok: true });
    if (path === "/me/platform-links") return json({ links: [], available: {}, platforms: {} });
    return json(["/home/about", "/chats/unread", "/seasonal/active"].includes(path) ? {} : []);
  });
  return seen;
}

const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test.describe(`${width} px`, () => {
    test.skip(({ isMobile }) => Boolean(isMobile), "die Breiten stehen hier ausdrücklich");
    test.use({ viewport: { width, height } });

    test("Stufe setzt alle Themen, eigene Stellung zeigt „Eigene Auswahl“", async ({ page }) => {
      const seen = await mockServer(page);
      await page.goto("/profile?tab=notifications");
      await expect(page.getByTestId("notification-level-custom")).toBeVisible();
      await page.getByTestId("notification-level-important").click();
      await expect(page.getByTestId("notification-level-important")).toHaveAttribute("aria-checked", "true");
      await expect(page.getByTestId("notification-level-custom")).toHaveCount(0);
      await expect(page.getByTestId("notification-topic-achievements")).toHaveAttribute("data-mode", "app");
      await expect(page.getByTestId("notification-topic-community_messages")).toHaveAttribute("data-mode", "push");
      await expect.poll(() => seen.patches.length).toBe(1);
      expect(seen.patches[0].notification_preferences["push:achievements"]).toBe(false);
      expect(seen.patches[0].notification_preferences["browser:community_messages"]).toBe(true);

      await page.getByTestId("notification-topic-achievements-off").click();
      await expect(page.getByTestId("notification-topic-achievements")).toHaveAttribute("data-mode", "off");
      await expect(page.getByTestId("notification-level-custom")).toBeVisible();
      await expect.poll(() => seen.patches.length).toBe(2);
      expect(await noSidewaysScroll(page)).toBe(true);
    });

    test("Ruhezeit 22:00 bis 7:00 einschalten, „Weitere Wege“ auf- und zuklappen", async ({ page }) => {
      const seen = await mockServer(page);
      await page.goto("/profile?tab=notifications");
      await page.getByTestId("notification-level-important").click();
      await expect.poll(() => seen.patches.length).toBe(1);
      await expect(page.getByTestId("notification-quiet-start")).toBeHidden();
      await page.getByTestId("notification-quiet-toggle").click();
      await expect(page.getByTestId("notification-quiet-start")).toBeVisible();
      await expect(page.getByTestId("notification-quiet-start")).toHaveValue("22:00");
      await expect(page.getByTestId("notification-quiet-end")).toHaveValue("07:00");
      await expect(page.getByTestId("notification-quiet-summary")).toContainText("über Mitternacht");
      await expect.poll(() => seen.patches.at(-1)?.quiet_hours).toEqual({ enabled: true, start: "22:00", end: "07:00" });

      const more = page.getByTestId("notification-more-ways");
      await expect(page.getByTestId("profile-notification-channel-email")).toBeHidden();
      await more.click();
      await expect(more).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByTestId("profile-notification-channel-email")).toBeVisible();
      await expect(page.getByTestId("profile-notification-email-achievement_recap")).toBeVisible();
      expect(await noSidewaysScroll(page)).toBe(true);
      await more.click();
      await expect(page.getByTestId("profile-notification-channel-email")).toBeHidden();
      if (SHOTS) {
        await page.waitForTimeout(450);
        await page.evaluate(() => document.activeElement?.blur());
        // Hoch genug für die ganze Seite: so liegen Kopfleiste und untere Leiste nicht über dem Bild.
        await page.setViewportSize({ width, height: 3400 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(300);
        await page.locator(".tls-notify").screenshot({ path: `${SHOTS}/einstellungen-${width}.png` });
      }
    });

    test("Laden scheitert: „Erneut versuchen“; geleertes Zeitfeld bleibt Entwurf", async ({ page }) => {
      const seen = await mockServer(page, { failFirst: true });
      await page.goto("/profile?tab=notifications");
      await expect(page.getByTestId("notification-load-failed")).toBeVisible();
      await page.getByTestId("notification-quiet-toggle").click();
      await expect.poll(() => seen.patches.length).toBe(1);
      await page.getByTestId("notification-quiet-start").fill("");
      await expect(page.getByTestId("notification-quiet-error")).toContainText("Uhrzeit wie 22:00");
      await page.waitForTimeout(1200);
      expect(seen.patches).toHaveLength(1);
      expect(await noSidewaysScroll(page)).toBe(true);
      if (SHOTS) {
        await page.evaluate(() => document.activeElement?.blur());
        await page.setViewportSize({ width, height: 3400 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(300);
        await page.locator(".tls-notify").screenshot({ path: `${SHOTS}/einstellungen-fehler-${width}.png` });
        await page.setViewportSize({ width, height });
      }
      seen.fail = false;
      await page.getByTestId("notification-load-retry").click();
      await expect(page.getByTestId("notification-level-all")).toBeVisible();
      await expect(page.getByTestId("notification-load-failed")).toHaveCount(0);
    });

    test("bei weniger Bewegung bleibt alles bedienbar", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const seen = await mockServer(page);
      await page.goto("/profile?tab=notifications");
      await page.getByTestId("notification-level-few").click();
      await expect(page.getByTestId("notification-topic-tournament_updates")).toHaveAttribute("data-mode", "app");
      const glide = await page.locator(".tls-level__glide").evaluate((node) => getComputedStyle(node).transitionProperty);
      expect(glide).not.toContain("transform");
      await expect.poll(() => seen.patches.length).toBe(1);
    });
  });
}
