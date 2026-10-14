const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, state, signIn, watch } = require("./abnahmeSession");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Vor-Ort-Zugang (#1592). Die Turnierleitung sieht
// den Zugang an einem Mitglieder-Turnier vor Ort und druckt den Aushang. Eine Begleitperson ohne Mitgliedschaft scannt
// den QR-Code, sieht die schlanke Turnierseite, meldet sich an und spielt mit - danach das ganze Turnier. Nach dem
// Abmelden ist es wieder verborgen; ein erneuerter Code lässt den alten nicht mehr gelten.
// Läuft nur mit ABNAHME=1; Stand aus scripts/seed_abnahme.py (Turnier „onsite_members“, Konto „guest“).

const SHOTS = process.env.ABNAHME_SHOTS || "";
const DESKTOP = { width: 1440, height: 900 };
const HANDY = { width: 375, height: 812 };
const tid = state?.tournaments?.onsite_members;
const slug = state?.slugs?.onsite_members;

test.skip(!ENABLED || !tid, "Nur mit ABNAHME=1 und dem Mitglieder-Cup aus scripts/seed_abnahme.py");
test.describe.configure({ mode: "serial" });

async function shot(target, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function csrfHeaders(page) {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "csrf_token");
  return csrf ? { "X-CSRF-Token": decodeURIComponent(csrf.value) } : {};
}

async function onsiteState(page) {
  const response = await page.request.get(`/api/tournaments/${tid}/onsite-access`);
  expect(response.status()).toBe(200);
  return response.json();
}

test("Turnierleitung: Vor-Ort-Zugang an, Aushang zum Drucken", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page, "admin");
  const problems = watch(page);
  await page.goto(`/admin/tournaments/${tid}`);
  const panel = page.getByTestId("onsite-access-panel");
  await expect(panel).toBeVisible();
  if (!(await onsiteState(page)).enabled) await page.getByTestId("onsite-access-toggle").click();
  await expect(page.getByTestId("onsite-access-state")).toContainText("An");
  await panel.scrollIntoViewIfNeeded();
  await shot(panel, "admin-einstellung");

  await page.getByTestId("onsite-access-poster").click();
  const sheet = page.getByTestId("onsite-poster-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Scannen");
  const access = await onsiteState(page);
  await expect(sheet).not.toContainText(access.path.split("#")[1]);
  await page.emulateMedia({ media: "print" });
  await shot(sheet, "aushang-druck");
  await page.emulateMedia({ media: "screen" });
  await shot(page, "aushang-bildschirm");
  expect(problems).toEqual([]);
});

test("Begleitperson: scannen, schlanke Ansicht, anmelden, mitspielen - abmelden, dann wieder verborgen", async ({ browser }) => {
  const adminContext = await browser.newContext({ viewport: DESKTOP });
  const admin = await adminContext.newPage();
  await signIn(admin, "admin");
  const { path: qrPath } = await onsiteState(admin);
  const token = qrPath.split("#")[1];

  const context = await browser.newContext({ viewport: HANDY, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await signIn(page, "anon");
  // Ohne Zugang ist das Mitglieder-Turnier nicht sichtbar.
  expect((await page.request.get(`/api/tournaments/${slug}`)).status()).toBe(403);
  const problems = watch(page, { allow: (response) => [401, 403].includes(response.status()) });

  // QR-Code scannen: der Code verlässt die Adresse sofort und landet nie in einer URL.
  const requested = [];
  page.on("request", (request) => requested.push(request.url()));
  await page.goto(`/vor-ort#${token}`);
  await page.waitForURL(`**/tournaments/${slug}`);
  expect(page.url()).not.toContain(token);
  expect(requested.filter((url) => url.includes(token))).toEqual([]);
  const view = page.getByTestId("onsite-tournament-view");
  await expect(view).toBeVisible();
  await expect(page.getByTestId("onsite-seats")).toContainText("frei");
  await shot(page, "schlanke-ansicht-handy");

  // Ohne Konto: Mitspielen führt zum Login mit Rückweg - ohne Code.
  await page.getByTestId("onsite-register-btn").click();
  await page.waitForURL(/\/login\?next=/);
  expect(page.url()).not.toContain(token);
  await page.locator('input[type="email"]').fill(state.accounts.guest.email);
  await page.locator("#login-password").fill(state.accounts.guest.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(`**/tournaments/${slug}`);
  await expect(page.getByTestId("onsite-tournament-view")).toBeVisible();
  await shot(page, "schlanke-ansicht-angemeldet-handy");

  await page.getByTestId("onsite-register-btn").click();
  await expect(page.getByTestId("tournament-actions")).toBeVisible();
  await expect(page.getByTestId("onsite-tournament-view")).toHaveCount(0);
  expect((await page.request.get(`/api/tournaments/${tid}/bracket`)).status()).toBe(200);
  await shot(page, "teilnehmer-volle-ansicht-handy");

  // Die Leitung sieht die Anmeldung als „Vor Ort“.
  await admin.goto(`/admin/tournaments/${tid}`);
  await expect(admin.getByTestId("onsite-mark").first()).toBeVisible();

  // Abmelden: ohne Freigabe ist das Turnier wieder verborgen.
  const regs = await (await page.request.get(`/api/tournaments/${tid}/registrations`)).json();
  const mine = regs.find((row) => row.user?.username === state.accounts.guest.email.split("@")[0]);
  expect(mine).toBeTruthy();
  const removed = await page.request.delete(`/api/tournaments/${tid}/registrations/${mine.id}`, { headers: await csrfHeaders(page) });
  expect(removed.status(), await removed.text()).toBe(200);
  expect((await page.request.get(`/api/tournaments/${tid}/bracket`)).status()).toBe(403);
  await context.clearCookies({ name: "tls_onsite" });
  expect((await page.request.get(`/api/tournaments/${slug}`)).status()).toBe(403);
  expect(problems).toEqual([]);

  // Neuer Code: der alte gilt nicht mehr, der neue schon.
  const renewed = await admin.request.post(`/api/tournaments/${tid}/onsite-access/renew`, { headers: await csrfHeaders(admin) });
  expect(renewed.status()).toBe(200);
  const fresh = (await renewed.json()).path.split("#")[1];
  expect(fresh).not.toBe(token);
  await page.goto(`/vor-ort#${token}`);
  await expect(page.getByTestId("onsite-access-invalid")).toBeVisible();
  await shot(page, "alter-code-abgelehnt-handy");
  await page.goto(`/vor-ort#${fresh}`);
  await page.waitForURL(`**/tournaments/${slug}`);
  await expect(page.getByTestId("onsite-tournament-view")).toBeVisible();

  await context.close();
  await adminContext.close();
});
