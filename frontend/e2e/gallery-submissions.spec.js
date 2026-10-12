const { test, expect } = require("@playwright/test");

// Fotos vom Event (#1185, #1186): Ein Mitglied schickt im Album Fotos ein (am Handy mit Kamera-Knopf), der Vorstand gibt
// sie in Admin → Galerie frei. Bei 390 und 1440 px, ohne waagrechte Scrollleiste.

const WIDTHS = [["handy", 390, 844], ["pc", 1440, 900]];
const MEMBER = { id: "u-anna", username: "anna", display_name: "Anna", role: "player", is_club_member: true };
const BOARD = { id: "u-board", username: "vera", display_name: "Vera Vorstand", role: "player", areas: ["club"], mfa_enabled: true, auth_mfa_verified: true, is_club_member: true };
const ALBUM = {
  id: "a1", slug: "herbst-lan-fotos", title: "Herbst-LAN Fotos", published: true, visibility: "public", sections: [],
  event: { id: "e1", slug: "herbst-lan", name: "Herbst-LAN" },
  photos: [{ id: "p1", media_type: "image", image_url: "/api/static/uploads/foto-1.webp", order_index: 1, width: 1200, height: 800, credit: "Anna" }],
  photo_submission: { open: true, opens: "2026-10-10", until: "2026-10-18", max: 20, used: 0, pending: 0, remaining: 20, can_submit: true },
};
const QUEUE = [
  { id: "s1", album_id: "a1", album_title: "Herbst-LAN Fotos", event_name: "Herbst-LAN", owner_name: "Anna", credit: true, scan_state: "safe", image_url: "/api/gallery/submissions/s1/image", created_at: "2026-10-12T10:00:00Z" },
  { id: "s2", album_id: "a1", album_title: "Herbst-LAN Fotos", event_name: "Herbst-LAN", owner_name: "Bert", credit: false, scan_state: "safe", image_url: "/api/gallery/submissions/s2/image", created_at: "2026-10-12T10:05:00Z" },
];
const TINY_WEBP = Buffer.from("UklGRjIAAABXRUJQVlA4ICYAAACyAgCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA/vuUAAAAAA==", "base64");

async function mockApi(page, me, calls) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.startsWith("/api/static/uploads/") || url.pathname.endsWith("/image")) return route.fulfill({ contentType: "image/webp", body: TINY_WEBP });
    if (request.method() !== "GET") {
      const type = request.headers()["content-type"] || "";
      calls.push({ method: request.method(), path: url.pathname, body: type.includes("json") ? request.postDataJSON() : null });
      return json({ ok: true, id: "s9", status: "pending" });
    }
    if (url.pathname === "/api/auth/me") return json(me);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (url.pathname === "/api/gallery/herbst-lan-fotos") return json(ALBUM);
    if (url.pathname === "/api/admin/gallery-submissions") return json(QUEUE);
    const list = /notifications|games$|nav$|site-banners|sponsors|partners/.test(url.pathname);
    return json(list ? [] : {});
  });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
      await page.setViewportSize({ width, height });
    });

    test("Mitglied schickt Fotos ein - nur mit Haken", async ({ page }) => {
      const calls = [];
      await mockApi(page, MEMBER, calls);
      await page.goto("/galerie/herbst-lan-fotos");
      await expect(page.getByTestId("album-event-link")).toHaveAttribute("href", "/events/herbst-lan");
      await page.getByTestId("photo-submit-open").click();
      // Die Kamera gibt es am Handy, am PC nur die Dateiauswahl.
      await expect(page.getByTestId("photo-submit-camera")).toBeVisible({ visible: width < 768 });
      await page.getByTestId("photo-submit-input").setInputFiles([{ name: "lan.webp", mimeType: "image/webp", buffer: TINY_WEBP }]);
      await expect(page.getByTestId("photo-submit-send")).toBeDisabled();
      await page.getByTestId("photo-submit-consent").check();
      await page.getByTestId("photo-submit-send").click();
      await expect(page.getByTestId("photo-submit-done")).toContainText("Dein Foto wartet auf Freigabe durch den Vorstand.");
      expect(calls.map((call) => call.path)).toEqual(["/api/gallery/herbst-lan-fotos/submissions"]);
      await noSideScroll(page);
    });

    test("Vorstand gibt in Admin → Galerie frei", async ({ page }) => {
      const calls = [];
      await mockApi(page, BOARD, calls);
      await page.goto("/admin/gallery");
      await expect(page.getByTestId("gallery-submissions")).toContainText("2 warten auf Freigabe");
      await expect(page.getByTestId("album-new")).toHaveCount(0);
      await page.getByTestId("submission-approve-all-a1").click();
      await expect.poll(() => calls.find((call) => call.path === "/api/admin/gallery-submissions/decide")?.body).toEqual({ ids: ["s1", "s2"], action: "approve", reason: null });
      await noSideScroll(page);
    });
  });
}
