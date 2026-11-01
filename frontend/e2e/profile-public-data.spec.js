const { test, expect } = require("@playwright/test");

// Profil und öffentliche Daten (#2126) bei 390 und 1440 px: Benutzername-Regel beim Registrieren, Weg zu den
// Einstellungen, ältere Namen mit Sonderzeichen, Längen in den Grunddaten. API nachgestellt, Daten erfunden.

const ME = {
  id: "u-neon", username: "neonfalke", display_name: "NeonFalke", role: "player", email: "neon@lionsquad-test.at", bio: "Kurz", privacy_public_profile: true,
  updated_at: "2026-10-01T10:00:00.000000+00:00",
};
const OLD_NAME_PROFILE = {
  id: "u-alt", username: "alte schule", display_name: "Alte Schule", privacy_public_profile: true, preferred_role: "IGL", input_devices: ["controller"],
  stats: {}, teams: [], awards: [], badges: [], tournaments: [], f1_bests: [], references: { items: [] }, created_at: "2024-02-01T10:00:00+00:00",
};

async function mockServer(page, { user = null, profile = OLD_NAME_PROFILE } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const seen = { paths: [], registered: 0, user };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    seen.paths.push(path);
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.startsWith("/changes")) return route.abort();
    if (path === "/auth/me") return seen.user ? json(seen.user) : json({ detail: "Bitte melde dich an." }, 401);
    if (path === "/auth/register") {
      seen.registered += 1;
      return json({ verification_required: true, email: "neu@lionsquad-test.at" });
    }
    if (path === "/settings/public") return json({ club_name: "THE LION SQUAD", registration_enabled: true, password_login_enabled: true });
    if (path === "/users/public/alte%20schule") return json(profile);
    if (path === "/users/me" && request.method() === "PATCH") {
      const body = request.postDataJSON() || {};
      seen.user = { ...seen.user, ...body, ...(typeof body.bio === "string" ? { bio: body.bio.trim() } : {}), updated_at: new Date().toISOString() };
      return json(seen.user);
    }
    if (request.method() !== "GET") return json(user || { ok: true });
    if (path === "/me/platform-links") return json({ links: [], available: {}, platforms: {} });
    if (path === "/users/me/notification-preferences") return json({});
    return json(["/home/about", "/chats/unread", "/seasonal/active"].includes(path) ? {} : []);
  });
  return seen;
}

