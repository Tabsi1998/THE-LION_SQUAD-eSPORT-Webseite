const { test, expect } = require("@playwright/test");

// Oberfläche, Paket 3 (#1081, #1082): Der wichtige Knopf hat überall dieselbe Sprache - blau, beim Drüberfahren läuft
// ein Licht hindurch. „Mitglied werden“ zeigt eine Schritt-Anzeige: ohne Konto beginnt der Weg beim Konto. Mit
// „Bewegung reduzieren“ läuft kein Licht. Bilder in SHOT_DIR.

const SHOTS = process.env.SHOT_DIR || "";

async function mockServer(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, body: "{}" }));
  await page.route("**/api/settings/public", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at" }) }));
}

test.describe("Oberfläche, Paket 3: Knöpfe und Schritt-Anzeige", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Hover gibt es nur mit Maus");

  test("der wichtige Knopf: eine Klasse, beim Drüberfahren läuft das Licht durch", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page);
    await page.goto("/");
    const button = page.getByTestId("nav-register");
    await expect(button).toHaveClass(/tls-btn--primary/);
    await expect(button).not.toHaveClass(/bg-\[#29B6E8\]/);
    const look = () => button.evaluate((node) => ({ color: getComputedStyle(node).backgroundColor, position: getComputedStyle(node).backgroundPosition }));
    const rest = await look();
    expect(rest.color).toBe("rgb(41, 182, 232)");
    expect(rest.position).toBe("150% 0px");
    await button.hover();
    await expect.poll(async () => (await look()).position).toBe("-50% 0px");
    expect((await look()).color).toBe("rgb(30, 149, 194)");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/knopf-hover-1440.png`, clip: { x: 1100, y: 0, width: 340, height: 80 } });
  });

  test("Mitglied werden: die Schritt-Anzeige beginnt ohne Konto beim Konto", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page);
    await page.goto("/membership/join");
    const steps = page.getByTestId("join-steps");
    await expect(steps).toBeVisible();
    await expect(steps).toHaveAttribute("aria-label", "Schritt 1 von 4: Konto");
    const states = await steps.locator("li").evaluateAll((nodes) => nodes.map((node) => node.dataset.state));
    expect(states).toEqual(["current", "open", "open", "open"]);
    await expect(steps).toHaveText(/Konto.*Antrag.*Prüfung.*Mitglied/);
    // Die gefüllte Leiste ist die des aktuellen Schritts, die offenen sind leer.
    const positions = await steps.locator(".tls-steps__bar").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundPosition));
    expect(positions[0]).toBe("0px 0px");
    expect(positions[1]).toBe("100% 0px");
    if (SHOTS) {
      const box = await steps.boundingBox();
      await page.screenshot({ path: `${SHOTS}/schritte-1440.png`, clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 16), width: box.width + 32, height: box.height + 32 } });
    }
  });

  test("mit „Bewegung reduzieren“ läuft kein Licht durch den Knopf", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockServer(page);
    await page.goto("/");
    const button = page.getByTestId("nav-register");
    await button.hover();
    await page.waitForTimeout(300);
    expect(await button.evaluate((node) => getComputedStyle(node).backgroundPosition)).toBe("150% 0px");
    // Die Farbe wechselt weiter - das ist keine Bewegung.
    expect(await button.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(30, 149, 194)");
  });
});
