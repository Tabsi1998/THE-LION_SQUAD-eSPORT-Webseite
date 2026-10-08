const { test, expect } = require("@playwright/test");

// Alle Benutzer (#1357): der Superadmin gibt eine Freigabe - erst mit „Speichern“ und Rückfrage; die Vereinsverwaltung
// sperrt ein Spieler-Konto mit Grund. Bei 390, 768 und 1440 px; Liste am Handy als Karten, Blatt am Handy als ganze Seite.

const WIDTHS = [["handy", 390, 844], ["tablet", 768, 1024], ["pc", 1440, 900]];
const ROOT = { id: "u-root", username: "root", display_name: "Sam Superadmin", role: "superadmin", areas: ["tournaments", "content", "club", "finance", "system", "moderation"], mfa_enabled: true, auth_mfa_verified: true };
const BOARD = { id: "u-board", username: "vera", display_name: "Vera Vorstand", role: "player", areas: ["club"], mfa_enabled: true, auth_mfa_verified: true };
const USERS = [
  { id: "u-1", username: "erika", display_name: "Erika Beispiel", email: "erika@example.test", role: "player", areas: [], ban_protected: false, is_club_member: true },
  { id: "u-2", username: "max", display_name: "Max Muster", email: "max@example.test", role: "tournament_admin", areas: [], ban_protected: true },
];

async function mockApi(page, me, calls) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() !== "GET") {
      calls.push({ method: request.method(), path, body: request.postDataJSON() });
      return json({ ok: true, notified: true });
    }
    if (path === "/api/auth/me") return json(me);
    if (path === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (path === "/api/users") return json(USERS);
    const list = /notifications|games$|nav$|site-banners|sponsors|partners/.test(path);
    return json(list ? [] : {});
  });
}

async function openSheet(page, width, username) {
  await page.getByTestId(width < 1024 ? `user-edit-card-${username}` : `user-edit-${username}`).click();
  const sheet = page.getByTestId("user-sheet");
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  if (width < 640) expect(Math.abs(box.width - width)).toBeLessThanOrEqual(2);
  else expect(box.x).toBeGreaterThan(0);
  return sheet;
}

async function overflow(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
      await page.setViewportSize({ width, height });
    });

    test("Superadmin gibt eine Freigabe mit Rückfrage", async ({ page }) => {
      const calls = [];
      await mockApi(page, ROOT, calls);
      await page.goto("/admin/users");
      const sheet = await openSheet(page, width, "erika");
      await sheet.getByTestId("user-sheet-area-club").check();
      expect(calls).toEqual([]);
      await expect(sheet.getByTestId("user-sheet-pending")).toContainText("Erika Beispiel bekommt damit Zugriff auf Vereinsverwaltung");
      await page.getByTestId("user-sheet-save").click();
      const dialog = page.getByTestId("confirm-dialog");
      await expect(dialog).toContainText("Mitgliederdaten, Anträge, Dokumente und Benutzer");
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect.poll(() => calls.find((call) => call.path === "/api/users/u-1/areas")?.body).toEqual({ areas: ["club"] });
      expect(await overflow(page)).toBeLessThanOrEqual(2);
    });

    test("Vereinsverwaltung sperrt ein Spieler-Konto mit Grund", async ({ page }) => {
      const calls = [];
      await mockApi(page, BOARD, calls);
      await page.goto("/admin/users");
      // Konten mit Adminbereich: ein Satz statt des Knopfs.
      let sheet = await openSheet(page, width, "max");
      await expect(sheet.getByTestId("user-sheet-ban-locked")).toContainText("sperren kann nur der Superadmin");
      await expect(sheet.getByTestId("user-sheet-role")).toHaveCount(0);
      await page.getByTestId("user-sheet-close").click();

      sheet = await openSheet(page, width, "erika");
      await sheet.getByTestId("user-sheet-ban-open").click();
      await page.getByTestId("ban-dialog-reason").fill("Wiederholt beleidigt");
      await page.getByTestId("ban-dialog-confirm").click();
      await expect.poll(() => calls.find((call) => call.path === "/api/users/u-1/ban")?.body).toEqual({ reason: "Wiederholt beleidigt" });
      expect(await overflow(page)).toBeLessThanOrEqual(2);
    });
  });
}
