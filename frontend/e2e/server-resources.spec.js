const { test, expect } = require("@playwright/test");

const game = { id: "minecraft", name: "Minecraft", logo_url: "/assets/brand/tls-favicon.png" };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/sponsors**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "application/json", body: "null" }));
});

async function dismissCookies(page) {
  const button = page.getByRole("button", { name: /alle erlauben/i });
  if (await button.count()) await button.click();
}

test("server cards show game icons and compact enabled mod links only", async ({ page }, testInfo) => {
  const resources = [
    { kind: "modloader", enabled: true, label: "Fabric", version: "1.2", url: "https://downloads.example/loader" },
    { kind: "config", enabled: false, label: "Draft config", url: "https://downloads.example/draft" },
    { kind: "guide", enabled: true, label: "Unsafe", url: "javascript:alert(1)" },
  ];
  await page.route("**/api/game-servers", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    items: [
      { id: "modded", name: "Modded Server", game, status: "online", modding_enabled: true, modding_notes: "Install loader first.", mod_resources: resources },
      { id: "vanilla", name: "Vanilla Server", game, status: "online", show_game_icon: false, modding_enabled: false, mod_resources: resources },
      { id: "fallback", name: "Broken Icon Server", game, server_icon_url: "/broken-server-icon.png", status: "offline" },
    ], summary: { total: 3, online: 2 },
  }) }));
  await page.route("**/broken-server-icon.png", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/servers");
  await dismissCookies(page);
  const modded = page.locator("article").filter({ has: page.getByRole("heading", { name: "Modded Server", exact: true }) });
  await expect(modded.getByRole("img", { name: "Minecraft-Logo" })).toHaveAttribute("src", new URL(game.logo_url, page.url()).href);
  await expect(modded.getByText("Install loader first.")).not.toBeVisible();
  await modded.locator("summary").click();
  await expect(modded.getByText("Install loader first.")).toBeVisible();
  await expect(modded.getByRole("link", { name: /Fabric/ })).toHaveAttribute("href", "https://downloads.example/loader");
  await expect(modded.getByRole("link", { name: /Draft config|Unsafe/ })).toHaveCount(0);
  const vanilla = page.locator("article").filter({ has: page.getByRole("heading", { name: "Vanilla Server", exact: true }) });
  await expect(vanilla.getByTestId("server-mod-resources")).toHaveCount(0);
  await expect(vanilla.locator("img")).toHaveCount(0);
  const fallback = page.locator("article").filter({ has: page.getByRole("heading", { name: "Broken Icon Server", exact: true }) });
  await fallback.scrollIntoViewIfNeeded();
  await expect(fallback.locator("img")).toHaveAttribute("src", new URL(game.logo_url, page.url()).href);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("server-resources.png"), fullPage: true });
});

test("admin selects a game, saves optional resources and disables them without losing configuration", async ({ page }) => {
  let saved = null;
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "admin", role: "superadmin", mfa_enabled: true, auth_mfa_verified: true }) }));
  await page.route("**/api/games", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([game]) }));
  await page.route("**/api/game-servers**", (route) => {
    if (["POST", "PATCH"].includes(route.request().method())) saved = { ...saved, ...route.request().postDataJSON(), id: "server-1" };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(route.request().method() === "GET" ? (saved ? [saved] : []) : saved) });
  });
  await page.goto("/admin/game-servers");
  await dismissCookies(page);
  await page.getByRole("button", { name: "Server anlegen", exact: true }).click();
  const form = page.locator("form");
  await form.getByLabel("Name", { exact: true }).fill("Modded Testserver");
  await form.getByLabel("Spiel-Verknüpfung").selectOption("minecraft");
  await expect(form.getByTestId("server-game-icon").locator("img")).toHaveAttribute("src", new URL(game.logo_url, page.url()).href);
  await form.getByLabel("Modded / Mods & Einrichtung anzeigen").check();
  await form.getByLabel("Installationshinweise").fill("Install loader first.");
  await form.getByRole("button", { name: "Link hinzufügen" }).click();
  const row = form.getByTestId("mod-resource-row");
  await row.getByLabel("Bezeichnung (optional)").fill("Fabric");
  await row.getByLabel("HTTPS-Adresse").fill("https://downloads.example/loader");
  await row.getByLabel("Link 1 anzeigen").check();
  await form.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(saved.game_id).toBe("minecraft");
  expect(saved.mod_resources[0]).toMatchObject({ enabled: true, kind: "modloader", label: "Fabric" });
  await page.getByTitle("Bearbeiten", { exact: true }).click();
  await expect(page.getByLabel("HTTPS-Adresse")).toHaveValue("https://downloads.example/loader");
  await page.getByLabel("Modded / Mods & Einrichtung anzeigen").uncheck();
  await expect(page.getByLabel("HTTPS-Adresse")).toBeDisabled();
  await page.getByLabel("Spiel-/Server-Icon anzeigen").uncheck();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.locator("form")).toHaveCount(0);
  expect(saved.modding_enabled).toBe(false);
  expect(saved.show_game_icon).toBe(false);
  expect(saved.mod_resources[0].url).toBe("https://downloads.example/loader");
  expect(saved.modding_notes).toBe("Install loader first.");
});
