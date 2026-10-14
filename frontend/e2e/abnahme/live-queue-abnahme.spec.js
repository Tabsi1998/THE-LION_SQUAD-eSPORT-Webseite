const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test, expect, request: playwrightRequest } = require("@playwright/test");

// Abnahme Live vor Ort (#1556) gegen den echten Server (docs/entwicklung/abnahme-lokal.md), ohne nachgestellte API:
// Die Turnierleitung ruft an einer freien Station auf und startet, die Spielzeit-Uhr läuft ohne Neuladen; der Spieler
// sieht „Du bist als Nächstes …“; zwei Helfer rufen gleichzeitig auf - genau einer gewinnt; alles auch bei 375 px.
// Läuft nur mit ABNAHME=1 und E2E_BASE_URL auf einen Abnahme-Stand; Konten und Kennungen kommen aus
// .local-testing/abnahme/state.json (scripts/seed_abnahme.py), ABNAHME_STATE nimmt eine andere Datei.

const ENABLED = process.env.ABNAHME === "1";
const STATE_FILE = process.env.ABNAHME_STATE || path.join(__dirname, "..", "..", "..", ".local-testing", "abnahme", "state.json");
const SHOTS = process.env.ABNAHME_SHOTS || "";
const state = ENABLED && fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : null;

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

/** Anmelden wie im Browser - mit Zwei-Faktor; jeder Code zählt einmal, also notfalls aufs nächste Fenster warten. */
async function login(api, account) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = await api.post("/api/auth/login", { data: { email: account.email, password: account.password, remember: true } });
    expect(started.status(), await started.text()).toBe(200);
    const body = await started.json();
    if (!body.mfa_required) return;
    const done = await api.post("/api/auth/mfa/complete", { data: { ticket: body.mfa_ticket, code: totp(account.totp), client: "web" } });
    if (done.status() === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 31_000));
  }
  throw new Error(`Anmeldung ${account.email} nicht möglich`);
}

async function open(page, account) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  if (account) await login(page.request, account);
}

