const { test, expect } = require("@playwright/test");

// Einstellungen speichern von selbst (#1048): ein Feld ändern, kurz warten, neu laden - der Wert ist da. Der
// nachgestellte Server verhält sich wie der echte: PATCH /users/me schreibt, setzt updated_at, prüft den Header
// X-Expected-User-Id (leer oder fremd → 409) und liefert das Konto zurück; /auth/me liefert den gespeicherten Stand.

const START = {
  id: "u-neon",
  username: "neonfalke",
  display_name: "NeonFalke",
  role: "player",
  email: "neon@example.test",
  bio: "Alte Bio",
  city: "",
  privacy_public_profile: true,
  updated_at: "2026-10-01T10:00:00.000000+00:00",
};

async function mockServer(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const server = { user: { ...START }, patches: [] };
  let tick = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.startsWith("/changes")) return route.abort();
    if (path === "/auth/me") return json(server.user);
    if (path === "/users/me" && request.method() === "PATCH") {
      const expected = request.headers()["x-expected-user-id"];
      const body = request.postDataJSON() || {};
      server.patches.push({ body, expected });
      if (expected !== undefined && expected !== server.user.id) {
        return json({ detail: "Du bist inzwischen mit einem anderen Konto angemeldet – die Änderung wurde nicht gespeichert." }, 409);
      }
      tick += 1;
      server.user = { ...server.user, ...body, updated_at: `2026-10-14T08:00:${String(tick).padStart(2, "0")}.123456+00:00` };
      return json(server.user);
    }
    if (request.method() !== "GET") return json({ ok: true });
    if (path === "/me/platform-links") return json({ links: [], available: {}, platforms: {} });
    if (path === "/users/me/notification-preferences") return json({});
    const objects = ["/settings/public", "/home/about", "/chats/unread", "/seasonal/active"];
    return json(objects.includes(path) ? {} : []);
  });
  return server;
}

test("Textfeld: ändern, kurz warten, neu laden - der Wert ist gespeichert", async ({ page }) => {
  const server = await mockServer(page);
  await page.goto("/profile?tab=basic");
  const bio = page.getByTestId("profile-bio");
  await expect(bio).toHaveValue("Alte Bio");
  await bio.fill("Neue Bio von selbst gespeichert");
  await expect(page.getByTestId("profile-autosave-status").first()).toContainText("Gespeichert", { timeout: 5000 });
  expect(server.patches.at(-1)).toEqual({ body: { bio: "Neue Bio von selbst gespeichert" }, expected: "u-neon" });
  await page.reload();
  await expect(page.getByTestId("profile-bio")).toHaveValue("Neue Bio von selbst gespeichert");
  await expect(page.getByTestId("profile-save")).toHaveCount(0);
});

test("Schalter: speichert sofort, nach dem Neuladen steht er so", async ({ page }) => {
  const server = await mockServer(page);
  await page.goto("/profile?tab=privacy");
  const toggle = page.getByTestId("profile-privacy");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(page.getByTestId("profile-autosave-status").first()).toContainText("Gespeichert", { timeout: 5000 });
  expect(server.patches.at(-1)).toEqual({ body: { privacy_public_profile: false }, expected: "u-neon" });
  await page.reload();
  await expect(page.getByTestId("profile-privacy")).toHaveAttribute("aria-checked", "false");
});

test("Ungültig: leerer Anzeigename bleibt stehen, hat den Hinweis am Feld und geht nicht an den Server", async ({ page }) => {
  const server = await mockServer(page);
  await page.goto("/profile?tab=basic");
  const name = page.getByTestId("profile-display-name");
  await expect(name).toHaveValue("NeonFalke");
  await name.fill("");
  await name.blur();
  await expect(page.getByTestId("profile-display-name-error")).toBeVisible();
  await expect(page.getByTestId("profile-autosave-status")).toHaveAttribute("data-status", "invalid");
  await page.waitForTimeout(1200);
  expect(server.patches).toEqual([]);
  await expect(name).toHaveValue("");
});

test("Serverfehler: Nicht gespeichert, Erneut versuchen speichert, die Eingabe bleibt", async ({ page }) => {
  const server = await mockServer(page);
  let failNext = true;
  await page.route("**/api/users/me", async (route) => {
    if (route.request().method() === "PATCH" && failNext) {
      failNext = false;
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Kurz nicht erreichbar." }) });
    }
    return route.fallback();
  });
  await page.goto("/profile?tab=basic");
  const bio = page.getByTestId("profile-bio");
  await expect(bio).toHaveValue("Alte Bio");
  await bio.fill("Trotz Fehler");
  await bio.blur();
  const status = page.getByTestId("profile-autosave-status");
  await expect(status).toHaveAttribute("data-status", "error");
  await expect(status).toContainText("Nicht gespeichert.");
  await expect(bio).toHaveValue("Trotz Fehler");
  await page.getByTestId("profile-autosave-retry").click();
  await expect(status).toContainText("Gespeichert");
  expect(server.user.bio).toBe("Trotz Fehler");
});
