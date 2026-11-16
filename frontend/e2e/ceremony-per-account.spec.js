const { test, expect } = require("@playwright/test");

// Zeremonie einmal je Konto (#2450): dasselbe Konto in zwei Browsern (zwei Kontexte - wie PC und Handy). Beide zeigen
// den neuen Erfolg; im ersten geschlossen, geht „gesehen“ an den Server - der zweite zeigt nach dem Neuladen keine
// Zeremonie mehr. Der Server ist eine Attrappe im Test, die beide Kontexte teilen.

const USER = { id: "u-anna", email: "anna@example.test", display_name: "Anna", username: "anna", role: "user", ceremony_mode: "full" };
const LEVEL = { level: 3, title: "Rudelmitglied", prestige: 0 };

function achievements(earnedAt) {
  const tier = {
    code: "bat_whisperer_1", group_code: "bat_whisperer", name: "Fledermausflüsterer I", description: "5 Fledermäuse verscheucht.", material: "bronze", material_name: "Bronze",
    level_name: "Bronze", icon: "moon", art: "night-shift", points: 10, xp: 25, progress_target: 5, progress_current: 5, earned: true, earned_at: earnedAt,
  };
  return { groups: [{ code: "bat_whisperer", name: "Fledermausflüsterer", category: "community", icon: "moon", art: "night-shift", tiers: [tier] }], pinned: [], pinned_codes: [], awards: [], level: { ...LEVEL, xp: 120, next_xp: 200 } };
}

function fakeServer() {
  return { unseen: new Set(["bat_whisperer_1"]), seen: [], imports: [], earnedAt: new Date(Date.now() - 60_000).toISOString() };
}

function stateBody(server) {
  return { since: "2026-11-16T08:00:00+00:00", unseen: [...server.unseen], level: LEVEL, recount_seen: [] };
}

async function device(browser, server, viewport) {
  const context = await browser.newContext({ viewport, ...(viewport.width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await context.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
    // Beide Browser waren schon einmal da (Merker von gestern) - bisher hätte darum jeder den Erfolg selbst gefeiert.
    if (!window.localStorage.getItem("tls_ach_seen:u-anna")) window.localStorage.setItem("tls_ach_seen:u-anna", new Date(Date.now() - 86_400_000).toISOString());
  });
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await context.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return json(route, USER);
    if (path === "/api/achievements/me") return json(route, achievements(server.earnedAt));
    if (path === "/api/users/me/level") return json(route, LEVEL);
    if (path === "/api/achievements/me/ceremony") return json(route, stateBody(server));
    if (path === "/api/achievements/me/ceremony/import") {
      server.imports.push(request.postDataJSON());
      return json(route, stateBody(server));
    }
    if (path === "/api/achievements/me/ceremony/seen") {
      const body = request.postDataJSON();
      server.seen.push(body);
      (body.codes || []).forEach((code) => server.unseen.delete(code));
      return json(route, { ok: true, seen: (body.codes || []).length });
    }
    if (request.method() !== "GET") return json(route, {}, 405);
    const list = path.includes("/notifications") || path.endsWith("/games") || path.includes("/achievements/groups") || path.includes("stream");
    return json(route, list ? [] : {});
  });
  const page = await context.newPage();
  return { context, page };
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`im ersten Browser geschlossen, im zweiten nach dem Neuladen keine Zeremonie mehr (${viewport.width} px)`, async ({ browser, isMobile }, testInfo) => {
    test.skip(Boolean(isMobile), "die Breiten stellt der Test selbst ein");
    const server = fakeServer();
    const first = await device(browser, server, viewport);
    const second = await device(browser, server, viewport);
    try {
      // Beide Geräte öffnen die Seite: der neue Erfolg ist am Konto noch nicht gesehen - beide zeigen ihn.
      await first.page.goto("/");
      await second.page.goto("/");
      const firstOverlay = first.page.getByTestId("achievement-unlock-overlay");
      const secondOverlay = second.page.getByTestId("achievement-unlock-overlay");
      await expect(firstOverlay).toBeVisible({ timeout: 20_000 });
      await expect(firstOverlay).toContainText("Fledermausflüsterer");
      await expect(secondOverlay).toBeVisible({ timeout: 20_000 });
      await testInfo.attach(`zeremonie-${viewport.width}.png`, { body: await first.page.screenshot(), contentType: "image/png" });

      // Im ersten schließen - am Handy per Tipp daneben, am PC mit dem X.
      if (viewport.width < 500) await firstOverlay.click({ position: { x: 8, y: 8 } });
      else await first.page.getByTestId("achievement-unlock-close").click();
      await expect(firstOverlay).toHaveCount(0, { timeout: 15_000 });
      await expect.poll(() => server.seen.flatMap((row) => row.codes || []), { timeout: 10_000 }).toContain("bat_whisperer_1");

      // Der zweite lädt neu: keine Zeremonie mehr.
      await second.page.reload();
      await second.page.waitForLoadState("networkidle");
      await expect.poll(() => server.imports.length + 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
      await second.page.waitForTimeout(1500);
      await expect(secondOverlay).toHaveCount(0);
      // Und auch der erste bekommt sie nach dem Neuladen nicht wieder.
      await first.page.reload();
      await first.page.waitForLoadState("networkidle");
      await first.page.waitForTimeout(1500);
      await expect(firstOverlay).toHaveCount(0);
      expect(server.imports.every((body) => typeof body === "object"), "Altbestand je Browser einmal gemeldet").toBe(true);
      expect(server.imports).toHaveLength(2);
    } finally {
      await first.context.close();
      await second.context.close();
    }
  });
}
