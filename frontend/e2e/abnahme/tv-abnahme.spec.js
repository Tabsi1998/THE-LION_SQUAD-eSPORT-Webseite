const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, state, signIn, watch } = require("./abnahmeSession");

// Abnahme Turnierbaum-TV (#1634) gegen den echten Server (docs/entwicklung/abnahme-lokal.md), ohne nachgestellte API:
// Der TV läuft mit echtem Anzeige-Schlüssel (angelegt wie im Admin unter „TV & Beamer“) und bekommt alles über den
// Änderungsstrom - nie neu geladen. Show-Auslosung: die Runde wird fertig, der TV zeigt „Auslosung bereit · N Namen“,
// die Leitung lost, der TV zeigt die Auslosung. Sofort zufällig: ein Ergebnis, der TV zeigt den gezogenen Platz.
// Live-Warteschlange: Aufruf und Start an einer Station, die Bahn am TV zieht nach. Je Fall zwei Bildschirme zugleich,
// 1920×1080 und 2560×1440. Läuft nur mit ABNAHME=1 auf einem frisch befüllten Stand (scripts/seed_abnahme.py).

const SHOTS = process.env.ABNAHME_SHOTS || "";
const SCREENS = { fhd: { width: 1920, height: 1080 }, qhd: { width: 2560, height: 1440 } };
// Was ein Moment braucht, bis er sichtbar ist: Nachladen über den Strom plus Ergebnis-Moment davor.
const TV_WAIT = 60_000;

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
}

