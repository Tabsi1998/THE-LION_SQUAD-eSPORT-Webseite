const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Rangliste, Spielplan, Podest und Sieger-Moment
// (#1562) - nicht angemeldet, als Spieler und als Admin, am PC (1440) und am Handy (375). Keine Konsolenfehler, keine
// Antwort 4xx/5xx (außer „nicht angemeldet“ beim Abfragen der eigenen Sitzung, solange niemand angemeldet ist).
// Läuft nur mit ABNAHME=1; Kennungen und Zugänge aus .local-testing/abnahme/state.json (scripts/seed_abnahme.py).

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

async function prepare(page, role) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  if (role === "anon") return;
  const account = state.accounts[role];
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

function watch(page, role) {
  const problems = [];
  page.on("pageerror", (error) => problems.push(`Seitenfehler: ${error.message}`));
  page.on("console", (message) => {
    // Nicht angemeldet: der Browser meldet die 401 der Sitzungsabfrage selbst als Konsolenfehler.
    if (message.type() === "error" && !(role === "anon" && /401/.test(message.text()))) problems.push(`Konsole: ${message.text()}`);
  });
  page.on("response", (response) => {
    const url = response.url();
    if (response.status() < 400 || !url.includes("/api/")) return;
    if (role === "anon" && response.status() === 401 && /\/api\/auth\/(me|refresh)/.test(url)) return;
    problems.push(`${response.status()} ${response.request().method()} ${url}`);
  });
  return problems;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "seitliches Überlaufen").toBeLessThanOrEqual(1);
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

test.describe("Abnahme #1562: Rangliste, Spielplan, Podest gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.slugs?.league_published, `Kein passender Seed-Stand: ${STATE_FILE} - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  for (const role of ["anon", "player", "admin"]) {
    for (const [size, viewport] of Object.entries(SIZES)) {
      test(`${role} ${size}: Liga, Gruppen, Spielplan nach Runden und Stationen, Podest`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "chromium", "Größe stellt der Test selbst ein");
        await page.setViewportSize(viewport);
        await prepare(page, role);
        const problems = watch(page, role);
        const slugs = state.slugs;
        const tag = `${role}-${size}`;

        // Liga (läuft): Tabelle, als Spieler die eigene Zeile mit „Du“.
        await page.goto(`/tournaments/${slugs.league}/standings`);
        await expect(page.getByRole("table").first()).toBeVisible();
        if (role === "player") await expect(page.locator("[data-mine='true']").first()).toContainText("Du");
        else await expect(page.locator("[data-mine='true']")).toHaveCount(0);
        await noSideScroll(page);
        await shot(page, `${tag}-liga-tabelle`);

        // Gruppen: je Gruppe eine Tabelle, als Spieler „Deine Gruppe“.
        await page.goto(`/tournaments/${slugs.groups}/standings`);
        await expect(page.getByRole("table")).toHaveCount(2);
        await expect(page.getByRole("heading", { name: /Gruppe A/ })).toBeVisible();
        if (role === "player") await expect(page.getByText("Deine Gruppe")).toBeVisible();
        else await expect(page.getByText("Deine Gruppe")).toHaveCount(0);
        await noSideScroll(page);
        await shot(page, `${tag}-gruppen-tabellen`);

        // Spielplan vor Ort: nach Runden, nach Stationen, als Spieler „Nur meine Spiele“.
        await page.goto(`/tournaments/${slugs.local_live}/matches`);
        await expect(page.getByTestId("schedule-toolbar")).toBeVisible();
        await expect(page.locator("[data-testid^='schedule-match-']").first()).toBeVisible();
        await noSideScroll(page);
        await shot(page, `${tag}-spielplan-runden`);
        await page.getByTestId("schedule-view-stations").click();
        await expect(page.getByTestId("schedule-stations")).toBeVisible();
        await expect(page.locator("[data-testid^='schedule-line-']").first()).toBeVisible();
        await noSideScroll(page);
        await shot(page, `${tag}-spielplan-stationen`);
        if (role === "player") {
          const before = await page.locator("[data-testid^='schedule-line-']").count();
          await page.getByTestId("schedule-only-mine").click();
          await expect.poll(() => page.locator("[data-testid^='schedule-line-']").count()).toBeLessThan(before);
          await expect(page.locator("[data-testid^='schedule-line-']").first()).toBeVisible();
          await shot(page, `${tag}-spielplan-nur-meine`);
        } else if (role === "anon") {
          await expect(page.getByTestId("schedule-only-mine")).toHaveCount(0);
        }

        // Liga beendet und veröffentlicht: Podest mit geteiltem Platz 1, Sieger-Moment nur für Spieler 1 - einmal.
        await page.goto(`/tournaments/${slugs.league_published}`);
        if (role === "player") {
          const moment = page.getByTestId("placement-moment");
          await expect(moment).toBeVisible();
          await expect(moment).toContainText("Champion");
          await page.waitForTimeout(800);
          await shot(page, `${tag}-sieger-moment`);
          await page.getByTestId("placement-moment-close").click();
          await expect(moment).toHaveCount(0);
        } else {
          await page.waitForTimeout(1_500);
          await expect(page.getByTestId("placement-moment")).toHaveCount(0);
        }
        const podium = page.getByTestId("podium");
        await podium.scrollIntoViewIfNeeded();
        await expect(podium).toBeVisible();
        await expect(page.getByTestId("podium-provisional")).toHaveCount(0);
        await page.waitForTimeout(1_200);
        await noSideScroll(page);
        await shot(page, `${tag}-podest`);
        if (role === "player") {
          await page.reload();
          await expect(page.getByTestId("podium")).toBeVisible();
          await page.waitForTimeout(1_500);
          await expect(page.getByTestId("placement-moment")).toHaveCount(0);
        }
        await page.goto(`/tournaments/${slugs.league_published}/standings`);
        await expect(page.getByRole("table").first()).toBeVisible();
        await shot(page, `${tag}-liga-beendet-tabelle`);

        expect(problems).toEqual([]);
      });
    }
  }
});
