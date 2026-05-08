const { test, expect } = require("@playwright/test");
const zlib = require("zlib");

const runAdmin = process.env.RUN_ADMIN_E2E === "true";
const email = process.env.TLS_LIVE_EMAIL;
const password = process.env.TLS_LIVE_PASSWORD;

async function acceptCookies(page) {
  const button = page.getByRole("button", { name: /alle akzeptieren/i });
  if (await button.count()) await button.click();
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createSmokePng() {
  const width = 8;
  const height = 8;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const i = row + 1 + x * 4;
      raw[i] = 41;
      raw[i + 1] = 182;
      raw[i + 2] = 232;
      raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

test.describe("live admin checks", () => {
  test.skip(!runAdmin || !email || !password, "Set RUN_ADMIN_E2E=true, TLS_LIVE_EMAIL and TLS_LIVE_PASSWORD to run live admin checks.");

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await acceptCookies(page);
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
    await page.getByRole("button", { name: /^markdown$/i }).click();
    await expect(page.getByTestId("news-content-markdown")).toBeVisible();
    await page.getByRole("button", { name: /^vorschau$/i }).click();
    await expect(page.locator(".prose-cms").first()).toBeVisible();
    await page.getByRole("button", { name: /^html$/i }).click();
    await expect(page.getByRole("button", { name: /^html übernehmen$/i })).toBeVisible();
  });

  test("profile image editor renders selected image instead of black preview", async ({ page }) => {
    await page.goto("/profile");
    await page.getByTestId("profile-avatar-file").setInputFiles({
      name: "tls-editor-smoke.png",
      mimeType: "image/png",
      buffer: createSmokePng(),
    });
    await expect(page.getByText("Bild bearbeiten")).toBeVisible();
    const canvas = page.locator('canvas[aria-label="Bildvorschau"]').first();
    await expect(canvas).toBeVisible();
    await expect.poll(async () => canvas.evaluate((node) => {
      const ctx = node.getContext("2d");
      const data = ctx.getImageData(Math.floor(node.width / 2), Math.floor(node.height / 2), 1, 1).data;
      return Array.from(data).join(",");
    })).toBe("41,182,232,255");
  });

  test("image upload API accepts, serves and deletes a smoke image", async ({ request }) => {
    const login = await request.post("/api/auth/login", { data: { email, password } });
    expect(login.ok()).toBeTruthy();
    const cookieHeader = login.headersArray()
      .filter((header) => header.name.toLowerCase() === "set-cookie")
      .map((header) => header.value)
      .map((cookie) => cookie.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
    expect(cookieHeader).toContain("access_token=");
    const csrf = cookieHeader.match(/csrf_token=([^;]+)/)?.[1] || "";
    const authHeaders = { Cookie: cookieHeader, "X-CSRF-Token": csrf };
    const png = createSmokePng();
    const upload = await request.post("/api/uploads/image", {
      headers: authHeaders,
      multipart: { file: { name: "tls-e2e-smoke.png", mimeType: "image/png", buffer: png } },
    });
    expect(upload.ok(), await upload.text()).toBeTruthy();
    const body = await upload.json();
    expect(body.media_scope).toBe("user");
    const image = await request.get(body.url);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");

    const personalMedia = await request.get("/api/media?type=images", { headers: authHeaders });
    expect(personalMedia.ok()).toBeTruthy();
    expect((await personalMedia.json()).some((item) => item.filename === body.filename && item.media_scope === "user")).toBeTruthy();

    const adminMedia = await request.get("/api/admin/media?type=images", { headers: authHeaders });
    expect(adminMedia.ok()).toBeTruthy();
    expect((await adminMedia.json()).some((item) => item.filename === body.filename)).toBeFalsy();

    const scopedUpload = await request.post("/api/uploads/image?media_scope=admin", {
      headers: authHeaders,
      multipart: { file: { name: "tls-e2e-admin-smoke.png", mimeType: "image/png", buffer: png } },
    });
    expect(scopedUpload.ok()).toBeTruthy();
    const scopedBody = await scopedUpload.json();
    expect(scopedBody.media_scope).toBe("admin");

    const adminMediaAfter = await request.get("/api/admin/media?type=images", { headers: authHeaders });
    expect(adminMediaAfter.ok()).toBeTruthy();
    expect((await adminMediaAfter.json()).some((item) => item.filename === scopedBody.filename && item.media_scope === "admin")).toBeTruthy();

    const personalMediaAfter = await request.get("/api/media?type=images", { headers: authHeaders });
    expect(personalMediaAfter.ok()).toBeTruthy();
    expect((await personalMediaAfter.json()).some((item) => item.filename === scopedBody.filename)).toBeFalsy();

    const deleted = await request.delete(`/api/admin/media/${body.filename}`, { headers: authHeaders });
    expect(deleted.ok()).toBeTruthy();
    const deletedScoped = await request.delete(`/api/admin/media/${scopedBody.filename}`, { headers: authHeaders });
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