const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test.describe(`${width} px`, () => {
    test.skip(({ isMobile }) => Boolean(isMobile), "die Breiten stehen hier ausdrücklich");
    test.use({ viewport: { width, height } });

    test("Registrieren: die Regel steht am Feld, ein ungültiger Name geht nicht an den Server", async ({ page }) => {
      const seen = await mockServer(page);
      await page.goto("/register");
      await expect(page.getByTestId("register-username-hint")).toContainText("3 bis 32 Zeichen");
      await page.getByTestId("register-username").fill("neon falke");
      await page.getByTestId("register-email").fill("neu@lionsquad-test.at");
      await page.getByTestId("register-password").fill("Lange-Passphrase-42");
      await page.getByTestId("register-accept").click();
      await page.getByTestId("register-accept-terms").click();
      await page.getByTestId("register-submit").click();
      await expect(page.locator("#register-username-error")).toContainText("Benutzername: 3 bis 32 Zeichen");
      await expect(page.getByTestId("register-username")).toBeFocused();
      expect(seen.registered).toBe(0);
      expect(await noSidewaysScroll(page)).toBe(true);
    });

    test("Benachrichtigungen: ein Klick führt zu den Einstellungen", async ({ page }) => {
      await mockServer(page, { user: ME });
      await page.goto("/notifications");
      await page.getByTestId("notifications-settings-link").click();
      await expect(page).toHaveURL(/\/profile\?tab=notifications$/);
      expect(await noSidewaysScroll(page)).toBe(true);
    });

    test("älterer Name mit Leerzeichen: das Profil öffnet, ohne Systemrolle, mit bevorzugter Rolle", async ({ page }) => {
      const seen = await mockServer(page);
      await page.goto("/u/alte%20schule");
      await expect(page.getByTestId("profile-identity")).toContainText("@alte schule");
      await expect(page.getByTestId("public-profile-setup")).toContainText("IGL");
      await expect(page.getByTestId("profile-identity")).not.toContainText(/Admin|Moderator/);
      expect(seen.paths).toContain("/users/public/alte%20schule");
      expect(await noSidewaysScroll(page)).toBe(true);
    });

    test("als Gast: Nachricht schreiben führt zum Login und zurück zum richtigen Profil", async ({ page }) => {
      await mockServer(page);
      await page.goto("/u/alte%20schule");
      await page.getByTestId("profile-actions").getByRole("button").first().click();
      await expect(page).toHaveURL(/\/login\?next=%2Fu%2Falte%2520schule$/);
    });

    test("eine lange alte Rolle ohne Leerzeichen bleibt im Kasten", async ({ page }) => {
      await mockServer(page, { profile: { ...OLD_NAME_PROFILE, preferred_role: "x".repeat(120) } });
      await page.goto("/u/alte%20schule");
      await expect(page.getByTestId("public-profile-setup")).toContainText("xxxx");
      expect(await noSidewaysScroll(page)).toBe(true);
    });

    test("Gaming: die bevorzugte Rolle hat im Formular dieselbe Grenze wie im Server", async ({ page }) => {
      await mockServer(page, { user: ME });
      await page.goto("/profile?tab=gaming");
      await expect(page.getByTestId("profile-preferred-role")).toHaveAttribute("maxlength", "40");
    });

    test("Grunddaten: zu lange Bio hat den Hinweis am Feld und bleibt stehen", async ({ page }) => {
      await mockServer(page, { user: ME });
      await page.goto("/profile?tab=basic");
      const bio = page.getByTestId("profile-bio");
      await expect(bio).toHaveValue("Kurz");
      await expect(page.getByTestId("profile-bio-count")).toHaveText("4 / 1000");
      await bio.fill("x".repeat(1001));
      await expect(page.getByTestId("profile-bio-error")).toHaveText("Höchstens 1000 Zeichen.");
      await expect(page.getByTestId("profile-autosave-status").first()).toHaveAttribute("data-status", "invalid");
      expect(await noSidewaysScroll(page)).toBe(true);
    });

    test("Grunddaten: das Leerzeichen zwischen zwei Wörtern übersteht das Speichern von selbst", async ({ page }) => {
      await mockServer(page, { user: ME });
      await page.goto("/profile?tab=basic");
      const bio = page.getByTestId("profile-bio");
      await expect(bio).toHaveValue("Kurz");
      await bio.fill("Hallo ");
      await expect(page.getByTestId("profile-autosave-status").first()).toContainText("Gespeichert", { timeout: 5000 });
      await expect(bio).toHaveValue("Hallo ");
      await bio.press("End");
      await bio.pressSequentially("Welt");
      await expect(bio).toHaveValue("Hallo Welt");
    });

    test("Privatsphäre: Direktnachrichten sagen, wer trotzdem schreiben kann; Website und Abos haben eine Stufe", async ({ page }) => {
      await mockServer(page, { user: ME });
      await page.goto("/profile?tab=privacy");
      await expect(page.getByText("Die Moderation erreicht dich immer")).toBeVisible();
      await expect(page.getByTestId("profile-dm-privacy").locator("option", { hasText: "Niemand außer der Moderation" })).toHaveCount(1);
      await expect(page.getByTestId("profile-vis-email")).toHaveCount(0);
      await expect(page.getByTestId("profile-vis-website")).toHaveCount(1);
      await expect(page.getByTestId("profile-vis-gaming_subscriptions")).toHaveCount(1);
      await expect(page.getByTestId("profile-vis-preferred_role")).toHaveCount(1);
      expect(await noSidewaysScroll(page)).toBe(true);
    });
  });
}
