const { test, expect } = require("@playwright/test");

// Vor-Ort-Ansicht mit Hinweisen der Turnierleitung (#2546): Wer den QR-Code vor Ort gescannt hat, sieht die schlanke
// Turnierseite - und darüber den stehenden Hinweis („Start verschiebt sich“). Bei 390 und 1440 px, auch mit „Bewegung
// reduzieren“: kein seitliches Scrollen, das Banner über dem Titel, der Knopf „Mitspielen“ erreichbar, kein Fehler-Abruf.
// Die API ist nachgestellt, Namen sind erfunden. SHOT_DIR=<Ordner> legt die Bilder dort ab.

const SHOTS = process.env.SHOT_DIR || "";
const NOW = "2026-11-14T13:07:00.000Z"; // 14:07 in Wien
const SLIM = {
  id: "t1", slug: "herbst-cup", title: "Herbst-Cup im Vereinsheim", status: "registration_open", registration_enabled: true,
  participant_count: 9, max_participants: 16, team_mode: "solo", event_mode: "local", start_date: "2026-11-14T15:00:00+00:00",
  location: "Vereinsheim, Halle B", public_phase: { state: "registration_open", label: "Anmeldung" }, onsite_view: true,
  game: { id: "g1", slug: "mk", name: "Mario Kart 8", display_name: "Mario Kart 8", player_id_fields: [] },
};
const NOTICES = [
  { id: "n1", text: "Start verschiebt sich um 30 Minuten – wir beginnen um 16:30.", created_at: "2026-11-14T13:02:00.000Z",
    expires_at: "2026-11-14T15:02:00.000Z", target: "tournament", tv: false },
];

async function mockApi(page, calls) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    calls.push(url.pathname);
    if (url.pathname === "/api/auth/me") return json({ detail: "nicht angemeldet" }, 401);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (url.pathname === "/api/tournaments/herbst-cup") return json(SLIM);
    if (url.pathname === "/api/tournaments/t1/notices") return json({ items: NOTICES });
    const list = /notifications|games$|nav$|site-banners|sponsors|partners|tournaments|challenges|events/.test(url.pathname);
    return json(list ? [] : {});
  });
}

for (const [label, width, height] of [["handy", 390, 844], ["pc", 1440, 900]]) {
  for (const reduced of [false, true]) {
    test(`${label} (${width} px)${reduced ? " mit reduzierter Bewegung" : ""}: Hinweis über dem Titel der Vor-Ort-Ansicht`, async ({ page, isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
      await page.clock.install({ time: new Date(NOW) });
      await page.setViewportSize({ width, height });
      if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/tournaments/herbst-cup");
      const view = page.getByTestId("onsite-tournament-view");
      await expect(view).toBeVisible();
      const banner = view.getByTestId("notice-banner");
      await expect(banner).toContainText("Hinweis der Turnierleitung");
      await expect(banner).toContainText("Start verschiebt sich um 30 Minuten");
      await expect(banner).toContainText("14:02 Uhr");
      // Über dem Titel, ganz im Bild, „Mitspielen“ bleibt erreichbar.
      const [bannerBox, titleBox] = [await banner.boundingBox(), await page.getByTestId("tournament-title").boundingBox()];
      expect(bannerBox.y + bannerBox.height).toBeLessThanOrEqual(titleBox.y + 1);
      expect(bannerBox.x).toBeGreaterThanOrEqual(0);
      expect(bannerBox.x + bannerBox.width).toBeLessThanOrEqual(width + 1);
      await expect(page.getByTestId("onsite-register-btn")).toBeVisible();
      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(2);
      expect(calls).toContain("/api/tournaments/t1/notices");
      if (reduced) {
        const running = await page.evaluate(() => document.getAnimations().filter((item) => item.playState === "running"
          && item instanceof window.CSSAnimation && item.effect?.target?.closest?.(".tls-notice")).length);
        expect(running).toBe(0);
      }
      if (SHOTS && !reduced) {
        await page.waitForFunction(() => [...document.querySelectorAll(".tls-notice")].flatMap((node) => node.getAnimations({ subtree: true }))
          .every((item) => !(item instanceof window.CSSAnimation) || item.playState !== "running"), null, { polling: 100 });
        await page.screenshot({ path: `${SHOTS}/vor-ort-hinweis-${width}.png` });
      }
    });
  }
}
