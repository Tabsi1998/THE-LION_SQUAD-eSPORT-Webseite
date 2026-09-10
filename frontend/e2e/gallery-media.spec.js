const { test, expect } = require("@playwright/test");

// Im Album spielte jede Videokachel, die ins Bild scrollte, von selbst los:
// ein IntersectionObserver rief play() auf jedem sichtbaren Video. Bei acht
// Videos lädt und dekodiert ein Telefon mehrere Ströme gleichzeitig. Jetzt
// steht dort ein Standbild, und abgespielt wird erst auf Wunsch.

const ALBUM = {
  id: "a1",
  slug: "gamers-heaven-2026",
  title: "Gamers Heaven 2026",
  description: "Bilder und Videos vom Turniertag",
  published: true,
  visibility: "public",
  sections: [],
  photos: [
    {
      id: "p1", media_type: "image", source_type: "upload",
      image_url: "/api/static/uploads/foto-1.webp",
      thumbnail_url: "/api/static/uploads/foto-1.webp",
      caption: "Siegerehrung", order_index: 1, width: 3200, height: 2000,
    },
    {
      id: "v1", media_type: "video", source_type: "upload",
      video_url: "/api/static/uploads/clip-1.mp4",
      thumbnail_url: "/api/static/uploads/clip-1-vorschau.webp",
      caption: "Finale", order_index: 2,
    },
    {
      id: "v2", media_type: "video", source_type: "upload",
      video_url: "/api/static/uploads/clip-2.mp4",
      thumbnail_url: "",
      caption: "Ohne Vorschaubild", order_index: 3,
    },
  ],
};

// Ein winziges gültiges WebP, damit die Kacheln echte Bilder laden.
const TINY_WEBP = Buffer.from(
  "UklGRjIAAABXRUJQVlA4ICYAAACyAgCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA/vuUAAAAAA==",
  "base64",
);

async function mockAlbum(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: true, analytics: false, meta: false,
      tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 8.64e8,
    }));
  });
  const json = (body) => ({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/settings/public", (r) => r.fulfill(json({ club_name: "THE LION SQUAD" })));
  await page.route("**/api/sponsors**", (r) => r.fulfill(json([])));
  await page.route("**/api/auth/me", (r) => r.fulfill(json(null)));
  await page.route("**/api/gallery/gamers-heaven-2026", (r) => r.fulfill(json(ALBUM)));
  await page.route("**/api/static/uploads/**", (r) => r.fulfill({
    contentType: "image/webp", body: TINY_WEBP,
  }));
}

test.describe("Galerie-Album", () => {
  test.beforeEach(async ({ page }) => {
    await mockAlbum(page);
  });

  test("keine Videokachel spielt beim Scrollen von selbst", async ({ page }) => {
    await page.goto("/galerie/gamers-heaven-2026");
    await expect(page.getByRole("heading", { name: "Gamers Heaven 2026" })).toBeVisible();

    // Das Raster besteht aus Bildern, nicht aus laufenden Videos.
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(400);
    const spielendeVideos = await page.evaluate(() =>
      [...document.querySelectorAll("video")].filter((v) => !v.paused).length);

    expect(spielendeVideos).toBe(0);
  });

  test("ein Video mit Standbild zeigt es im Raster", async ({ page }) => {
    await page.goto("/galerie/gamers-heaven-2026");
    await expect(page.getByRole("heading", { name: "Gamers Heaven 2026" })).toBeVisible();

    const bilder = await page.evaluate(() =>
      [...document.querySelectorAll("img")].map((img) => img.getAttribute("src") || ""));

    expect(bilder.some((src) => src.includes("clip-1-vorschau.webp"))).toBe(true);
  });

  test("ohne Standbild steht ein Hinweis statt eines geladenen Videos", async ({ page }) => {
    await page.goto("/galerie/gamers-heaven-2026");
    await expect(page.getByRole("heading", { name: "Gamers Heaven 2026" })).toBeVisible();

    // Die Kachel ohne Vorschaubild lädt kein Video, um ein Bild zu bekommen.
    const videoQuellen = await page.evaluate(() =>
      [...document.querySelectorAll("video")].map((v) => v.getAttribute("src") || ""));

    expect(videoQuellen.some((src) => src.includes("clip-2.mp4"))).toBe(false);
  });

  test("Bilder im Raster fordern eine passende Größe an", async ({ page }) => {
    await page.goto("/galerie/gamers-heaven-2026");
    await expect(page.getByRole("heading", { name: "Gamers Heaven 2026" })).toBeVisible();

    // Die Kachel bekam bisher das gespeicherte Bild mit bis zu 4096 Pixeln.
    const srcsets = await page.evaluate(() =>
      [...document.querySelectorAll("img")].map((img) => img.getAttribute("srcset") || ""));

    expect(srcsets.some((value) => value.includes("w=400 400w"))).toBe(true);
  });

  test("das Album läuft am Telefon nicht quer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/galerie/gamers-heaven-2026");
    await expect(page.getByRole("heading", { name: "Gamers Heaven 2026" })).toBeVisible();

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
