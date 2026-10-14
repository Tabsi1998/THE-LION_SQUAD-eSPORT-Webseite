const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Abnahme gegen einen echten, lokal laufenden Server (docs/entwicklung/abnahme-lokal.md) - ohne nachgestellte API:
// Admin und Turnierleitung öffnen den Matchplan, wechseln zwischen „Matchplan“ und „Spiele“ hin und her, und die
// Ansicht bleibt stehen. Keine Konsolenfehler, keine Antwort 4xx/5xx. Läuft nur mit ABNAHME=1 und E2E_BASE_URL auf den
// Abnahme-Stand; Konten und Kennungen schreibt scripts/seed_abnahme.py nach .local-testing/abnahme/state.json.

const ENABLED = process.env.ABNAHME === "1";
const STATE_FILE = path.join(__dirname, "..", "..", "..", ".local-testing", "abnahme", "state.json");
const SHOTS = process.env.ABNAHME_SHOTS || "";
const state = ENABLED && fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : null;

// TOTP nach RFC 6238 (SHA-1, 30 Sekunden, 6 Stellen) - die Konten der Abnahme haben ein Test-Geheimnis.
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
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
}

async function login(page, account) {
  // Nur Nötiges bei den Cookies - wie ein vorsichtiger Besucher; der Hinweis verdeckt sonst die Seite.
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
    // Jeder Code zählt einmal (#1032): im selben 30-Sekunden-Fenster auf den nächsten warten.
    await page.waitForTimeout(31_000);
  }
  throw new Error(`Anmeldung ${account.email} mit Zwei-Faktor nicht möglich`);
}

function watch(page) {
  const problems = [];
  page.on("pageerror", (error) => problems.push(`Seitenfehler: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`Konsole: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("/api/")) problems.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  return problems;
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

const VIEWS = [
  { key: "local_draft", mode: "local", title: "vor Ort, Baum noch Vorschau" },
  { key: "local_live", mode: "local", title: "vor Ort, nach dem Check-in-Ende, live" },
  { key: "online", mode: "online", title: "online" },
  { key: "league", mode: "league", title: "Liga" },
];

async function expectView(page, mode) {
  await expect(page.locator(".mp")).toHaveAttribute("data-mode", mode);
  if (mode === "local") {
    await expect(page.getByTestId("mp-flow").getByRole("button").first()).toBeVisible();
    await expect(page.getByTestId("mp-order").getByRole("row").nth(1)).toBeVisible();
  } else if (mode === "online") {
    await expect(page.getByTestId("mp-online").getByRole("listitem").first()).toBeVisible();
  } else {
    await expect(page.getByTestId("mp-league").getByTestId(/^mp-week-/).first()).toBeVisible();
  }
}

test.describe("Abnahme: Matchplan gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state, `Kein Seed-Stand: ${STATE_FILE} fehlt - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  for (const role of ["admin", "lead"]) {
    for (const view of VIEWS) {
      test(`${role === "admin" ? "Admin" : "Turnierleitung"}: ${view.title} - Matchplan ↔ Spiele, Ansicht bleibt stehen`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "chromium", "Größe stellt der Test selbst ein");
        await page.setViewportSize({ width: 1440, height: 900 });
        await login(page, state.accounts[role]);
        const problems = watch(page);
        const tid = state.tournaments[view.key];
        await page.goto(`/admin/tournaments/${tid}?tab=matchplan`);
        await expect(page.getByTestId("mp-settings")).toBeVisible();
        await expectView(page, view.mode);
        // Erst die Antwort des Planers abwarten - danach darf nichts mehr springen.
        await page.waitForTimeout(2_000);
        await expectView(page, view.mode);
        await shot(page, `${role}-${view.key}-matchplan.png`);

        for (let round = 0; round < 3; round += 1) {
          await page.getByTestId("admin-tr-tab-stages").click();
          await expect(page.getByTestId("stages-matchplan-hint")).toBeVisible();
          await expect(page.getByText("Planung speichern")).toHaveCount(0);
          await expect(page.getByLabel("Dauer in Minuten")).toHaveCount(0);
          await page.getByTestId("admin-tr-tab-matchplan").click();
          await expectView(page, view.mode);
          await page.waitForTimeout(1_500);
          await expectView(page, view.mode);
        }
        await page.getByTestId("admin-tr-tab-stages").click();
        await shot(page, `${role}-${view.key}-spiele.png`);
        expect(problems).toEqual([]);
      });
    }
  }
});
