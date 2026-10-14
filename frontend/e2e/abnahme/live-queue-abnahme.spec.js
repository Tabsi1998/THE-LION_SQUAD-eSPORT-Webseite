const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, state, signIn, watch } = require("./abnahmeSession");

// Abnahme Live vor Ort (#1556) gegen den echten Server (docs/entwicklung/abnahme-lokal.md), ohne nachgestellte API:
// Die Turnierleitung ruft an einer freien Station auf und startet, die Spielzeit-Uhr läuft ohne Neuladen; zwei Helfer
// rufen gleichzeitig auf - genau einer gewinnt; der Spieler sieht „Du bist als Nächstes …“; alles auch bei 375 px.
// Läuft nur mit ABNAHME=1 und E2E_BASE_URL auf einen frisch befüllten Abnahme-Stand (scripts/seed_abnahme.py).

const SHOTS = process.env.ABNAHME_SHOTS || "";

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

const seconds = (text) => {
  const match = String(text).match(/(?:(\d+):)?(\d+):(\d\d)/);
  return match ? Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
};

/** Schreiben wie die Website: mit dem CSRF-Kopf aus dem Cookie der Sitzung. */
async function post(page, url, data) {
  const cookies = await page.context().cookies();
  const csrf = decodeURIComponent(cookies.find((cookie) => cookie.name === "csrf_token")?.value || "");
  return page.request.post(url, { data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
}

// 409 ist beim Aufrufen eine erwartete Antwort (Station inzwischen belegt).
const allow = (response) => response.status() === 409 && /live-queue\/(call|start)/.test(response.url());

test.describe("Abnahme: Live-Warteschlange vor Ort", () => {
  test.skip(!ENABLED || !state, "nur mit ABNAHME=1 und einem befüllten Abnahme-Stand");
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");
  test.describe.configure({ mode: "serial" });

  const tid = state?.tournaments?.local_live;
  const slug = state?.slugs?.local_live || tid;

  test("Turnierleitung: aufrufen, starten, die Uhr läuft (1440 px)", async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signIn(page, "lead");
    const problems = watch(page, { allow });
    await page.goto(`/tournaments/${slug}/leitung`);
    await expect(page.getByTestId("lead-tab-stations")).toHaveAttribute("aria-selected", "true");
    const board = page.getByTestId("live-board");

    // Die Uhr am laufenden Spiel tickt ohne Neuladen.
    const clock = board.locator("[role='timer']").first();
    await expect(clock).toBeVisible();
    const before = seconds(await clock.textContent());
    await expect.poll(async () => seconds(await clock.textContent()), { timeout: 6_000 }).toBeGreaterThan(before);
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
    const fresh = page.getByTestId(`live-running-${stationId}`).locator("[role='timer']");
    await expect(fresh).toBeVisible();
    await expect.poll(async () => seconds(await fresh.textContent())).toBeLessThan(120);
    await shot(page, "leitung-1440-gestartet.png");
    expect(problems).toEqual([]);
  });

  test("zwei Helfer rufen gleichzeitig auf: genau ein Aufruf", async ({ browser }) => {
    test.setTimeout(200_000);
    const leadContext = await browser.newContext();
    const adminContext = await browser.newContext();
    try {
      const lead = await leadContext.newPage();
      const admin = await adminContext.newPage();
      await signIn(lead, "lead");
      await signIn(admin, "admin");
      // Runde 1 zu Ende spielen (wie im Ergebnis-Fenster) - dann sind die Läufe der nächsten Runde bereit.
      const bracket = await (await lead.request.get(`/api/tournaments/${tid}/bracket`)).json();
      const open = (bracket.matches_v2 || []).filter((match) => Number(match.round) === 1 && String(match.section || "").toUpperCase() !== "LB"
        && !["completed", "forfeit", "bye", "cancelled"].includes(match.status));
      for (const match of open) {
        const ranking = (match.slots || []).map((slot) => slot.registration_id).filter(Boolean);
        const saved = await post(lead, `/api/matches/${match.id}/result`, {
          results: ranking.map((registration, index) => ({ registration_id: registration, rank: index + 1, score: Math.max(0, 15 - 3 * index) })) });
        expect(saved.status(), await saved.text()).toBe(200);
      }
      let free = null;
      let ready = [];
      await expect.poll(async () => {
        const queue = await (await lead.request.get(`/api/tournaments/${tid}/live-queue`)).json();
        free = queue.stations.find((station) => !station.running && station.next?.state !== "called" && station.status === "free");
        ready = Object.values(queue.matches).filter((entry) => entry.state === "queued" && entry.ready);
        return Boolean(free) && ready.length >= 2;
      }, { timeout: 60_000 }).toBe(true);
      const [one, two] = ready;
      const answers = await Promise.all([
        post(lead, `/api/tournaments/${tid}/live-queue/call`, { station_id: free.id, match_id: one.match_id }),
        post(admin, `/api/tournaments/${tid}/live-queue/call`, { station_id: free.id, match_id: two.match_id }),
      ]);
      expect(answers.map((answer) => answer.status()).sort(), (await Promise.all(answers.map((answer) => answer.text()))).join(" | ")).toEqual([200, 409]);
      const after = await (await lead.request.get(`/api/tournaments/${tid}/live-queue`)).json();
      const winner = answers[0].status() === 200 ? one : two;
      expect(after.stations.find((row) => row.id === free.id).next).toMatchObject({ match_id: winner.match_id, state: "called" });
      expect(Object.values(after.matches).filter((entry) => entry.state === "called" && entry.station_id === free.id)).toHaveLength(1);
    } finally {
      await leadContext.close();
      await adminContext.close();
    }
  });

  test("Spieler: „Du bist als Nächstes …“ auf Turnierseite und im Spielplan (375 px)", async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page, "player");
    const problems = watch(page, { allow });
    await page.goto(`/tournaments/${slug}`);
    const mine = page.getByTestId("tournament-my-stand").getByTestId("live-queue-status");
    await expect(mine).toBeVisible();
    await expect(mine).toContainText(/Du bist (als Nächstes an|dran)|Danach an|Später an|Läuft an|Dein nächstes Spiel/);
    await mine.scrollIntoViewIfNeeded();
    await shot(page, "spieler-375-turnierseite.png");

    await page.goto(`/tournaments/${slug}/matches`);
    await expect(page.getByTestId("live-queue-status")).toBeVisible();
    await page.getByTestId("schedule-view-stations").click();
    await expect(page.locator("[data-testid^='schedule-now-']").first()).toBeVisible();
    await shot(page, "spieler-375-spielplan-stationen.png");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    expect(problems).toEqual([]);
  });

  test("Turnierleitung am Handy (375 px): Stationen, Uhr, Matchplan nur Prognose", async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page, "lead");
    const problems = watch(page, { allow });
    await page.goto(`/tournaments/${slug}/leitung`);
    await expect(page.getByTestId("lead-tab-stations")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("lead-tab-results")).toBeInViewport();
    await expect(page.getByTestId("live-board").locator("[role='timer']").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await shot(page, "leitung-375.png");

    await page.goto(`/admin/tournaments/${tid}?tab=matchplan`);
    await expect(page.getByTestId("mp-settings")).toBeVisible();
    await expect(page.getByTestId("mp-live-queue")).toBeVisible();
    await expect(page.getByRole("button", { name: "Nachrücken planen" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Prognose ansehen/ }).first()).toBeVisible();
    await shot(page, "matchplan-375.png");
    expect(problems).toEqual([]);
  });
});
