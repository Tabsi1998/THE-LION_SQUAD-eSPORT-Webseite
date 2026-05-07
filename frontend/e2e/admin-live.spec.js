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
    const image = await request.get(body.url);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");
    const deleted = await request.delete(`/api/admin/media/${body.filename}`);
    expect(deleted.ok()).toBeTruthy();
  });
});
