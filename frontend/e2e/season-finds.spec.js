const { test, expect } = require("@playwright/test");

// Saison-Fundstücke im Profil (#678): die Karte steht im Reiter „Achievements“, die laufende Saison zuerst und über
// die ganze Breite, die anderen darunter; nichts ist abgeschnitten, nichts läuft über den Rand - am PC wie am Handy.
// Konto und API sind Attrappen im Browser.

const USER = { id: "u-anna", email: "anna@example.test", display_name: "Anna Beispiel", username: "anna", role: "user", seasonal_decorations: "on" };

function item(signal, icon, label, overrides = {}) {
  return { signal, icon, label, count: 0, season_count: 0, today: 0, per_day: 30, first_at: null, last_at: null, ...overrides };
}

const FINDS = {
  total: 1389,
  now: "2026-10-30T20:00:00+01:00",
  seasons: [
    { key: "halloween", label: "Halloween", active: true, count: 47, next_start: null, ends_at: "2026-11-01T23:59:59+01:00", items: [
      item("halloween_bats_scared", "bat", "Fledermäuse verscheucht", { count: 38, season_count: 38, today: 12 }),
      item("halloween_ghosts_freed", "ghost", "Geister befreit", { count: 6, season_count: 6, today: 20, per_day: 20 }),
      item("halloween_cat_petted", "cat", "Katze angestupst", { count: 3, season_count: 3, today: 1, per_day: 10 }),
      item("halloween_pumpkin", "pumpkin", "Gruselnächte erlebt", { per_day: 1 }),
    ] },
    { key: "snow", label: "Winter", active: false, count: 1342, next_start: "2026-11-29T00:00:00+01:00", ends_at: null, items: [item("snowflakes_clicked", "snowflake", "Schneeflocken gefangen", { count: 1342, season_count: 60, per_day: 200 })] },
    { key: "advent_calendar", label: "Adventkalender", active: false, count: 0, next_start: "2026-12-01T00:00:00+01:00", ends_at: null, items: [item("advent_door", "door", "Türchen geöffnet", { per_day: 24 })] },
    { key: "new_year", label: "Silvester", active: false, count: 0, next_start: "2026-12-29T18:00:00+01:00", ends_at: null, items: [item("online_at_new_year", "rocket", "Silvester um Mitternacht dabei", { per_day: 1 })] },
    { key: "easter_hunt", label: "Ostern", active: false, count: 0, next_start: "2027-03-26T00:00:00+01:00", ends_at: null, items: [item("easter_egg", "egg", "Ostereier gefunden", { per_day: 50 })] },
  ],
};

async function mockProfile(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", async (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 405, contentType: "application/json", body: "{}" });
    const pathname = new URL(route.request().url()).pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname.endsWith("/api/auth/me")) return json(USER);
    if (pathname.endsWith("/achievements/collectibles")) return json(FINDS);
    if (pathname.endsWith("/achievements/me")) return json({ groups: [], pinned: [], pinned_codes: [], awards: [], next_up: [], level: { level: 4, title: "Rudelmitglied", xp: 320, next_xp: 500, prestige: 0 } });
    if (pathname.includes("/seasonal/active")) return json({ now: "2026-06-01T12:00:00+02:00", enabled: false, preview: false, weather: null, seasons: [] });
    if (pathname.includes("/changes/stream")) return route.abort();
    const list = ["/notifications", "/games", "/teams", "/platform-links", "/sponsors", "/partners", "/site-banners", "/nav"].some((part) => pathname.includes(part));
    return json(list ? [] : {});
  });
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`Karte im Profil auf ${viewport.width} px: laufende Saison zuerst, nichts abgeschnitten, kein Überlauf`, async ({ page, isMobile }, testInfo) => {
    test.skip(Boolean(isMobile) !== viewport.width < 640, "je Projekt seine Breite");
    await mockProfile(page);
    await page.setViewportSize(viewport);
    await page.goto("/profile?tab=achievements");
    const panel = page.getByTestId("season-finds");
    await expect(panel).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("season-finds-total")).toHaveText("1.389");
    await expect(page.getByTestId("season-finds-halloween-hint")).toHaveText(/läuft bis 01\.11\./i);
    await expect(page.getByTestId("season-find-halloween_bats_scared-today")).toHaveText("heute 12 von 30");
    await expect(page.getByTestId("season-find-snowflakes_clicked")).toContainText("1.342");
    const facts = await panel.evaluate((node) => {
      const box = (el) => el.getBoundingClientRect();
      const sections = [...node.querySelectorAll("section")];
      const running = node.querySelector("[data-testid='season-finds-halloween']");
      const clipped = [...node.querySelectorAll("section header span, .tls-find span")].filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible").map((el) => el.textContent.trim().slice(0, 40));
      const outside = [...node.querySelectorAll("section, .tls-find, .tls-find__figure")].filter((el) => box(el).right > box(node).right + 1 || box(el).left < box(node).left - 1).length;
      const figures = [...node.querySelectorAll(".tls-find__figure")].map((el) => Math.round(box(el).width));
      return {
        order: sections.map((section) => section.getAttribute("data-testid")),
        runningWidth: box(running).width / box(node).width,
        clipped,
        outside,
        figures,
        overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth,
      };
    });
    expect(facts.order[0]).toBe("season-finds-halloween");
    expect(facts.order).toHaveLength(5);
    expect(facts.runningWidth, "die laufende Saison nimmt die ganze Breite").toBeGreaterThan(0.85);
    expect(facts.clipped, "nichts ist abgeschnitten").toEqual([]);
    expect(facts.outside).toBe(0);
    expect(facts.figures).toHaveLength(8);
    expect(new Set(facts.figures)).toEqual(new Set([48]));
    expect(facts.overflow).toBeLessThanOrEqual(2);
    await panel.scrollIntoViewIfNeeded();
    await testInfo.attach(`saison-fundstuecke-${viewport.width}.png`, { body: await panel.screenshot(), contentType: "image/png" });
  });
}
