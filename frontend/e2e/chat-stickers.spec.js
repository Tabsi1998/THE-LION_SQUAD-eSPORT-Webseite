const { test, expect } = require("@playwright/test");

// Sticker im Chat: Auswahl öffnen, suchen, antippen - der Sticker geht sofort
// raus. An den Server geht nur die Kennung, nie Text oder Anhänge dazu.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const user = {
  id: "user-1",
  username: "testplayer",
  display_name: "Test Player",
  role: "player",
};

const catalog = {
  packs: [
    {
      id: "pack-club",
      name: "Lion Squad",
      builtin: false,
      stickers: [{ id: "st-roar", pack_id: "pack-club", name: "Brüllender Löwe", keywords: ["brüll"], url: "/api/static/uploads/roar.png" }],
    },
    {
      id: "fluent-esports",
      name: "eSports & Party",
      builtin: true,
      stickers: [
        { id: "fluent-trophy", pack_id: "fluent-esports", name: "Pokal", keywords: ["sieg"], url: "/api/stickers/files/fluent/trophy.png" },
        { id: "fluent-fire", pack_id: "fluent-esports", name: "Feuer", keywords: ["heiß"], url: "/api/stickers/files/fluent/fire.png" },
      ],
    },
  ],
};

async function acceptCookies(page) {
  const button = page.getByRole("button", { name: /alle akzeptieren/i });
  if (await button.count()) await button.click();
}

async function mockTeamChat(page, onPost) {
  await page.route("**/api/settings/public", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ club_name: "THE LION SQUAD", tagline: "eSports" }),
  }));
  await page.route("**/api/sponsors**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/api/teams/team-1", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ id: "team-1", name: "Guardians", tag: "GRD", member_ids: [user.id], members: [], member_count: 1, is_member: true, can_manage: false }),
  }));
  const chat = [];
  await page.route("**/api/teams/team-1/chat", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(chat) });
      return;
    }
    const posted = route.request().postDataJSON();
    onPost(posted);
    const sticker = catalog.packs.flatMap((pack) => pack.stickers).find((item) => item.id === posted.sticker_id);
    const saved = {
      id: `m-${chat.length + 1}`,
      user_id: user.id,
      message: "",
      attachments: [],
      sticker,
      author: { id: user.id, display_name: user.display_name },
      created_at: "2026-09-14T18:05:00Z",
    };
    chat.push(saved);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(saved) });
  });
  await page.route((url) => url.pathname === "/api/stickers", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(catalog),
  }));
  await page.route((url) => url.pathname.startsWith("/api/stickers/files/") || url.pathname.startsWith("/api/static/uploads/"), (route) => route.fulfill({
    contentType: "image/png",
    body: PNG,
  }));
}

test("a sticker found by search is sent with one click and shows up in the team chat", async ({ page }) => {
  const posts = [];
  await mockTeamChat(page, (body) => posts.push(body));

  await page.goto("/teams/team-1");
  await acceptCookies(page);
  const teamChat = page.getByTestId("team-chat");

  await page.getByTestId("team-chat-stickers").click();
  const picker = teamChat.getByTestId("chat-sticker-picker");
  await expect(picker).toBeVisible();
  // Eigene Pakete stehen vorn.
  await expect(picker.getByRole("tab").first()).toHaveText("Lion Squad");
  await expect(picker.getByRole("button", { name: "Sticker Brüllender Löwe senden" })).toBeVisible();

  await picker.getByTestId("chat-sticker-search").fill("sieg");
  await expect(picker.getByRole("button", { name: /^Sticker .* senden$/ })).toHaveCount(1);
  await picker.getByRole("button", { name: "Sticker Pokal senden" }).click();

  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ sticker_id: "fluent-trophy" });
  await expect(teamChat.getByRole("img", { name: "Sticker: Pokal" })).toBeVisible();
  await expect(teamChat.getByTestId("chat-sticker-picker")).toHaveCount(0);
});

test("the sticker picker closes with Escape without sending anything", async ({ page }) => {
  const posts = [];
  await mockTeamChat(page, (body) => posts.push(body));

  await page.goto("/teams/team-1");
  await acceptCookies(page);
  await page.getByTestId("team-chat-stickers").click();
  await expect(page.getByTestId("chat-sticker-picker")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByTestId("chat-sticker-picker")).toHaveCount(0);
  expect(posts).toEqual([]);
});
