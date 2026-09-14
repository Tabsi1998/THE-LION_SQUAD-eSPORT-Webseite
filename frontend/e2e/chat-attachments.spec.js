const { test, expect } = require("@playwright/test");

// Bilder im Chat: Die Anhänge liegen nicht öffentlich, sondern kommen über
// /api/chat-attachments - im Verlauf in der kleinen Fassung. Beim Senden gehen
// nur die Kennungen fertig hochgeladener Anhänge an den Server.

// 1x1-PNG, damit die Bildelemente wirklich laden.
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

async function acceptCookies(page) {
  const button = page.getByRole("button", { name: /alle akzeptieren/i });
  if (await button.count()) await button.click();
}

async function mockPublicChrome(page) {
  await page.route("**/api/settings/public", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ club_name: "THE LION SQUAD", tagline: "eSports" }),
  }));
  await page.route("**/api/sponsors**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(user) }));
}

function attachment(id) {
  return { id, kind: "image", mime: "image/png", size: PNG.length, width: 1, height: 1, url: `/api/chat-attachments/${id}`, poster_url: null };
}

test("team chat sends a picture and loads pictures only through the protected address", async ({ page }) => {
  await mockPublicChrome(page);
  const chat = [{
    id: "m-1",
    user_id: "user-2",
    message: "Schaut euch das an",
    attachments: [attachment("att-old")],
    author: { id: "user-2", display_name: "Mitspieler" },
    created_at: "2026-09-14T18:00:00Z",
  }];
  let posted = null;
  const pictureRequests = [];

  await page.route("**/api/teams/team-1", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      id: "team-1",
      name: "Guardians",
      tag: "GRD",
      description: "Testteam",
      leader_id: "user-1",
      co_leader_ids: [],
      member_ids: [user.id, "user-2"],
      members: [],
      member_count: 2,
      is_member: true,
      can_manage: false,
    }),
  }));
  await page.route("**/api/teams/team-1/chat", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(chat) });
      return;
    }
    posted = route.request().postDataJSON();
    const saved = {
      id: "m-2",
      user_id: user.id,
      message: posted.message,
      attachments: (posted.attachment_ids || []).map(attachment),
      author: { id: user.id, display_name: user.display_name },
      created_at: "2026-09-14T18:05:00Z",
    };
    chat.push(saved);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(saved) });
  });
  await page.route((url) => url.pathname === "/api/chat-attachments", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(attachment("att-new")),
  }));
  await page.route((url) => url.pathname.startsWith("/api/chat-attachments/"), (route) => {
    pictureRequests.push(route.request().url());
    return route.fulfill({ contentType: "image/png", body: PNG });
  });

  await page.goto("/teams/team-1");
  await acceptCookies(page);
  const teamChat = page.getByTestId("team-chat");
  await expect(teamChat.getByRole("img", { name: "Bild im Chat" })).toHaveCount(1);
  // Das Bild lädt erst im sichtbaren Bereich. Welche Fassung der Browser nimmt,
  // hängt von der Pixeldichte ab - entscheidend ist: nie das Original.
  await teamChat.getByRole("img", { name: "Bild im Chat" }).first().scrollIntoViewIfNeeded();
  await expect.poll(() => pictureRequests.some((url) => /\/api\/chat-attachments\/att-old\?w=(400|800|1600)$/.test(url))).toBe(true);
  expect(pictureRequests.some((url) => url.endsWith("/api/chat-attachments/att-old"))).toBe(false);

  await page.getByTestId("team-chat-attach-input").setInputFiles({ name: "aufstellung.png", mimeType: "image/png", buffer: PNG });
  await expect(teamChat.getByTestId("chat-attachment-drafts").locator('[data-status="ready"]')).toHaveCount(1);

  await teamChat.getByRole("button", { name: /senden/i }).click();

  await expect.poll(() => posted).not.toBeNull();
  expect(posted.attachment_ids).toEqual(["att-new"]);
  expect(posted.message).toBe("");
  await expect(teamChat.getByRole("img", { name: "Bild im Chat" })).toHaveCount(2);
  await expect(teamChat.getByTestId("chat-attachment-drafts")).toHaveCount(0);
});

test("a file that is neither picture nor video is refused before anything is sent", async ({ page }) => {
  await mockPublicChrome(page);
  let uploads = 0;
  await page.route("**/api/teams/team-1", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ id: "team-1", name: "Guardians", tag: "GRD", member_ids: [user.id], members: [], member_count: 1, is_member: true, can_manage: false }),
  }));
  await page.route("**/api/teams/team-1/chat", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route((url) => url.pathname === "/api/chat-attachments", (route) => {
    uploads += 1;
    return route.fulfill({ status: 500, body: "" });
  });

  await page.goto("/teams/team-1");
  await acceptCookies(page);
  const teamChat = page.getByTestId("team-chat");
  await page.getByTestId("team-chat-attach-input").setInputFiles({ name: "vertrag.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") });

  await expect(teamChat.getByRole("alert")).toContainText("Nur Bilder und Videos");
  await expect(teamChat.getByRole("button", { name: /senden/i })).toBeDisabled();
  expect(uploads).toBe(0);
});
