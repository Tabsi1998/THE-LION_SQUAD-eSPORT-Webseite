const { test, expect } = require("@playwright/test");

// Benachrichtigungen im Dashboard (#255): die fünf neuesten, gebündelt und
// anklickbar mit Vorschau, dann „Alle N anzeigen“ auf die Benachrichtigungsseite.
// Ein Klick markiert das ganze Bündel als gelesen und führt ans Ziel.

const me = { id: "user-1", username: "Testplayer", display_name: "Test Player", role: "player" };

function dm(id, minute, body) {
  return {
    id,
    title: "Neue Nachricht von TheLostFriday",
    body,
    url: "/profile?tab=inbox&to=user-2",
    kind: "direct_message",
    meta: { thread_user_id: "user-2", message_id: id },
    read: false,
    created_at: `2026-09-15T10:${minute}:00Z`,
  };
}

const rows = [
  dm("dm-3", "40", "Okay, ja i seh a die sticker nit amol 😂"),
  dm("dm-2", "20", "Zweite Nachricht"),
  dm("dm-1", "00", "Erste Nachricht"),
  ...Array.from({ length: 27 }, (_, index) => ({
    id: `notification-${index}`,
    title: `Testhinweis ${index + 1}`,
    body: "",
    url: "",
    kind: "general",
    meta: {},
    read: index > 2,
    created_at: `2026-09-14T${String(9 - Math.floor(index / 10)).padStart(2, "0")}:${String(59 - (index % 10) * 5).padStart(2, "0")}:00Z`,
  })),
];

async function mockServer(page, readCalls) {
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/sponsors**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(me) }));
  await page.route("**/api/notifications/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(rows) }));
  await page.route("**/api/admin/notifications", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(rows) }));
  await page.route("**/api/admin/notifications/*/read", (route) => {
    readCalls.push(route.request().url().split("/notifications/")[1].replace("/read", ""));
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/messages/conversations", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/messages/direct/user-2**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ user: { id: "user-2", username: "thelostfriday", display_name: "TheLostFriday" }, can_send: true, message_hint: "", blocked_by_me: false, messages: [], has_more: false, page_size: 50 }),
  }));
}

test("das Dashboard zeigt fünf gebündelte Benachrichtigungen mit Vorschau und verlinkt auf alle", async ({ page }) => {
  const readCalls = [];
  await mockServer(page, readCalls);
  await page.goto("/dashboard");
  const consent = page.getByRole("button", { name: /alle akzeptieren/i });
  if (await consent.count()) await consent.click();

  const panel = page.getByTestId("dashboard-notifications");
  await expect(panel.getByText("3 neue Nachrichten von TheLostFriday", { exact: true })).toBeVisible();
  await expect(panel.getByText("Okay, ja i seh a die sticker nit amol 😂", { exact: true })).toBeVisible();
  await expect(panel.getByText("Testhinweis 4", { exact: true })).toBeVisible();
  await expect(panel.getByText("Testhinweis 5", { exact: true })).toHaveCount(0);
  const showAll = panel.getByTestId("dashboard-notifications-all");
  await expect(showAll).toHaveText("Alle 30 anzeigen");
  await expect(showAll).toHaveAttribute("href", "/notifications");

  // Der Klick auf das Bündel markiert alle drei als gelesen und öffnet das Gespräch.
  await panel.getByText("3 neue Nachrichten von TheLostFriday", { exact: true }).click();
  await expect(page).toHaveURL(/\/messages\/user-2$/);
  await expect.poll(() => readCalls.slice().sort()).toEqual(["dm-1", "dm-2", "dm-3"]);
});

test("die Benachrichtigungsseite listet die Bündel und markiert alle als gelesen", async ({ page }) => {
  const readCalls = [];
  await mockServer(page, readCalls);
  await page.goto("/notifications");
  const consent = page.getByRole("button", { name: /alle akzeptieren/i });
  if (await consent.count()) await consent.click();

  const list = page.getByTestId("notifications-page");
  await expect(list.getByText("3 neue Nachrichten von TheLostFriday", { exact: true })).toBeVisible();
  await expect(list.getByText("Testhinweis 27", { exact: true })).toBeVisible();
  await expect(list.getByText(/6 ungelesen · 24 gelesen/)).toBeVisible();
  await list.getByTestId("notifications-mark-all-read").click();
  await expect(list.getByText(/0 ungelesen · 30 gelesen/)).toBeVisible();
});