/** Schreiben wie die Website: mit dem CSRF-Kopf aus dem Cookie der Sitzung. */
async function post(page, url, data) {
  const cookies = await page.context().cookies();
  const csrf = decodeURIComponent(cookies.find((cookie) => cookie.name === "csrf_token")?.value || "");
  return page.request.post(url, { data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
}

async function matchesOf(page, tid) {
  const response = await page.request.get(`/api/tournaments/${tid}/matches-v2`);
  expect(response.status(), await response.text()).toBe(200);
  const rows = (await response.json()).filter((row) => !row.is_preview);
  return Object.fromEntries(rows.map((row) => [row.match_key, row]));
}

const seated = (match) => (match.slots || []).filter((slot) => slot.registration_id).map((slot) => slot.registration_id);

/** Ein Ergebnis wie aus dem Ergebnis-Fenster - und warten, bis es gilt (Ablage), wie advancement-modes-abnahme. */
async function enterResult(page, match) {
  const players = seated(match);
  const saved = await post(page, `/api/matches/${match.id}/result`, {
    results: players.map((registration, index) => ({ registration_id: registration, rank: index + 1, score: Math.max(0, 15 - 3 * index) })),
  });
  expect(saved.status(), await saved.text()).toBe(200);
  await expect.poll(async () => {
    const row = (await matchesOf(page, match.tournament_id))[match.match_key];
    return row?.pending_result ? "hält noch" : row?.status;
  }, { message: `Ergebnis für ${match.match_key} wurde nicht veröffentlicht`, timeout: 40_000 }).toMatch(/^(completed|forfeit)$/);
}

/** Ein Anzeige-Schlüssel je Turnier, angelegt vom Admin über die echte Route (wie „TV & Beamer → Neuer Link“). */
async function tvPath(admin, tid) {
  const created = await post(admin, "/api/tv/keys", { tournament_id: tid, label: "Abnahme-TV #1634" });
  expect(created.status(), await created.text()).toBe(200);
  return (await created.json()).path;
}

// Der TV meldet sich nicht an: 401 von /auth gehört dazu, sonst kein Fehler.
const allowTv = (response) => response.status() === 401 && /\/api\/auth\//.test(response.url());
const allowTvConsole = (text) => /401/.test(text);

/**
 * Zwei Bildschirme (1920×1080 und 2560×1440) mit demselben TV-Link. Jeder merkt sich jeden Moment (`data-moment`) in
 * `window.__tvMoments` - so verpasst die Prüfung keinen kurzen - und trägt eine Marke, die ein Neuladen löschen würde.
 */
async function openScreens(browser, url) {
  const screens = [];
  for (const [name, viewport] of Object.entries(SCREENS)) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await signIn(page, "anon");
    await page.addInitScript(() => {
      window.__tvMoments = [];
      window.setInterval(() => {
        const moment = document.querySelector("[data-testid='tv-main']")?.getAttribute("data-moment") || "";
        if (moment && window.__tvMoments[window.__tvMoments.length - 1] !== moment) window.__tvMoments.push(moment);
      }, 40);
    });
    const problems = watch(page, { allow: allowTv, allowConsole: allowTvConsole });
    await page.goto(url);
    await expect(page.getByTestId("bracket-tv")).toBeVisible();
    await page.evaluate(() => { window.__tvLoaded = "einmal"; });
    screens.push({ name, page, context, problems });
  }
  return screens;
}

async function closeScreens(screens) {
  for (const screen of screens) {
    // Nichts neu geladen, keine Fehler, kein Wort abgeschnitten (kein „…“ am TV).
    expect(await screen.page.evaluate(() => window.__tvLoaded)).toBe("einmal");
    expect(await screen.page.evaluate(() => document.body.innerText.includes("…"))).toBe(false);
    expect(screen.problems).toEqual([]);
    await screen.context.close();
  }
}

const moments = (page) => page.evaluate(() => window.__tvMoments);

test.describe("Abnahme: Turnierbaum-TV mit Auslosung und Live-Warteschlange (#1634)", () => {
  test.skip(!ENABLED || !state, "nur mit ABNAHME=1 und einem befüllten Abnahme-Stand");
  test.skip(({ isMobile }) => Boolean(isMobile), "Größen stellt der Test selbst ein");
  test.skip(ENABLED && !state?.tournaments?.mode_draw_show, "Stand ohne die Modus-Turniere - scripts/seed_abnahme.py neu laufen lassen");
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  // Die TV-Links legt der Admin in einer eigenen Sitzung an - die Turnierleitung meldet sich danach frisch an.
  const paths = {};
  test.beforeAll(async ({ browser }) => {
    if (!ENABLED || !state?.tournaments?.mode_draw_show) return;
    const context = await browser.newContext();
    const admin = await context.newPage();
    await signIn(admin, "admin");
    for (const key of ["mode_draw_show", "mode_instant", "local_live"]) paths[key] = await tvPath(admin, state.tournaments[key]);
    await context.close();
  });

  test("Show-Auslosung: Runde fertig → „Auslosung bereit“ steht, Zielspiele leuchten; Los → Auslosungs-Moment", async ({ browser, page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "ein Lauf genügt");
    const tid = state.tournaments.mode_draw_show;
    const url = paths.mode_draw_show;
    const screens = await openScreens(browser, `${url}&playlist=tree-60`);
    try {
      for (const screen of screens) await expect(screen.page.getByTestId("tv-tree")).toBeVisible();
      await signIn(page, "lead");
      const before = await matchesOf(page, tid);
      const open = Object.values(before).find((row) => row.round === 1 && row.section === "WB" && !["completed", "forfeit"].includes(row.status));
      expect(open, "ein Lauf der Runde 1 ist noch offen").toBeTruthy();
      await enterResult(page, open);

      for (const screen of screens) {
        const banner = screen.page.locator("[data-testid='tv-live-banner'][data-kind='ready']");
        await expect(banner).toBeVisible({ timeout: TV_WAIT });
        await expect(banner).toContainText("Auslosung bereit · 8 Namen");
        await expect(screen.page.locator("[data-ready='1']").first()).toBeVisible();
        await expect.poll(() => moments(screen.page), { timeout: TV_WAIT }).toContain("draw_ready");
      }
      // Der Moment ist vorbei - der Hinweis steht weiter, bis gelost ist.
      for (const screen of screens) {
        await expect(screen.page.getByTestId("tv-main")).not.toHaveAttribute("data-moment", /.+/, { timeout: 20_000 });
        await expect(screen.page.locator("[data-testid='tv-live-banner'][data-kind='ready']")).toBeVisible();
        await shot(screen.page, `tv-show-bereit-${screen.name}.png`);
      }

      const targets = Object.values(await matchesOf(page, tid)).filter((row) => row.draw_ready && typeof row.draw_ready === "object");
      expect(targets.length).toBeGreaterThan(0);
      const drawn = await post(page, `/api/tournaments/${tid}/stages/${targets[0].stage_id}/draw`, { group: targets[0].draw_ready.group });
      expect(drawn.status(), await drawn.text()).toBe(200);
      for (const screen of screens) {
        await expect.poll(() => moments(screen.page), { timeout: TV_WAIT }).toContain("draw");
        await expect(screen.page.locator("[data-testid='tv-live-banner']")).toContainText("Auslosung ·", { timeout: TV_WAIT });
        await shot(screen.page, `tv-show-gelost-${screen.name}.png`);
        await expect(screen.page.locator("[data-testid='tv-live-banner'][data-kind='ready']")).toHaveCount(0);
        await expect(screen.page.locator("[data-ready='1']")).toHaveCount(0);
      }
    } finally {
      await closeScreens(screens);
    }
  });

  test("Sofort zufällig: Ergebnis → der TV zeigt, wer auf welchen Platz gezogen wurde", async ({ browser, page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "ein Lauf genügt");
    const tid = state.tournaments.mode_instant;
    const url = paths.mode_instant;
    const screens = await openScreens(browser, `${url}&playlist=tree-60`);
    try {
      for (const screen of screens) await expect(screen.page.getByTestId("tv-tree")).toBeVisible();
      await signIn(page, "lead");
      const start = await matchesOf(page, tid);
      const first = ["A", "B", "C", "D"].map((key) => start[key]).find((row) => row && !["completed", "forfeit"].includes(row.status));
      expect(first, "ein Spiel der Runde 1 ist noch offen").toBeTruthy();
      await enterResult(page, first);
      const rows = await matchesOf(page, tid);
      const winner = rows[first.match_key].results.find((row) => row.rank === 1).registration_id;
      const landed = Object.values(rows).find((row) => row.round === 2 && seated(row).includes(winner));
      expect(landed, "der Sieger sitzt sofort in Runde 2").toBeTruthy();

      for (const screen of screens) {
        await expect.poll(() => moments(screen.page), { timeout: TV_WAIT }).toContain("draw_assigned");
        const banner = screen.page.getByTestId("tv-live-banner");
        await expect(banner).toContainText("Zufällig gezogen ·", { timeout: TV_WAIT });
        await expect(screen.page.getByTestId(`tv-match-${landed.id}`).locator(`[data-tv-reg='${winner}']`)).toBeVisible({ timeout: TV_WAIT });
        await shot(screen.page, `tv-sofort-gezogen-${screen.name}.png`);
        // Kein Auslosungs-Moment der ganzen Runde - nur der eine Platz.
        expect(await moments(screen.page)).not.toContain("draw");
      }
    } finally {
      await closeScreens(screens);
    }
  });

  test("Live-Warteschlange: Aufruf und Start an einer Station - die Bahn am TV zieht ohne Neuladen nach", async ({ browser, page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "ein Lauf genügt");
    const tid = state.tournaments.local_live;
    const url = paths.local_live;
    const screens = await openScreens(browser, `${url}&playlist=aufrufe-60`);
    try {
      for (const screen of screens) {
        await expect(screen.page.getByTestId("tv-queue-board")).toBeVisible({ timeout: TV_WAIT });
        // Eine laufende Station zeigt die Spielzeit, die ohne Neuladen weiterläuft.
        const clock = screen.page.locator("[data-testid^='tv-queue-clock-']").first();
        await expect(clock).toBeVisible();
        const before = await clock.locator(".tv-queue__time").textContent();
        await expect.poll(() => clock.locator(".tv-queue__time").textContent(), { timeout: 5_000 }).not.toBe(before);
        await shot(screen.page, `tv-warteschlange-vorher-${screen.name}.png`);
      }

      await signIn(page, "lead");
      let free = null;
      await expect.poll(async () => {
        const queue = await (await page.request.get(`/api/tournaments/${tid}/live-queue`)).json();
        free = queue.stations.find((station) => !station.running && station.status === "free" && station.next?.state === "queued" && station.next.ready);
        return Boolean(free);
      }, { message: "eine freie Station mit spielbereitem nächstem Spiel", timeout: 60_000 }).toBe(true);

      const called = await post(page, `/api/tournaments/${tid}/live-queue/call`, { station_id: free.id, match_id: free.next.match_id });
      expect(called.status(), await called.text()).toBe(200);
      for (const screen of screens) {
        await expect(screen.page.getByTestId(`tv-queue-next-${free.id}`)).toHaveAttribute("data-state", "called", { timeout: TV_WAIT });
        await expect(screen.page.getByTestId(`tv-queue-lane-${free.id}`)).toHaveAttribute("data-state", "called");
        await expect(screen.page.getByTestId(`tv-queue-when-${free.id}`)).toContainText("Aufgerufen");
        await shot(screen.page, `tv-warteschlange-aufgerufen-${screen.name}.png`);
      }

      const started = await post(page, `/api/tournaments/${tid}/live-queue/start`, { station_id: free.id, match_id: free.next.match_id });
      expect(started.status(), await started.text()).toBe(200);
      for (const screen of screens) {
        await expect(screen.page.getByTestId(`tv-queue-now-${free.id}`)).toHaveAttribute("data-match", free.next.match_id, { timeout: TV_WAIT });
        await expect(screen.page.getByTestId(`tv-queue-lane-${free.id}`)).toHaveAttribute("data-state", "live");
        await expect(screen.page.getByTestId(`tv-queue-clock-${free.id}`)).toBeVisible();
        await shot(screen.page, `tv-warteschlange-gestartet-${screen.name}.png`);
      }
    } finally {
      await closeScreens(screens);
    }
  });
});
