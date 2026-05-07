const { test, expect } = require("@playwright/test");

const runAdmin = process.env.RUN_ADMIN_E2E === "true";
const email = process.env.TLS_LIVE_EMAIL;
const password = process.env.TLS_LIVE_PASSWORD;

test.describe("live admin checks", () => {
  test.skip(!runAdmin || !email || !password, "Set RUN_ADMIN_E2E=true, TLS_LIVE_EMAIL and TLS_LIVE_PASSWORD to run live admin checks.");

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(password);
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("nav-admin")).toBeVisible();
  });

  test("news editor exposes WYSIWYG, markdown, preview and HTML modes", async ({ page }) => {
    await page.goto("/admin/news");
    await page.getByTestId("news-new").click();
    await expect(page.getByTestId("news-content")).toBeVisible();
    await expect(page.getByTestId("news-content-visual")).toBeVisible();
    await page.getByRole("button", { name: /markdown/i }).click();
    await expect(page.getByTestId("news-content-markdown")).toBeVisible();
    await page.getByRole("button", { name: /vorschau/i }).click();
    await expect(page.getByText(/keine vorschau/i).or(page.locator(".prose-cms").first())).toBeVisible();
    await page.getByRole("button", { name: /^html$/i }).click();
    await expect(page.getByRole("button", { name: /html übernehmen/i })).toBeVisible();
  });

  test("image upload API accepts, serves and deletes a smoke image", async ({ request }) => {
    const login = await request.post("/api/auth/login", { data: { email, password } });
    expect(login.ok()).toBeTruthy();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64",
    );
    const upload = await request.post("/api/uploads/image", {
      multipart: { file: { name: "tls-e2e-smoke.png", mimeType: "image/png", buffer: png } },
    });
    expect(upload.ok()).toBeTruthy();
    const body = await upload.json();
    expect(body.media_scope).toBe("user");
    const image = await request.get(body.url);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");

    const personalMedia = await request.get("/api/media?type=images");
    expect(personalMedia.ok()).toBeTruthy();
    expect((await personalMedia.json()).some((item) => item.filename === body.filename && item.media_scope === "user")).toBeTruthy();

    const adminMedia = await request.get("/api/admin/media?type=images");
    expect(adminMedia.ok()).toBeTruthy();
    expect((await adminMedia.json()).some((item) => item.filename === body.filename)).toBeFalsy();

    const scopedUpload = await request.post("/api/uploads/image?media_scope=admin", {
      multipart: { file: { name: "tls-e2e-admin-smoke.png", mimeType: "image/png", buffer: png } },
    });
    expect(scopedUpload.ok()).toBeTruthy();
    const scopedBody = await scopedUpload.json();
    expect(scopedBody.media_scope).toBe("admin");

    const adminMediaAfter = await request.get("/api/admin/media?type=images");
    expect(adminMediaAfter.ok()).toBeTruthy();
    expect((await adminMediaAfter.json()).some((item) => item.filename === scopedBody.filename && item.media_scope === "admin")).toBeTruthy();

    const personalMediaAfter = await request.get("/api/media?type=images");
    expect(personalMediaAfter.ok()).toBeTruthy();
    expect((await personalMediaAfter.json()).some((item) => item.filename === scopedBody.filename)).toBeFalsy();

    const deleted = await request.delete(`/api/admin/media/${body.filename}`);
    expect(deleted.ok()).toBeTruthy();
    const deletedScoped = await request.delete(`/api/admin/media/${scopedBody.filename}`);
    expect(deletedScoped.ok()).toBeTruthy();
  });

  test("board assignments only expose club member profiles", async ({ request }) => {
    const login = await request.post("/api/auth/login", { data: { email, password } });
    expect(login.ok()).toBeTruthy();
    const response = await request.get("/api/board/assignable-users");
    expect(response.ok()).toBeTruthy();
    const rows = await response.json();
    expect(Array.isArray(rows)).toBeTruthy();
    expect(rows.every((row) => row.source === "member_profile")).toBeTruthy();
  });
});
