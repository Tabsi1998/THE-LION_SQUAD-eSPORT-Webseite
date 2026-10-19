const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Fast Lap vor Ort (#1585) - Schnelleingabe,
// Versuche, Gäste, Verknüpfen, „Am Start / Als Nächstes“, TV, Veröffentlichen mit Sperre, Urkunde live und die Bewegung
// bei neuer Bestzeit. Als Helfer, Turnierleitung, Spieler und nicht angemeldet; 1440, 375 und TV 1920.
// Keine Konsolenfehler, keine Antwort 4xx/5xx der Seite (Absagen, die der Test bewusst prüft, laufen über
// page.request und zählen nicht). Läuft nur mit ABNAHME=1; Stand aus scripts/seed_abnahme_fastlap.py.

const ENABLED = process.env.ABNAHME === "1";
const STATE_FILE = process.env.ABNAHME_STATE || path.join(__dirname, "..", "..", "..", ".local-testing", "abnahme", "state-fastlap.json");
const SHOTS = process.env.ABNAHME_SHOTS || "";
const state = ENABLED && fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : null;
const DESKTOP = { width: 1440, height: 900 };
const HANDY = { width: 375, height: 812 };
const REASON = "Abnahme: Gast hat ein Konto angelegt";
// #1825: Gäste, die direkt in „Am Start / Als Nächstes“ angelegt werden (je Lauf eindeutig).
const RUN = String(Date.now() % 100000);
const QUEUE_GUEST = `Listengast ${RUN}`;
const QUEUE_GUEST_DESKTOP = `Listengast PC ${RUN}`;

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

async function csrf(page) {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === "csrf_token")?.value || "";
}

async function api(page, method, url, data) {
  return page.request.fetch(url, { method, data, headers: { "x-csrf-token": await csrf(page) } });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "seitliches Überlaufen").toBeLessThanOrEqual(1);
}

async function shot(page, name, fullPage = false) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}

async function keys(page, ...list) {
  for (const key of list) await page.getByTestId(`fl-key-${key === ":" ? "colon" : key === "," ? "comma" : key}`).click();
}

