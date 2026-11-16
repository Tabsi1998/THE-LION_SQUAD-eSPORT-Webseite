const path = require("path");
const { test, expect } = require("@playwright/test");

// Push-Tests (#2467): oben die aktiven Handys, die abgemeldeten grau und eingeklappt unter „Alte Geräte (n)“; rot nur bei
// einem Fehler an einem aktiven Gerät. „Alte Geräte entfernen“ fragt in der Seite nach.

const SHOTS = process.env.SHOT_DIR || "";

const USERS = [
  { id: "u1", username: "tabsi98", display_name: "Tabsi98", token_count: 8, enabled_token_count: 1, disabled_token_count: 7, has_enabled_token: true,
    active_error: null, last_receipt_error: "DeviceNotRegistered", latest_updated_at: "2026-11-15T18:20:00+00:00" },
  { id: "u2", username: "thelostfriday", display_name: "TheLostFriday", token_count: 4, enabled_token_count: 1, disabled_token_count: 3, has_enabled_token: true,
    active_error: "MessageRateExceeded", latest_updated_at: "2026-11-14T09:10:00+00:00" },
];

function status(removed) {
  const old = removed ? [] : [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    token_preview: `ExponentPushToken[old${n}Hx2kQ9...`, platform: "android", enabled: false, disabled_at: `2026-11-0${n}T12:00:00+00:00`,
    last_ticket_status: "ok", last_receipt_status: "error", last_receipt_error: "DeviceNotRegistered",
  }));
  return {
    user: { id: "u1", username: "tabsi98", display_name: "Tabsi98", email: "tabsi98@example.test" },
    enabled_count: 1,
    disabled_count: old.length,
    has_enabled_token: true,
    tokens: [
      { token_preview: "ExponentPushToken[aKt1v9Lm...", platform: "android", enabled: true, last_ticket_status: "ok", last_receipt_status: "ok", last_sent_at: "2026-11-16T08:00:00+00:00" },
      ...old,
    ],
  };
}

async function mockPage(page) {
  let removed = false;
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ id: "admin-1", email: "admin@example.test", display_name: "Admin", username: "admin", role: "superadmin",
      is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true }),
  }));
  await page.route("**/api/settings/public", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }) }));
  await page.route("**/api/setup/status", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ completed: true, health_score: 100, missing: [] }) }));
  await page.route("**/api/admin/mobile-push/users**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(removed ? [{ ...USERS[0], token_count: 1, disabled_token_count: 0 }, USERS[1]] : USERS),
  }));
  await page.route("**/api/admin/mobile-push/status/**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(status(removed)) }));
  const deletes = [];
  await page.route("**/api/admin/mobile-push/old-devices/**", (route) => {
    deletes.push(route.request().method());
    removed = true;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, removed: 7 }) });
  });
  return deletes;
}

for (const width of [390, 1440]) {
  test(`bei ${width} px: alte Geräte grau und eingeklappt, Entfernen mit Rückfrage`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const deletes = await mockPage(page);
    await page.goto("/admin/mobile-push");

    const person = page.getByTestId("push-user-u1");
    await expect(person).toContainText("1 Gerät aktiv");
    await expect(person).toContainText("7 alte");
    await expect(person).not.toContainText("von 8");
    await expect(person).not.toContainText("App gelöscht oder Push am Handy abgeschaltet");
    // Ein Fehler an einem aktiven Gerät bleibt sichtbar.
    await expect(page.getByTestId("push-user-u2")).toContainText("Zu viele Nachrichten in kurzer Zeit");

    const toggle = page.getByTestId("push-old-devices-toggle");
    await expect(toggle).toHaveText(/Alte Geräte \(7\)/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("push-old-devices-list")).toHaveCount(0);
    // Keine Waagrecht-Rolle am Handy.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await toggle.click();
    const list = page.getByTestId("push-old-devices-list");
    await expect(list.getByText("abgemeldet – App gelöscht oder neu installiert")).toHaveCount(7);
    await expect(list.getByText("App gelöscht oder Push am Handy abgeschaltet")).toHaveCount(0);
    if (SHOTS) {
      const shot = path.join(SHOTS, `push-alte-geraete-${width}.png`);
      // Am Handy nur die Geräte-Karte - die mitlaufende Kopfzeile stünde in einem ganzseitigen Bild mitten im Inhalt.
      if (width < 768) await page.getByTestId("push-old-devices").locator("..").screenshot({ path: shot });
      else await page.screenshot({ path: shot, fullPage: true });
    }

    await page.getByTestId("push-old-devices-remove").click();
    const dialog = page.getByTestId("confirm-dialog");
    await expect(dialog).toContainText("Alte Geräte entfernen?");
    await expect(dialog).toContainText("Aktive Handys bleiben angemeldet");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `push-entfernen-rueckfrage-${width}.png`) });
    await page.getByTestId("confirm-dialog-cancel").click();
    expect(deletes).toEqual([]);

    await page.getByTestId("push-old-devices-remove").click();
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(page.getByTestId("push-old-devices")).toHaveCount(0);
    expect(deletes).toEqual(["DELETE"]);
    await expect(page.getByTestId("push-user-u1")).not.toContainText("alte");
  });
}
