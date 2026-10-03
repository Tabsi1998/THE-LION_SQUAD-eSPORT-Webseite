const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

// Gestaltung der Discord-Meldungen (#866): der Reiter „Gestaltung“ zeigt je Meldungsart Formular und Discord-Vorschau
// - die Daten kommen aus der echten Gestaltung des Servers (e2e/fixtures/discord-design.json, erzeugt aus
// services/discord_design.py), Bilder vom Testserver. Admin-Konto und API sind Attrappen im Browser.

const SHOTS = process.env.SHOT_DIR || "";
const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "discord-design.json"), "utf-8");
const SETTINGS = { enabled: true, configured: true, channels: { community: "100000000000000001", test: "100000000000000099" }, events: [], target_status: {},
  bot: { enabled: true, configured: true, connected: true }, embeds: {}, last_status: "sent" };

async function mockAdmin(page, origin) {
  const design = JSON.parse(FIXTURE.replaceAll("http://e2e-origin.test", origin));
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const list = url.pathname.includes("/notifications") || url.pathname.endsWith("/games") || url.pathname.includes("/counters");
    return route.fulfill({ status: 200, contentType: "application/json", body: list ? "[]" : "{}" });
  });
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ id: "admin-1", email: "admin@example.test", display_name: "Admin", username: "admin", role: "superadmin", mfa_enabled: true, auth_mfa_verified: true }) }));
  await page.route("**/api/settings/discord", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(SETTINGS) }));
  await page.route("**/api/settings/discord/design", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(design) }));
  await page.route("**/api/settings/discord/design/*/preview", (route) => {
    const kind = new URL(route.request().url()).pathname.split("/").at(-2);
    const entry = design.kinds.find((item) => item.key === kind);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...entry.preview, errors: [], data: "sample", note: null, length: 120 }) });
  });
  return design;
}

for (const width of [390, 1440]) {
  test(`Gestaltung ${width}px: Stream-Meldung und Nächste Events im Discord-Look`, async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await mockAdmin(page, baseURL.replace(/\/$/, ""));
    await page.goto("/admin/integrations/discord");
    await page.getByTestId("discord-tab-design").click();
    const message = page.getByTestId("discord-design-message");
    await expect(message).toBeVisible();
    await expect(page.getByTestId("discord-design-message-content")).toContainText("TheLostFriday ist jetzt live auf Twitch!");
    await expect(page.getByTestId("discord-design-message-author")).toContainText("TheLostFriday");
    await expect(page.getByTestId("discord-design-message-image")).toBeVisible();
    await expect(page.getByTestId("discord-design-message-thumbnail")).toBeVisible();
    await expect(page.getByTestId("discord-design-message-footer")).toContainText("Twitch · live seit 19:15 Uhr");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const shot = await page.getByTestId("discord-design-preview").screenshot();
    await testInfo.attach(`design-stream-${width}.png`, { body: shot, contentType: "image/png" });
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, `design-stream-${width}.png`), shot);

    await page.getByTestId("discord-design-kind-events").click();
    await expect(message).toContainText("Nächste Events und Turniere");
    await expect(message).toContainText("Sommer-Cup");
    const events = await page.getByTestId("discord-design-preview").screenshot();
    await testInfo.attach(`design-events-${width}.png`, { body: events, contentType: "image/png" });
    if (SHOTS) {
      fs.writeFileSync(path.join(SHOTS, `design-events-${width}.png`), events);
      await page.getByTestId("discord-design").screenshot({ path: path.join(SHOTS, `design-editor-${width}.png`) });
    }
  });
}