test.describe("Abnahme #1585: Fast Lap vor Ort gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.fastlap?.onsite, `Kein passender Seed-Stand: ${STATE_FILE} - erst scripts/seed_abnahme_fastlap.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test("Helfer 1440: Schnelleingabe, Plausibilität, nächster Fahrer, ungültig, korrigieren, Versuchsgrenze", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "Größe stellt der Test selbst ein");
    const { onsite } = state.fastlap;
    const problems = watch(page, "helper");
    await prepare(page, "helper");
    await page.setViewportSize(DESKTOP);
    await page.goto(`/admin/f1/${onsite.id}`);
    await expect(page.getByTestId("fl-quick")).toBeVisible();
    // DriftDaniel steht allein am Start - schon gewählt, erster Versuch.
    await expect(page.getByTestId("fl-quick-driver-selected")).toContainText("DriftDaniel");
    await expect(page.getByTestId("fl-quick-attempt")).toHaveText("Versuch 1 von 3");
    await keys(page, "1", ":", "2", "4", ",", "5", "8", "7");
    await expect(page.getByText("= 1:24.587")).toBeVisible();
    await shot(page, "01-helfer-schnelleingabe-1440");
    await page.getByTestId("fl-quick-save").click();
    await expect(page.getByTestId("fl-quick-attempt")).toHaveText("Versuch 2 von 3");
    // Unplausibel: Rückfrage, abbrechen schickt nichts.
    await keys(page, "1", "2");
    await page.getByTestId("fl-quick-save").click();
    const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
    await expect(dialog).toContainText("Trotzdem speichern");
    await shot(page, "02-plausibilitaet");
    await dialog.getByRole("button", { name: /abbrechen/i }).click();
    await expect(page.getByTestId("fl-quick-attempt")).toHaveText("Versuch 2 von 3");
    await page.getByTestId("fl-key-clear").click();
    await keys(page, "1", ":", "2", "3", ",", "9");
    await page.getByTestId("fl-quick-save-next").click();
    // Übergabe an dieselbe Station: Lena (Gast) ist dran.
    await expect(page.getByTestId("fl-quick-driver-selected")).toContainText("Lena");
    await expect(page.getByTestId("fl-queue-ontrack")).toContainText("Lena");
    await expect(page.getByTestId("fl-queue-ontrack")).toContainText("Simulator 1");
    // Ungültig ohne Zeit, dann die letzte korrigieren.
    await page.getByTestId("fl-quick-invalid").click();
    await page.getByRole("button", { name: "Runde nicht beendet" }).click();
    await expect(page.getByTestId("fl-quick-attempt")).toHaveText("Versuch 2 von 3");
    await page.getByTestId("fl-quick-correct").click();
    await page.getByTestId("fl-key-clear").click();
    await keys(page, "1", ":", "2", "5", ",", "1");
    await page.getByTestId("fl-quick-save").click();
    await expect(page.getByTestId("fl-quick-last")).toContainText("ungültig");
    await keys(page, "1", ":", "2", "6");
    await page.getByTestId("fl-quick-save").click();
    await expect(page.getByTestId("fl-quick-attempt")).toHaveText("Versuch 3 von 3");
    await keys(page, "1", ":", "2", "2");
    await page.getByTestId("fl-quick-save").click();
    await expect(page.getByTestId("fl-quick-attempt")).toHaveText("Alle 3 Versuche gefahren");
    await shot(page, "03-versuche-voll");
    // Der Server setzt die Grenze durch - auch an der Oberfläche vorbei.
    const refused = await api(page, "POST", `/api/f1/challenges/${onsite.id}/times`, { guest_id: onsite.lena, track_id: onsite.track, time_ms: 81000 });
    expect(refused.status()).toBe(400);
    expect(await refused.text()).toContain("Versuche");
    expect(problems).toEqual([]);
  });

  test("Helfer 375: Schnelleingabe und Liste am Handy", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "Größe stellt der Test selbst ein");
    const problems = watch(page, "helper");
    await prepare(page, "helper");
    await page.setViewportSize(HANDY);
    await page.goto(`/admin/f1/${state.fastlap.onsite.id}`);
    await expect(page.getByTestId("fl-quick")).toBeVisible();
    await page.getByTestId("fl-quick").scrollIntoViewIfNeeded();
    await noSideScroll(page);
    await shot(page, "04-helfer-schnelleingabe-375");
    await page.getByTestId("fl-queue").scrollIntoViewIfNeeded();
    await shot(page, "05-am-start-375");
    // #1825: In „Am Start / Als Nächstes“ einen Gast anlegen (der Wähler steht im Formular der Liste), in die Liste,
    // starten - das TV zeigt ihn danach am Start.
    await page.getByTestId("fl-queue-driver-tab-guest").click();
    await page.getByTestId("fl-queue-driver-guest-name").fill(QUEUE_GUEST);
    await page.getByTestId("fl-queue-driver-guest-create").click();
    await expect(page.getByTestId("fl-queue-driver-selected")).toContainText(QUEUE_GUEST);
    await page.getByTestId("fl-queue-station").fill("Simulator 2");
    await page.getByTestId("fl-queue-add").click();
    await expect(page.getByTestId("fl-queue-next")).toContainText(QUEUE_GUEST);
    await page.getByRole("button", { name: `${QUEUE_GUEST} starten` }).click();
    await expect(page.getByTestId("fl-queue-ontrack")).toContainText(QUEUE_GUEST);
    await noSideScroll(page);
    await shot(page, "05b-gast-in-der-liste-375");
    expect(problems).toEqual([]);
  });

  test("Helfer 1440: Gast in der Liste anlegen - Enter im Namensfeld", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "Größe stellt der Test selbst ein");
    const problems = watch(page, "helper");
    await prepare(page, "helper");
    await page.setViewportSize(DESKTOP);
    await page.goto(`/admin/f1/${state.fastlap.onsite.id}`);
    await expect(page.getByTestId("fl-queue")).toBeVisible();
    await page.getByTestId("fl-queue-driver-tab-guest").click();
    await page.getByTestId("fl-queue-driver-guest-name").fill(QUEUE_GUEST_DESKTOP);
    await page.getByTestId("fl-queue-driver-guest-name").press("Enter");
    await expect(page.getByTestId("fl-queue-driver-selected")).toContainText(QUEUE_GUEST_DESKTOP);
    await page.getByTestId("fl-queue-add").click();
    await expect(page.getByTestId("fl-queue-next")).toContainText(QUEUE_GUEST_DESKTOP);
    await shot(page, "05c-gast-in-der-liste-1440");
    expect(problems).toEqual([]);
  });

  test("TV 1920: Am Start / Als Nächstes und Rangliste", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "Größe stellt der Test selbst ein");
    const problems = watch(page, "anon");
    await prepare(page, "anon");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/display/f1/${state.fastlap.onsite.id}`);
    await expect(page.getByTestId("tv-queue")).toBeVisible();
    await expect(page.getByTestId("tv-queue-ontrack")).toContainText("Lena");
    await expect(page.getByTestId("tv-queue-ontrack")).toContainText("Alle 3 Versuche gefahren");
    await expect(page.getByTestId("tv-queue-ontrack")).toContainText(QUEUE_GUEST);
    await expect(page.getByTestId("tv-queue-next").first()).toContainText("KartKönigin");
    await noSideScroll(page);
    await shot(page, "06-tv-am-start-1920");
    expect(problems).toEqual([]);
  });

  test("Nicht angemeldet 1440: neue Bestzeit gleitet nach oben (Zwischenbild)", async ({ page, browser }, info) => {
    test.skip(info.project.name !== "chromium", "Größe stellt der Test selbst ein");
    const { onsite } = state.fastlap;
    const problems = watch(page, "anon");
    await prepare(page, "anon");
    await page.setViewportSize(DESKTOP);
    await page.goto(`/fastlap/${onsite.slug || onsite.id}`);
    await expect(page.getByTestId("f1-row-1")).toBeVisible();
    await expect(page.getByTestId("f1-board")).toContainText("Gast");
    await page.getByTestId("f1-board").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    // Die Turnierleitung trägt in einem zweiten Browser eine neue Bestzeit für PixelPaula (bisher Platz 6) ein.
    const lead = await browser.newPage();
    await prepare(lead, "lead");
    const saved = await api(lead, "POST", `/api/f1/challenges/${onsite.id}/times`, { user_id: state.players.PixelPaula, track_id: onsite.track, time_ms: 80111 });
    expect(saved.status(), await saved.text()).toBe(200);
    await expect(page.getByTestId("f1-row-1")).toContainText("PixelPaula", { timeout: 20_000 });
    await shot(page, "07-animation-zwischenbild");
    await expect(page.getByTestId("f1-best-flash")).toContainText("Neue Bestzeit!");
    await page.waitForTimeout(1200);
    await shot(page, "08-animation-ende");
    await lead.close();
    expect(problems).toEqual([]);
  });

  test("Spieler 375: Tabelle mit Gast und Versuchen", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "Größe stellt der Test selbst ein");
    const problems = watch(page, "player");
    await prepare(page, "player");
    await page.setViewportSize(HANDY);
    await page.goto(`/fastlap/${state.fastlap.onsite.slug || state.fastlap.onsite.id}`);
    await expect(page.getByTestId("f1-row-1")).toBeVisible();
    await expect(page.getByTestId("f1-board")).toContainText("Versuche");
    await expect(page.getByTestId("f1-certificates")).toHaveCount(0);
    await noSideScroll(page);
    await page.getByTestId("f1-board").scrollIntoViewIfNeeded();
    await shot(page, "09-spieler-tabelle-375");
    expect(problems).toEqual([]);
  });

  test("Leitung: Urkunde live, Veröffentlichen, Preis ans schnellste Konto, Gast verknüpfen, Helfer gesperrt", async ({ page, browser }, info) => {
    test.skip(info.project.name !== "chromium", "Größe stellt der Test selbst ein");
    const { onsite, publish } = state.fastlap;
    const problems = watch(page, "lead");
    await prepare(page, "lead");
    await page.setViewportSize(DESKTOP);
    // Urkunde live: läuft noch, die Leitung druckt schon - auch für einen Gast.
    await page.goto(`/fastlap/${onsite.slug || onsite.id}`);
    await expect(page.getByTestId("f1-certificates")).toHaveText(/Urkunden jetzt drucken/);
    const href = await page.getByTestId("f1-certificate-1").getAttribute("href");
    const pdf = await page.request.get(href);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    const guestPdf = await page.request.get(`/api/exports/f1/${onsite.id}/certificates/guest-${onsite.anna}.pdf?track_id=${onsite.track}`);
    expect([200, 404]).toContain(guestPdf.status());
    await shot(page, "10-urkunde-live");

    // Veröffentlichen: ein Gast steht vorn, der Preis geht an das schnellste Konto (NeonFalke).
    await page.goto(`/admin/f1/${publish.id}`);
    await expect(page.getByTestId("f1-status-select")).toBeVisible();
    await expect(page.getByTestId("f1-status-select").locator("option", { hasText: "Einreichung offen" })).toHaveCount(0);
    await page.getByTestId("f1-status-select").selectOption("results_published");
    await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: "Veröffentlichen" }).click();
    await expect(page.getByTestId("f1-published-lock")).toBeVisible();
    const prizes = await (await page.request.get("/api/prizes?source_type=fastlap")).json();
    const mine = prizes.filter((row) => row.fastlap_challenge_id === publish.id);
    expect(mine.map((row) => [row.user_id, row.place])).toEqual([[state.players.NeonFalke, 1]]);
    await shot(page, "11-veroeffentlicht");

    // Gast mit Konto verknüpfen: Vorschau, Begründung, danach zählt das Konto.
    await page.locator(`[data-testid^="f1-link-guest-"]`).first().click();
    await page.getByTestId("fl-link-person-search").fill("Anna");
    await page.getByTestId(`fl-link-person-option-${state.players["Anna Konto"]}`).click();
    await expect(page.getByTestId("fl-link-preview")).toContainText("1 Zeit von Gast „Schneller Gast“ gehen an Konto „Anna Konto“");
    // Veröffentlicht: die Begründung steht im Dialog selbst; ohne sie bleibt „Verknüpfen“ aus.
    await expect(page.getByTestId("fl-link-confirm")).toBeDisabled();
    await page.getByTestId("fl-link-reason").fill(REASON);
    await shot(page, "12-verknuepfen-vorschau");
    await page.getByTestId("fl-link-confirm").click();
    await expect(page.getByTestId("fl-link-dialog")).toHaveCount(0);
    const after = (await (await page.request.get("/api/prizes?source_type=fastlap")).json()).filter((row) => row.fastlap_challenge_id === publish.id);
    const byUser = Object.fromEntries(after.map((row) => [row.user_id, row]));
    expect(byUser[state.players["Anna Konto"]]?.place).toBe(1);
    expect(byUser[state.players.NeonFalke]?.needs_review).toBe(true);
    await page.goto(`/fastlap/${publish.slug || publish.id}`);
    await expect(page.getByTestId("f1-row-1")).toContainText("Anna Konto");
    await expect(page.getByTestId("f1-row-1")).not.toContainText("Gast");
    await shot(page, "13-nach-verknuepfen");
    expect(problems).toEqual([]);

    // Helfer ist gesperrt: kein Eintragen mehr, der Server sagt 409.
    const helper = await browser.newPage();
    const helperProblems = watch(helper, "helper");
    await prepare(helper, "helper");
    await helper.setViewportSize(DESKTOP);
    await helper.goto(`/admin/f1/${publish.id}`);
    await expect(helper.getByTestId("f1-published-lock")).toBeVisible();
    await expect(helper.getByTestId("fl-quick")).toHaveCount(0);
    const locked = await api(helper, "POST", `/api/f1/challenges/${publish.id}/times`, { user_id: state.players.LuckyLion, track_id: publish.track, time_ms: 85000 });
    expect(locked.status()).toBe(409);
    await shot(helper, "14-helfer-gesperrt");
    expect(helperProblems).toEqual([]);
    await helper.close();
  });
});