function watch(page) {
  const problems = [];
  page.on("pageerror", (error) => problems.push(`Seitenfehler: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") problems.push(`Konsole: ${message.text()}`); });
  page.on("response", (response) => {
    // 409 ist beim Aufrufen eine erwartete Antwort (Station inzwischen belegt) - alles andere ab 400 ist ein Fehler.
    if (response.status() >= 400 && response.status() !== 409 && response.url().includes("/api/")) {
      problems.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  return problems;
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

const seconds = (text) => {
  const parts = (String(text).match(/(\d+:)?(\d+):(\d\d)/) || []).slice(1);
  if (!parts.length) return null;
  const [hours, minutes, secs] = [parts[0] ? Number(parts[0].replace(":", "")) : 0, Number(parts[1]), Number(parts[2])];
  return hours * 3600 + minutes * 60 + secs;
};

test.describe("Abnahme: Live-Warteschlange vor Ort", () => {
  test.skip(!ENABLED || !state, "nur mit ABNAHME=1 und einem befüllten Abnahme-Stand");
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");
  test.describe.configure({ mode: "serial" });

  const tid = state?.tournaments?.local_live;
  const slug = state?.slugs?.local_live || tid;

  test("Turnierleitung: aufrufen, starten, die Uhr läuft (1440 px)", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const problems = watch(page);
    await open(page, state.accounts.lead);
    await page.goto(`/tournaments/${slug}/leitung`);
    await expect(page.getByTestId("lead-tab-stations")).toHaveAttribute("aria-selected", "true");
    const board = page.getByTestId("live-board");
    await expect(board).toBeVisible();

    // Die Uhr am laufenden Spiel tickt ohne Neuladen.
    const clock = board.locator("[role='timer']").first();
    await expect(clock).toBeVisible();
    const before = seconds(await clock.textContent());
    await page.waitForTimeout(2_500);
    expect(seconds(await clock.textContent())).toBeGreaterThan(before);
    await shot(page, "leitung-1440-vorher.png");

    // An einer freien Station das nächste bereite Spiel aufrufen …
    const call = board.locator("[data-testid^='live-call-']").first();
    await expect(call).toBeVisible();
    const stationId = (await call.getAttribute("data-testid")).replace("live-call-", "");
    await call.click();
    const next = page.getByTestId(`live-next-${stationId}`);
    await expect(next).toHaveAttribute("data-state", "called");
    await expect(next).toContainText("antreten bis");
    await expect(next).toContainText("nicht erschienen ab");
    await shot(page, "leitung-1440-aufgerufen.png");

    // … und starten: die Uhr dieser Station beginnt bei null.
    await page.getByTestId(`live-start-${stationId}`).click();
    const running = page.getByTestId(`live-running-${stationId}`);
    await expect(running).toBeVisible();
    const fresh = running.locator("[role='timer']");
    await expect.poll(async () => seconds(await fresh.textContent())).toBeLessThan(120);
    await shot(page, "leitung-1440-gestartet.png");
    expect(problems).toEqual([]);
  });

  test("zwei Helfer rufen gleichzeitig auf: genau ein Aufruf", async ({ baseURL }) => {
    test.setTimeout(150_000);
    const lead = await playwrightRequest.newContext({ baseURL });
    const admin = await playwrightRequest.newContext({ baseURL });
    try {
      await login(lead, state.accounts.lead);
      await login(admin, state.accounts.admin);
      // Runde 1 zu Ende spielen (wie die Turnierleitung im Ergebnis-Fenster) - dann sind die Läufe der Runde 2 bereit.
      const bracket = await (await lead.get(`/api/tournaments/${tid}/bracket`)).json();
      const open = (bracket.matches_v2 || []).filter((match) => Number(match.round) === 1 && !match.section?.startsWith?.("L")
        && !["completed", "forfeit", "bye", "cancelled"].includes(match.status));
      for (const match of open) {
        const ranking = (match.slots || []).map((slot) => slot.registration_id).filter(Boolean);
        const saved = await lead.post(`/api/matches/${match.id}/result`, { data: {
          results: ranking.map((registration, index) => ({ registration_id: registration, rank: index + 1, score: Math.max(0, 15 - 3 * index) })) } });
        expect(saved.status(), await saved.text()).toBe(200);
      }
      let queue = null;
      await expect.poll(async () => {
        queue = await (await lead.get(`/api/tournaments/${tid}/live-queue`)).json();
        return Object.values(queue.matches).filter((entry) => entry.state === "queued" && entry.ready).length;
      }, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
      const free = queue.stations.find((station) => !station.running && station.next?.state === "queued" && station.status === "free");
      const ready = Object.values(queue.matches).filter((entry) => entry.state === "queued" && entry.ready);
      test.skip(!free || ready.length < 2, "keine freie Station mit zwei bereiten Spielen mehr übrig");
      const [one, two] = ready;
      const answers = await Promise.all([
        lead.post(`/api/tournaments/${tid}/live-queue/call`, { data: { station_id: free.id, match_id: one.match_id } }),
        admin.post(`/api/tournaments/${tid}/live-queue/call`, { data: { station_id: free.id, match_id: two.match_id } }),
      ]);
      expect(answers.map((answer) => answer.status()).sort()).toEqual([200, 409]);
      const after = await (await lead.get(`/api/tournaments/${tid}/live-queue`)).json();
      const station = after.stations.find((row) => row.id === free.id);
      const winner = answers[0].status() === 200 ? one : two;
      expect(station.next.match_id).toBe(winner.match_id);
      expect(station.next.state).toBe("called");
      const called = Object.values(after.matches).filter((entry) => entry.state === "called" && entry.station_id === free.id);
      expect(called).toHaveLength(1);
    } finally {
      await lead.dispose();
      await admin.dispose();
    }
  });

  test("Spieler: „Du bist als Nächstes …“ auf Turnierseite und im Spielplan (375 px)", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 375, height: 812 });
    const problems = watch(page);
    await open(page, state.accounts.player);
    await page.goto(`/tournaments/${slug}`);
    const mine = page.getByTestId("tournament-my-stand").getByTestId("live-queue-status");
    await expect(mine).toBeVisible();
    await expect(mine).toContainText(/Du bist (als Nächstes an|dran)|Danach an|Später an|Läuft an/);
    await mine.scrollIntoViewIfNeeded();
    await shot(page, "spieler-375-turnierseite.png");

    await page.goto(`/tournaments/${slug}/matches`);
    await expect(page.getByTestId("live-queue-status")).toBeVisible();
    await page.getByTestId("schedule-view-stations").click();
    await expect(page.locator("[data-testid^='schedule-now-']").first()).toBeVisible();
    await shot(page, "spieler-375-spielplan-stationen.png");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(problems).toEqual([]);
  });

  test("Turnierleitung am Handy (375 px): Stationen, Uhr, nichts läuft quer", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 375, height: 812 });
    const problems = watch(page);
    await open(page, state.accounts.lead);
    await page.goto(`/tournaments/${slug}/leitung`);
    await expect(page.getByTestId("lead-tab-stations")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("lead-tab-results")).toBeInViewport();
    await expect(page.getByTestId("live-board").locator("[role='timer']").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(page, "leitung-375.png");

    // Matchplan: Warteschlange je Station und nur Prognose statt „Nachrücken planen“.
    await page.goto(`/admin/tournaments/${tid}?tab=matchplan`);
    await expect(page.getByTestId("mp-settings")).toBeVisible();
    await expect(page.getByTestId("mp-live-queue")).toBeVisible();
    await expect(page.getByRole("button", { name: "Nachrücken planen" })).toHaveCount(0);
    await shot(page, "matchplan-375.png");
    expect(problems).toEqual([]);
  });
});
