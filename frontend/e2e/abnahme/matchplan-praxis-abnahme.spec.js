const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Abnahme gegen den echten Server: der Praxis-Fall vom 14.10. (Fabian, Kart-Cup FFA 16 Doppel-K.-o.). Ein Cup vor Ort
// ohne Stationen - einmal mit Vorschau-Baum, einmal mit der alten Matchplanung auf einer gelöschten Station (LE vor LC,
// G/LF/Finale 30 Min.). Erwartet: Kopf und Zeitleiste sagen dasselbe („Noch keine Station“, Bahn „Gelöschte Station“
// mit Warnung), feste Termine vor ihren Vorspielen stehen rot in Worten, nichts springt, keine Fehler.
// Läuft nur mit ABNAHME=1 (docs/entwicklung/abnahme-lokal.md).

const ENABLED = process.env.ABNAHME === "1";
const STATE_FILE = process.env.ABNAHME_STATE || path.join(__dirname, "..", "..", "..", ".local-testing", "abnahme", "state.json");
const SHOTS = process.env.ABNAHME_SHOTS || "";
const state = ENABLED && fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : null;
const SIZES = { desktop: { width: 1440, height: 900 }, handy: { width: 375, height: 812 } };

function base32(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const digest = crypto.createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0xf;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function login(page, account) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = await page.request.post("/api/auth/login", { data: { email: account.email, password: account.password, remember: true } });
    expect(started.status(), await started.text()).toBe(200);
    const body = await started.json();
    if (!body.mfa_required) return;
    const done = await page.request.post("/api/auth/mfa/complete", { data: { ticket: body.mfa_ticket, code: totp(account.totp), client: "web" } });
    if (done.status() === 200) return;
    await page.waitForTimeout(31_000);
  }
  throw new Error(`Anmeldung ${account.email} nicht möglich`);
}

function watch(page) {
  const problems = [];
  page.on("pageerror", (error) => problems.push(`Seitenfehler: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") problems.push(`Konsole: ${message.text()}`); });
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("/api/")) problems.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  return problems;
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

test.describe("Abnahme: Praxis-Fall 14.10. - Cup ohne Stationen, alte Matchplanung", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.tournaments?.practice_old_plan, `Kein passender Seed-Stand: ${STATE_FILE}`);
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  for (const role of ["admin", "lead"]) {
    for (const [size, viewport] of Object.entries(SIZES)) {
      test(`${role} ${size}: alte Planung auf gelöschter Station und Vorschau-Baum ohne Stationen`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "chromium", "Größe stellt der Test selbst ein");
        await page.setViewportSize(viewport);
        await login(page, state.accounts[role]);
        const problems = watch(page);

        await page.goto(`/admin/tournaments/${state.tournaments.practice_old_plan}?tab=matchplan`);
        const warnings = page.getByTestId("mp-warnings");
        await expect(warnings).toContainText("die es nicht mehr gibt");
        await expect(warnings).toContainText("LE ist fest um 19:10, aber LC ist erst um 20:00 vorbei.");
        await expect(warnings).toContainText("FINAL ist fest um 20:20, aber LF ist erst um 20:20 vorbei.");
        await expect(page.getByTestId("mp-settings")).toContainText("Noch keine Station");
        await expect(page.locator(".mp")).toHaveAttribute("data-mode", "local");
        if (size === "desktop") {
          await expect(page.locator("[data-testid^='mp-lane-'][data-name='Gelöschte Station']")).toHaveCount(1);
          await expect(page.locator("[data-testid^='mp-lane-'][data-name='Station']")).toHaveCount(0);
          await expect(page.getByTestId("mp-bar-LE")).toHaveAttribute("data-conflict", "true");
        } else {
          await expect(page.getByTestId("mp-agenda")).toContainText("Gelöschte Station");
        }
        await page.waitForTimeout(1_500);
        await shot(page, `${role}-${size}-alte-planung`);
        await page.getByTestId("admin-tr-tab-stages").click();
        await expect(page.getByTestId("stages-matchplan-hint")).toBeVisible();
        await page.getByTestId("admin-tr-tab-matchplan").click();
        await expect(page.getByTestId("mp-warnings")).toContainText("die es nicht mehr gibt");

        await page.goto(`/admin/tournaments/${state.tournaments.practice_draft}?tab=matchplan`);
        await expect(page.locator(".mp")).toHaveAttribute("data-mode", "local");
        await expect(page.getByTestId("mp-plan-note")).toContainText("Vorschau");
        await expect(page.getByTestId("mp-settings")).toContainText("Noch keine Station");
        await page.waitForTimeout(1_500);
        await expect(page.locator(".mp")).toHaveAttribute("data-mode", "local");
        await shot(page, `${role}-${size}-vorschau-ohne-stationen`);
        expect(problems).toEqual([]);
      });
    }
  }
});
