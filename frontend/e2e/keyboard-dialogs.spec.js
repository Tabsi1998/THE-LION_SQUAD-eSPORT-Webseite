const { test, expect } = require("@playwright/test");

// Tastatur und Dialoge (#937): Suche, Galerie-Ansicht und Abstimmungs-Popup lassen sich bei 390 und 1440 px ohne Maus
// bedienen - Fokus hinein, Tab bleibt drin, Escape schließt und gibt den Fokus zurück - und axe findet im offenen
// Dialog nichts Schweres. Das Logo-Laufband hat je Logo genau einen Tab-Stopp. Der Server ist nachgestellt, alle Namen
// sind erfunden. Das Menü oben prüft nav-header.spec.js (#1233).

const ME = { id: "u1", username: "neonfalke", display_name: "NeonFalke", role: "player", email: "neonfalke@example.invalid", is_club_member: true, areas: [] };
const ALBUM = {
  id: "a1", slug: "herbst-lan", title: "Herbst-LAN", description: "", published: true, visibility: "public", sections: [],
  photos: [
    { id: "p1", media_type: "image", source_type: "upload", image_url: "/api/static/uploads/foto-1.webp", thumbnail_url: "/api/static/uploads/foto-1.webp", caption: "Siegerehrung", order_index: 1, width: 1600, height: 1000 },
    { id: "p2", media_type: "image", source_type: "upload", image_url: "/api/static/uploads/foto-2.webp", thumbnail_url: "/api/static/uploads/foto-2.webp", caption: "Finale", order_index: 2, width: 1600, height: 1000 },
  ],
};
const BALLOT = {
  id: 7, meeting: "Generalversammlung 2026", item: 3, kind_label: "Beschluss", question: "Entlastung des Vorstands", secret: false, can_vote: true,
  options: [{ code: "yes", label: "Ja" }, { code: "no", label: "Nein" }, { code: "abstain", label: "Enthaltung" }],
  rights: [{ right_id: 1012, for: "self", name: "", state: "open", can_use: true }],
};
const PARTNERS = ["Kiwi Kabel", "Neon Netz", "Donner Drinks"].map((name, index) => ({
  id: `pa${index + 1}`, slug: `partner-${index + 1}`, name, logo_url: `/api/static/uploads/logo-${index + 1}.webp`, website: "", active: true, show_in_footer: true,
}));
// Ein winziges gültiges WebP, damit Kacheln und Logos echte Bilder laden.
const TINY_WEBP = Buffer.from("UklGRjIAAABXRUJQVlA4ICYAAACyAgCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA/vuUAAAAAA==", "base64");

async function mockServer(page, { user = null } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.startsWith("/static/uploads/")) return route.fulfill({ contentType: "image/webp", body: TINY_WEBP });
    if (path === "/auth/me") return user ? json(user) : json({ detail: "Nicht angemeldet" }, 401);
    if (path === "/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.example" });
    if (path === "/home/state") return json({ has_live: false, live: {}, today: {}, soon: {}, upcoming: {}, stats: {}, featured_news: [], news: [] });
    if (path === "/gallery/herbst-lan") return json(ALBUM);
    if (path === "/membership/me/ballots/open") return json({ available: true, ballots: [BALLOT], live: true, poll_seconds: 0 });
    if (path === "/partners") return json(PARTNERS);
    if (path === "/search") return json({ items: [{ kind: "team", title: "Lions Rocket", url: "/teams/lions-rocket" }] });
    if (path === "/notifications/unread-count") return json({ count: 0 });
    return json([]);
  });
}

async function seriousViolations(page, selector) {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return page.evaluate(async (scope) => {
    const result = await window.axe.run(document.querySelector(scope), {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      rules: { "color-contrast": { enabled: false } },
    });
    return result.violations
      .filter((violation) => ["serious", "critical"].includes(violation.impact))
      .map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
  }, selector);
}

/** Ein paar Mal Tab - der Fokus bleibt im Dialog. */
async function expectTabStaysIn(page, dialog, presses = 8) {
  for (let i = 0; i < presses; i += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
}

test.describe("Tastatur und Dialoge (#937)", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breiten werden hier selbst gesetzt");

  for (const width of [390, 1440]) {
    test(`Suche bei ${width} px: Enter öffnet, Fokus im Suchfeld, Tab bleibt drin, Escape gibt den Fokus an die Lupe`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockServer(page);
      await page.goto("/");
      const opener = page.getByTestId("global-search-open").filter({ visible: true }).first();
      await opener.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Website durchsuchen" });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Suchbegriff" })).toBeFocused();
      await page.keyboard.type("lions");
      await expect(page.getByText("Lions Rocket")).toBeVisible();
      await expectTabStaysIn(page, dialog);
      expect(await seriousViolations(page, "[role='dialog']"), `axe bei ${width} px`).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
    });

    test(`Galerie bei ${width} px: Enter auf der Kachel öffnet die Ansicht, Escape gibt den Fokus an die Kachel`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockServer(page);
      await page.goto("/galerie/herbst-lan");
      const tile = page.getByTestId("gallery-photo-1");
      await tile.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Finale" });
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId("gallery-lightbox-close")).toBeFocused();
      await expectTabStaysIn(page, dialog, 5);
      expect(await seriousViolations(page, "[data-testid='gallery-lightbox']"), `axe bei ${width} px`).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("gallery-lightbox")).toHaveCount(0);
      await expect(tile).toBeFocused();
    });

    test(`Abstimmung bei ${width} px: Fokus im Popup, Leertaste wählt, Escape heißt „Später“`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockServer(page, { user: ME });
      await page.goto("/");
      const dialog = page.getByRole("dialog", { name: "Entlastung des Vorstands" });
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
      await expectTabStaysIn(page, dialog, 6);
      const yes = page.getByTestId("ballot-option-1012-yes");
      await yes.focus();
      await page.keyboard.press("Space");
      await expect(yes).toHaveAttribute("aria-pressed", "true");
      expect(await seriousViolations(page, "[data-testid='ballot-popup']"), `axe bei ${width} px`).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("ballot-popup")).toHaveCount(0);
      await expect(page.getByTestId("ballot-band")).toBeVisible();
    });
  }

  test("Logo-Laufband: drei Partner sind drei Tab-Stopps, die Wiederholungen sind Deko", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page);
    await page.goto("/");
    const band = page.getByTestId("partner-ticker").locator("[data-marquee]");
    await expect(band).toHaveAttribute("data-marquee", "1");
    const reachable = await band.locator("a").evaluateAll((links) => links
      .filter((link) => link.getAttribute("tabindex") !== "-1" && !link.closest("[aria-hidden='true']"))
      .map((link) => link.title));
    expect(reachable).toEqual(["Kiwi Kabel", "Neon Netz", "Donner Drinks"]);
    expect(await seriousViolations(page, "[data-testid='partner-ticker']")).toEqual([]);
  });
});
