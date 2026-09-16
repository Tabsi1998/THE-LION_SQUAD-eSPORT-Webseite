const { test, expect } = require("@playwright/test");

// Nachrichten als eigene Seite (#254): Eine Unterhaltung mit 120 Nachrichten
// zeigt zuerst die letzten 50, die Seite selbst wächst nicht, und Hochscrollen
// holt die älteren nach. Der Server ist nachgestellt; geprüft wird das Verhalten
// der Seite, nicht das Backend (dafür gibt es den Flow-Test).

const me = { id: "user-1", username: "testplayer", display_name: "Test Player", role: "player" };
const bob = { id: "user-2", username: "bob", display_name: "Bob", role: "player" };
const TOTAL = 120;
const PAGE = 50;

function message(index) {
  const minute = String(index % 60).padStart(2, "0");
  const hour = String(8 + Math.floor(index / 60)).padStart(2, "0");
  const mine = index % 3 === 0;
  return {
    id: `m-${index}`,
    sender_id: mine ? me.id : bob.id,
    recipient_id: mine ? bob.id : me.id,
    message: `Nachricht ${index}`,
    attachments: [],
    sticker: null,
    created_at: `2026-09-15T${hour}:${minute}:00Z`,
    sender: mine ? me : bob,
    recipient: mine ? bob : me,
  };
}

const all = Array.from({ length: TOTAL }, (_, i) => message(i + 1));

async function acceptCookies(page) {
  const button = page.getByRole("button", { name: /alle akzeptieren/i });
  if (await button.count()) await button.click();
}

async function mockServer(page, seen) {
  await page.route("**/api/settings/public", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ club_name: "THE LION SQUAD", tagline: "eSports" }),
  }));
  await page.route("**/api/sponsors**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(me) }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [], unread: 0 }) }));
  await page.route("**/api/messages/conversations", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{ user: bob, latest_message: all[TOTAL - 1], unread_count: 0, can_send: true, message_hint: "", blocked_by_me: false }]),
  }));
  await page.route("**/api/messages/direct/user-2**", (route) => {
    const url = new URL(route.request().url());
    const before = url.searchParams.get("before");
    const limit = Number(url.searchParams.get("limit") || PAGE);
    seen.push(url.search);
    let end = all.length;
    if (before) end = all.findIndex((row) => row.id === before);
    const start = Math.max(0, end - limit);
    const rows = all.slice(start, end);
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ user: bob, can_send: true, message_hint: "", blocked_by_me: false, messages: rows, has_more: start > 0, page_size: limit }),
    });
  });
}

test("eine Unterhaltung mit 120 Nachrichten zeigt zuerst die letzten und lädt beim Hochscrollen ältere", async ({ page }) => {
  const seen = [];
  await mockServer(page, seen);
  await page.goto("/messages/user-2");
  await acceptCookies(page);

  const box = page.getByTestId("conversation-scroll");
  await expect(page.getByTestId(`conversation-message-m-${TOTAL}`)).toBeVisible();
  await expect(page.getByTestId("conversation-message-m-1")).toHaveCount(0);
  await expect(page.getByTestId(`conversation-message-m-${TOTAL - PAGE}`)).toHaveCount(0);

  // Der Verlauf scrollt in sich und steht unten.
  const state = await box.evaluate((el) => ({
    scrollable: el.scrollHeight > el.clientHeight,
    atBottom: el.scrollHeight - el.scrollTop - el.clientHeight < 40,
  }));
  expect(state.scrollable).toBe(true);
  expect(state.atBottom).toBe(true);
  const pageHeightBefore = await page.evaluate(() => document.documentElement.scrollHeight);

  // Hochscrollen an den Anfang holt die nächsten 50, die Sicht bleibt stehen.
  const heightBefore = await box.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
    return el.scrollHeight;
  });
  await expect(page.getByTestId(`conversation-message-m-${TOTAL - PAGE}`)).toBeVisible();
  await expect(page.getByTestId("conversation-message-m-21")).toBeAttached();
  await expect(page.getByTestId("conversation-message-m-20")).toHaveCount(0);
  expect(seen.some((query) => query.includes(`before=m-${TOTAL - PAGE + 1}`))).toBe(true);
  const after = await box.evaluate((el) => ({ height: el.scrollHeight, top: el.scrollTop }));
  expect(after.height).toBeGreaterThan(heightBefore);
  expect(after.top).toBeGreaterThan(0);

  // Die Seite selbst ist nicht gewachsen: nur der Verlauf scrollt.
  const pageHeightAfter = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(pageHeightAfter).toBe(pageHeightBefore);

  // Noch einmal: die letzten 20, danach gibt es nichts mehr zu laden.
  await box.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  await expect(page.getByTestId("conversation-message-m-1")).toBeAttached();
  await expect(page.getByTestId("conversation-load-older")).toHaveCount(0);
});

test("die Liste der Gespräche führt zur Unterhaltung, am Handy mit Zurück", async ({ page, isMobile }) => {
  const seen = [];
  await mockServer(page, seen);
  await page.goto("/messages");
  await acceptCookies(page);

  await page.getByTestId("conversation-item-user-2").click();
  await expect(page).toHaveURL(/\/messages\/user-2$/);
  await expect(page.getByTestId(`conversation-message-m-${TOTAL}`)).toBeVisible();
  if (isMobile) {
    await page.getByTestId("conversation-back").click();
    await expect(page).toHaveURL(/\/messages$/);
    await expect(page.getByTestId("conversation-item-user-2")).toBeVisible();
  }
});
