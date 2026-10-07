const { test, expect } = require("@playwright/test");

// TV & Beamer, Meilenstein 58 (#1110-#1114): lesbar aus 5 Metern bei 1280×720, 1920×1080 und 3840×2160, nichts
// abgeschnitten, kein „…“; „Bewegung reduzieren“ hält auf allen drei TV-Seiten alles still; eine Änderung im Admin
// kommt ohne Neuladen am TV an; der Turnierbaum läuft mit Anzeige-Schlüssel ohne Anmeldung; Kontrast-Modus mit
// axe-Prüfung; sicherer Bereich; Pixel-Verschiebung; Jahreszeiten nur in der Kopfleiste; Klartext statt „W:A:1“.
// Alle Namen erfunden. Bilder in SHOT_DIR, wenn gesetzt.

const SHOTS = process.env.SHOT_DIR || "";
const SIZES = [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }];
const LIMITS = { normal: { name: 2, other: 1.4 }, large: { name: 3, other: 2.1 } };
const NAMES = ["NeonFalke", "KartKönigin", "Max", "Pixel Pirat", "Spieler A", "Lions Academy", "Turbo Tiger", "Der unglaublich lange Spielername Nummer Eins"];
const REGS = NAMES.map((name, index) => ({ id: `r${index + 1}`, display_name: name, seed: index + 1 }));
const PAGES = [
  { name: "turnierbaum", path: "/display/bracket/t1?key=tv-schluessel" },
  { name: "event", path: "/display/event/event-1" },
  { name: "fastlap", path: "/display/f1/f1-1" },
];

function slot(index, source, registrationId = null) {
  return { slot: index, source, registration_id: registrationId, status: registrationId ? "filled" : "pending" };
}
const seed = (n) => ({ type: "seed", seed: n, raw: String(n) });
const ref = (flow, key) => ({ type: "rank", flow, match_key: key, rank: 1, raw: `${flow}:${key}:1` });
function match(id, key, round, order, slots, extra = {}) {
  return {
    id, match_key: key, round, order, section: extra.section || "WB", stage_id: "stage-1", stage_number: 1, stage_type: "single_elimination",
    match_type: "duel", slots, results: [], settings: { match_size: 2, qualifiers_per_match: 1, duration_minutes: 30 }, duration_minutes: 30,
    status: "pending", round_name: extra.round_name || `Runde ${round}`, ...extra,
  };
}
function decide(row, winnerId) {
  row.status = "completed";
  row.winner_id = winnerId;
  row.results = row.slots.map((s) => ({ registration_id: s.registration_id, rank: s.registration_id === winnerId ? 1 : 2, score: s.registration_id === winnerId ? 3 : 1, qualified: s.registration_id === winnerId }));
}

/** Ein Turnier mit 8 Spielern: „before“ vor der ersten Runde, „after“ danach, „busy“ mitten in Runde 1 (Sieger, Live). */
function bracketData(state = "before") {
  const r1 = [
    match("m-a", "A", 1, 0, [slot(1, seed(1), "r1"), slot(2, seed(8), "r8")], { status: "ready", scheduled_at: "2026-10-10T14:20:00+02:00", station_id: "s1", station_label: "Station 1" }),
    match("m-b", "B", 1, 1, [slot(1, seed(4), "r4"), slot(2, seed(5), "r5")], { status: "ready", scheduled_at: "2026-10-10T14:20:00+02:00" }),
    match("m-c", "C", 1, 2, [slot(1, seed(2), "r2"), slot(2, seed(7), "r7")], { status: "ready", scheduled_at: "2026-10-10T14:50:00+02:00", station_id: "s2", station_label: "Station 2" }),
    match("m-d", "D", 1, 3, [slot(1, seed(3), "r3"), slot(2, seed(6), "r6")], { status: "ready", scheduled_at: "2026-10-10T14:50:00+02:00" }),
  ];
  const r2 = [
    match("m-e", "E", 2, 0, [slot(1, ref("W", "A")), slot(2, ref("W", "B"))], { scheduled_at: "2026-10-10T15:20:00+02:00", round_name: "Halbfinale" }),
    match("m-f", "F", 2, 1, [slot(1, ref("W", "C")), slot(2, ref("W", "D"))], { scheduled_at: "2026-10-10T15:20:00+02:00", round_name: "Halbfinale" }),
  ];
  const r3 = [
    match("m-g", "G", 3, 0, [slot(1, ref("W", "E")), slot(2, ref("W", "F"))], { scheduled_at: "2026-10-10T16:00:00+02:00", round_name: "Finale" }),
    match("m-h", "H", 3, 1, [slot(1, ref("L", "E")), slot(2, ref("L", "F"))], { section: "BRONZE", scheduled_at: "2026-10-10T15:50:00+02:00", round_name: "Spiel um Platz 3" }),
  ];
  if (state === "after" || state === "busy") {
    decide(r1[0], "r1");
    decide(r1[1], "r5");
    r2[0].slots[0] = { ...r2[0].slots[0], registration_id: "r1", status: "filled" };
    r2[0].slots[1] = { ...r2[0].slots[1], registration_id: "r5", status: "filled" };
  }
  if (state === "after") {
    decide(r1[2], "r2");
    decide(r1[3], "r6");
    r2[1].slots[0] = { ...r2[1].slots[0], registration_id: "r2", status: "filled" };
    r2[1].slots[1] = { ...r2[1].slots[1], registration_id: "r6", status: "filled" };
    r2.forEach((row) => { row.status = "ready"; });
  }
  if (state === "busy") r1[2].status = "running";
  return {
    // Vor der ersten Runde ist die Anmeldung zu; im Check-in zeigte der TV seit Meilenstein 60 (#1123) den Check-in-Bildschirm.
    tournament: { id: "t1", slug: "herbst-cup", title: "Lions Herbst-Cup", status: state === "before" ? "registration_closed" : "live", format: "single_elim", public_phase: "live" },
    registrations: REGS,
    stages: [{ id: "stage-1", name: "Turnierbaum", number: 1, stage_type: "single_elimination" }],
    matches: [],
    matches_v2: [...r1, ...r2, ...r3],
    engine: "stage",
  };
}

const EVENT = {
  id: "event-1", slug: "lan-herbst", name: "Lions LAN Herbst", status: "live", start_date: "2026-10-10T10:00:00+02:00", location: "Vereinsheim", city: "Musterstadt",
  tournaments: [{ id: "t1", title: "Lions Herbst-Cup", status: "live", participant_count: 8 }],
  f1_challenges: [{ id: "f1-1", title: "Lions Fast Lap", status: "live", track_count: 2 }],
};
const STATIONS = [
  { id: "s1", name: "Station 1", status: "busy", device_type: "PC", current_match_id: "m-a" },
  { id: "s2", name: "Station 2", status: "available", device_type: "Switch" },
  { id: "s3", name: "Station 3", status: "broken", device_type: "PS5" },
];
const F1 = {
  id: "f1-1", slug: "lions-fast-lap", title: "Lions Fast Lap", is_championship: true,
  tracks: [{ id: "track-1", slug: "spielberg", name: "Spielberg", country: "Österreich" }, { id: "track-2", slug: "monza", name: "Monza", country: "Italien" }],
};
const BOARD = {
  track: { id: "track-1", name: "Spielberg", country: "Österreich" },
  entries: [...NAMES, "Spieler B", "Spieler C", "Spieler D", "Spieler E", "Spieler F"].map((name, index) => ({
    user_id: `u${index}`, rank: index + 1, display_name: name, time_str: `1:${20 + index}.${String(100 + index * 37).slice(0, 3)}`, gap_str: index ? `+${(index * 0.42).toFixed(3)}` : "Leader", attempts: 3 + index,
  })),
  club_reference_entries: [{ user_id: "ref1", rank: 1, display_name: "Vereinsrekord", time_str: "1:19.900" }],
};
const HALLOWEEN = { key: "halloween", label: "Halloween", phase: "deko", intensity: "normal", channels: ["web", "app"], starts_at: "2026-10-25T00:00:00+02:00", ends_at: "2026-11-01T23:59:59+01:00", texts: {}, data: {} };

/**
 * Alles, was die TV-Seiten fragen, mit festen Antworten. `auth`: „anon“ oder „staff“. `settings`: Grundwerte vom
 * Server (ein Objekt, das der Test ändern kann). `bracket`: Zustand des Turniers. `stream`: Warteschlange für den
 * Änderungsstrom - was darin liegt, geht beim nächsten Verbinden raus.
 */
async function mockTv(page, { auth = "anon", settings = {}, bracket = "before", season = null, sponsors = 2, wakeLock = true, stream = [], revokedKeys = [] } = {}) {
  await page.addInitScript(({ withWakeLock }) => {
    if (withWakeLock) {
      const sentinel = { released: false, addEventListener() {}, removeEventListener() {}, release: async () => {} };
      window.__wakeLockRequests = 0;
      Object.defineProperty(window.navigator, "wakeLock", { configurable: true, value: { request: async (type) => { window.__wakeLockRequests += type === "screen" ? 1 : 0; return sentinel; } } });
    } else {
      Object.defineProperty(window.navigator, "wakeLock", { configurable: true, value: undefined });
    }
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  }, { withWakeLock: wakeLock });
  const json = (body, status = 200) => (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const calls = { settings: 0, bracketKeys: [] };
  await page.route("**/api/**", json([]));
  await page.route("**/api/changes/stream", (route) => {
    const events = stream.splice(0, stream.length);
    const body = ["retry: 400", "", "event: connected", "data: {\"ok\":true}", "", ...events.flatMap((event) => [`id: ${event.event_id}`, "event: change", `data: ${JSON.stringify(event)}`, ""])].join("\n");
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: `${body}\n` });
  });
  await page.route("**/api/auth/me", auth === "staff"
    ? json({ id: "staff-1", email: "leitung@example.test", display_name: "Turnierleitung", role: "tournament_admin", is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true })
    : json({ detail: "Nicht angemeldet" }, 401));
  await page.route("**/api/auth/refresh", json({ detail: "Nicht angemeldet" }, 401));
  await page.route("**/api/settings/public", json({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "example.test" }));
  await page.route("**/api/seasonal/active**", json(season ? { now: "2026-10-28T12:00:00+01:00", enabled: true, preview: true, weather: null, seasons: [season] } : { seasons: [] }));
  await page.route("**/api/tv/settings", (route) => {
    calls.settings += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ settings, defaults: {} }) });
  });
  await page.route("**/api/sponsors**", json(Array.from({ length: sponsors }, (_, index) => ({ id: `sp${index}`, name: `Sponsor ${index + 1}`, logo_url: `/assets/brand/tls-mascot.png?s=${index}`, tier: "gold" }))));
  await page.route("**/api/tournaments/t1/bracket/display**", (route) => {
    const key = new URL(route.request().url()).searchParams.get("key");
    calls.bracketKeys.push(key);
    if (key && revokedKeys.includes(key)) return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ detail: "Dieser TV-Link gilt nicht mehr." }) });
    if (!key && auth !== "staff") return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(bracketData(bracket)) });
  });
  await page.route(/\/api\/tournaments\/t1\/bracket(\?.*)?$/, json(bracketData(bracket)));
  await page.route("**/api/tournaments/herbst-cup**", json({ id: "t1", slug: "herbst-cup", title: "Lions Herbst-Cup", status: "live" }));
  await page.route("**/api/events/event-1", json(EVENT));
  await page.route("**/api/stations?event_id=event-1", json(STATIONS));
  await page.route("**/api/stations?tournament_id=t1", json([]));
  await page.route("**/api/f1/challenges/f1-1", json(F1));
  await page.route("**/api/f1/challenges/f1-1/leaderboard**", json(BOARD));
  return calls;
}

async function openTv(page, path) {
  await page.goto(path);
  await expect(page.getByTestId("tv-screen")).toBeVisible();
  await expect(page.getByRole("heading").first()).toBeVisible();
  // Einblenden und Messung der Fläche abwarten.
  await page.waitForTimeout(900);
}

/** Schriftgrößen, „…“ und Abgeschnittenes - gemessen im Browser. */
function measure(page, textSize) {
  return page.evaluate(({ limits }) => {
    const root = document.querySelector("[data-testid='tv-screen']");
    const height = window.innerHeight;
    const tooSmall = [];
    const ellipsis = [];
    const clipped = [];
    const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent.trim();
      const element = node.parentElement;
      if (!text || !element || element.closest("option, [aria-hidden='true']")) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.visibility === "hidden" || style.display === "none" || !rect.width || !rect.height) continue;
      const isName = Boolean(element.closest("[data-tv-name]"));
      const min = (isName ? limits.name : limits.other) * height / 100;
      // Der Turnierbaum liegt auf einer Bühne, die die Kamera vergrößert oder verkleinert (#1115) - gezählt wird, was im Bild ankommt.
      const stage = element.closest("[data-tv-scale]");
      const size = parseFloat(style.fontSize) * (stage ? Number(stage.getAttribute("data-tv-scale")) || 1 : 1);
      if (size + 0.05 < min) tooSmall.push(`${text} (${size.toFixed(1)} < ${min.toFixed(1)})`);
      if (isName && (text.endsWith("…") || style.textOverflow === "ellipsis" || element.scrollWidth > element.clientWidth + 1)) ellipsis.push(text);
    }
    // Nichts unter dem Rand seines Behälters: Karten, Zeilen und Listen.
    for (const body of root.querySelectorAll(".tv-panel__body, [data-testid='tv-lap-list']")) {
      if (body.scrollHeight > body.clientHeight + 1) clipped.push(`Behälter läuft über: ${body.getAttribute("data-testid") || body.className}`);
      const box = body.getBoundingClientRect();
      for (const item of body.children) {
        const r = item.getBoundingClientRect();
        if (r.height && r.bottom > box.bottom + 1) clipped.push(`unten abgeschnitten: ${item.textContent.slice(0, 40)}`);
      }
    }
    for (const card of root.querySelectorAll(".tv-card, .tv-header, .tv-footer")) {
      const r = card.getBoundingClientRect();
      if (r.right > window.innerWidth + 4 || r.bottom > window.innerHeight + 4 || r.left < -4 || r.top < -4) clipped.push(`außerhalb des Bildes: ${card.textContent.slice(0, 40)}`);
    }
    const overflowX = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth;
    return { tooSmall, ellipsis, clipped, overflowX };
  }, { limits: LIMITS[textSize] });
}

test.describe("TV & Beamer (Meilenstein 58)", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "TV-Seiten sind für große Bildschirme; die Größen stellt der Test selbst ein");

  for (const textSize of ["normal", "large"]) {
    for (const size of SIZES) {
      test(`lesbar aus 5 Metern: ${textSize} bei ${size.width}x${size.height} - keine Schrift unter der Grenze, kein „…“, nichts abgeschnitten`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.setViewportSize(size);
        await mockTv(page, { settings: { text_size: textSize } });
        for (const { name, path } of PAGES) {
          await openTv(page, path);
          await expect(page.getByTestId("tv-screen")).toHaveAttribute("data-tv-text", textSize);
          const result = await measure(page, textSize);
          expect(result.tooSmall, `${name}: zu kleine Schrift`).toEqual([]);
          expect(result.ellipsis, `${name}: Namen mit „…“`).toEqual([]);
          expect(result.clipped, `${name}: abgeschnitten`).toEqual([]);
          expect(result.overflowX, `${name}: seitlich gescrollt`).toBeLessThanOrEqual(1);
          // Und es steht auch etwas da: Karten, Stationen, Zeiten.
          const shown = { turnierbaum: "[data-testid^='tv-match-']", event: "[data-testid='tv-station']", fastlap: "[data-testid='tv-lap-row']" }[name];
          expect(await page.locator(shown).count(), `${name}: leer`).toBeGreaterThan(0);
          if (SHOTS && size.width === 1920) await page.screenshot({ path: `${SHOTS}/nachher-${name}-${textSize}-${size.width}x${size.height}.png` });
        }
      });
    }
  }

  test("Bewegung reduzieren: auf allen drei TV-Seiten bewegt sich nichts - auch Laufband und Sieger-Leuchten nicht", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await mockTv(page, { bracket: "busy", season: HALLOWEEN, sponsors: 9 });
    const running = () => page.evaluate(() => {
      const root = document.querySelector("[data-testid='tv-screen']");
      return document.getAnimations()
        .filter((animation) => animation.playState === "running")
        .filter((animation) => {
          const target = animation.effect && animation.effect.target;
          return target && root.contains(target);
        })
        .map((animation) => animation.animationName || animation.transitionProperty || "web-animation");
    });
    // Gegenprobe: ohne „Bewegung reduzieren“ laufen Live-Punkt, Lichtlauf, Laufband und Deko. Das Laufband ist seit
    // Meilenstein 60 (#1125) ein Schalter, Standard aus - hier eingeschaltet.
    await openTv(page, "/display/bracket/t1?key=tv-schluessel&sponsor_ticker=1");
    expect((await running()).length).toBeGreaterThan(0);
    await expect(page.getByTestId("sponsor-grid")).toHaveAttribute("data-mode", "marquee");

    for (const { name, path } of PAGES) {
      const join = path.includes("?") ? "&" : "?";
      await openTv(page, `${path}${join}reduce_motion=1&sponsor_ticker=1`);
      await expect(page.getByTestId("tv-screen")).toHaveAttribute("data-tv-motion", "off");
      await expect(page.getByTestId("sponsor-grid")).toHaveAttribute("data-mode", "pages");
      expect(await running(), `${name}: läuft noch`).toEqual([]);
      // Nichts wandert: Karten und Teilchen stehen nach einer Sekunde an derselben Stelle.
      const spots = () => page.evaluate(() => [...document.querySelectorAll("[data-testid='tv-screen'] .tv-card, [data-testid='tv-screen'] .tv-deco__track")].slice(0, 12)
        .map((element) => { const r = element.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)}`; }));
      const before = await spots();
      await page.waitForTimeout(1000);
      expect(await spots(), `${name}: hat sich bewegt`).toEqual(before);
    }
    await expect(page.getByTestId("tv-season-deco")).toBeVisible();

    // Dasselbe, wenn das Gerät „Bewegung reduzieren“ eingestellt hat - ganz ohne Link.
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const { name, path } of PAGES) {
      await openTv(page, path);
      await expect(page.getByTestId("tv-screen")).toHaveAttribute("data-tv-motion", "off");
      expect(await running(), `${name}: läuft trotz Gerät`).toEqual([]);
    }
  });

  test("eine Änderung im Admin kommt ohne Neuladen am TV an; ein Link mit Abweichung behält sie", async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const settings = { contrast: false };
    const tvStream = [];
    const tv = await context.newPage();
    await mockTv(tv, { settings, stream: tvStream });
    const pinned = await context.newPage();
    await mockTv(pinned, { settings });
    await openTv(tv, "/display/event/event-1");
    await openTv(pinned, "/display/event/event-1?contrast=0");
    await tv.evaluate(() => { window.__ohneNeuladen = true; });
    await expect(tv.getByTestId("tv-screen")).toHaveAttribute("data-tv-contrast", "0");

    const admin = await context.newPage();
    await mockTv(admin, { auth: "staff", settings });
    await admin.route("**/api/tv/settings", async (route) => {
      if (route.request().method() === "PUT") {
        Object.assign(settings, JSON.parse(route.request().postData() || "{}"));
        tvStream.push({ event_id: `tv-${Date.now()}`, event_type: "api.changed", resource: "tv", path: "/api/tv", visibility_scope: "public" });
      }
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ settings, defaults: {} }) });
    });
    await admin.route("**/api/tv/keys", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
    await admin.goto("/admin/tv");
    await expect(admin.getByTestId("tv-input-contrast")).not.toBeChecked();
    await admin.getByTestId("tv-input-contrast").check();
    await admin.getByTestId("tv-defaults-save").click();

    await expect(tv.getByTestId("tv-screen")).toHaveAttribute("data-tv-contrast", "1", { timeout: 15_000 });
    expect(await tv.evaluate(() => window.__ohneNeuladen)).toBe(true);
    // Der Bildschirm mit „contrast=0“ im Link bleibt bei seiner Abweichung.
    await tv.waitForTimeout(1200);
    await expect(pinned.getByTestId("tv-screen")).toHaveAttribute("data-tv-contrast", "0");
    await context.close();
  });

  test("Anzeige-Schlüssel: der Turnierbaum läuft ohne Anmeldung, ein widerrufener zeigt nichts, ohne Schlüssel geht es zur Anmeldung", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const calls = await mockTv(page, { revokedKeys: ["widerrufen"] });
    await openTv(page, "/display/bracket/t1?key=tv-schluessel");
    await expect(page.getByTestId("bracket-tv")).toContainText("Lions Herbst-Cup");
    expect(calls.bracketKeys).toContain("tv-schluessel");
    // Der QR-Code am TV führt zur öffentlichen Seite - der Schlüssel steht nirgends im Bild.
    await expect(page.getByTestId("bracket-tv")).not.toContainText("tv-schluessel");

    await page.goto("/display/bracket/t1?key=widerrufen");
    await expect(page.getByTestId("tv-key-refused")).toContainText("Dieser TV-Link gilt nicht mehr");
    await expect(page.getByText("Lions Herbst-Cup")).toHaveCount(0);

    await page.goto("/display/bracket/t1");
    await expect(page).toHaveURL(/\/login/);
  });

  test("Kontrast-Modus: jeder Text mindestens 7:1 (axe), keine halb durchsichtigen Grautöne", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await mockTv(page, { bracket: "busy", season: HALLOWEEN });
    const axePath = require.resolve("axe-core/axe.min.js");
    for (const { name, path } of PAGES) {
      const join = path.includes("?") ? "&" : "?";
      await openTv(page, `${path}${join}contrast=1&reduce_motion=1`);
      await expect(page.getByTestId("tv-screen")).toHaveAttribute("data-tv-contrast", "1");
      await page.addScriptTag({ path: axePath });
      const violations = await page.evaluate(async () => {
        const result = await window.axe.run(document.querySelector("[data-testid='tv-screen']"), { runOnly: { type: "rule", values: ["color-contrast-enhanced"] } });
        return result.violations.flatMap((violation) => violation.nodes.map((node) => `${node.target.join(" ")}: ${node.failureSummary}`));
      });
      expect(violations, `${name}: Kontrast`).toEqual([]);
      const translucent = await page.evaluate(() => {
        const root = document.querySelector("[data-testid='tv-screen']");
        const found = [];
        for (const element of root.querySelectorAll("*")) {
          if (![...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue;
          if (element.closest("[aria-hidden='true'], option")) continue;
          const color = getComputedStyle(element).color;
          const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(color);
          if (alpha && Number(alpha[1]) < 1) found.push(`${element.textContent.trim().slice(0, 30)}: ${color}`);
          for (let node = element; node && node !== root; node = node.parentElement) {
            if (Number(getComputedStyle(node).opacity) < 1) { found.push(`${element.textContent.trim().slice(0, 30)}: opacity`); break; }
          }
        }
        return found;
      });
      expect(translucent, `${name}: halb durchsichtig`).toEqual([]);
      // Strenger als axe (das große Schrift schon ab 4,5:1 gelten lässt): jeder Text mindestens 7:1 zu seinem Grund.
      const weak = await page.evaluate(() => {
        const parse = (value) => {
          const match = /rgba?\(([^)]+)\)/.exec(value || "");
          if (!match) return null;
          const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
          return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
        };
        const channel = (value) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        const luminance = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
        const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const backgroundOf = (element) => {
          for (let node = element; node; node = node.parentElement) {
            const background = parse(getComputedStyle(node).backgroundColor);
            if (background && background.a > 0) return background;
          }
          return { r: 0, g: 0, b: 0, a: 1 };
        };
        const root = document.querySelector("[data-testid='tv-screen']");
        const found = [];
        for (const element of root.querySelectorAll("*")) {
          if (![...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue;
          if (element.closest("[aria-hidden='true'], option")) continue;
          const color = parse(getComputedStyle(element).color);
          if (!color) continue;
          const value = ratio(color, backgroundOf(element));
          if (value < 6.99) found.push(`${element.textContent.trim().slice(0, 30)}: ${value.toFixed(2)}`);
        }
        return found;
      });
      expect(weak, `${name}: unter 7:1`).toEqual([]);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/nachher-${name}-kontrast-1920x1080.png` });
    }
  });

  for (const safe of [3, 5]) {
    test(`sicherer Bereich ${safe} %: nichts liegt in den äußeren ${safe} %`, async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await mockTv(page, {});
      for (const { name, path } of PAGES) {
        const join = path.includes("?") ? "&" : "?";
        await openTv(page, `${path}${join}safe_area=${safe}`);
        // Gemessen wird der Ruhezustand: eine laufende Kamerafahrt erst zu Ende gehen lassen.
        await expect(page.locator("[data-tv-moving]")).toHaveCount(0);
        const outside = await page.evaluate((percent) => {
          const root = document.querySelector("[data-testid='tv-screen']");
          const left = window.innerWidth * percent / 100;
          const top = window.innerHeight * percent / 100;
          const right = window.innerWidth - left;
          const bottom = window.innerHeight - top;
          const found = [];
          const outside = (r) => r.left < left - 0.5 || r.top < top - 0.5 || r.right > right + 0.5 || r.bottom > bottom + 0.5;
          // Gezählt wird, was man sieht: Fährt die Kamera über einen großen Baum, schneidet der Bildausschnitt
          // (`.tv-viewport`) den Rest ab - der Ausschnitt selbst muss im sicheren Bereich liegen.
          for (const clip of root.querySelectorAll("[data-testid='tv-stage'] .tv-viewport")) {
            if (outside(clip.getBoundingClientRect())) found.push("Bildausschnitt");
          }
          for (const element of root.querySelectorAll("[data-testid='tv-stage'] *")) {
            let r = element.getBoundingClientRect();
            const clip = element.closest(".tv-viewport");
            if (clip && clip !== element) {
              const c = clip.getBoundingClientRect();
              r = { left: Math.max(r.left, c.left), top: Math.max(r.top, c.top), right: Math.min(r.right, c.right), bottom: Math.min(r.bottom, c.bottom) };
              r.width = r.right - r.left;
              r.height = r.bottom - r.top;
            }
            if (!(r.width > 0) || !(r.height > 0)) continue;
            if (outside(r)) found.push(`${element.tagName} ${element.className}`.slice(0, 80));
          }
          return found;
        }, safe);
        expect(outside, `${name}: im Randbereich`).toEqual([]);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/nachher-${name}-sicher-${safe}-1920x1080.png` });
      }
    });
  }

  test("Pixel-Verschiebung: alle paar Minuten 1 bis 3 Punkte, kein Spalt am Rand - auch mit „Bewegung reduzieren“", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.clock.install();
    await mockTv(page, {});
    await openTv(page, "/display/event/event-1?reduce_motion=1");
    const stage = page.getByTestId("tv-stage");
    await expect(stage).toHaveAttribute("data-shift", "0,0");
    const seen = new Set();
    for (let step = 0; step < 6; step += 1) {
      await page.clock.fastForward("03:01");
      const shift = await stage.getAttribute("data-shift");
      seen.add(shift);
      const [x, y] = shift.split(",").map(Number);
      expect(Math.abs(x)).toBeLessThan(4);
      expect(Math.abs(y)).toBeLessThan(4);
      // Kein Spalt: die Bühne deckt das ganze Bild, wo immer sie gerade steht.
      const box = await stage.boundingBox();
      expect(box.x).toBeLessThanOrEqual(0);
      expect(box.y).toBeLessThanOrEqual(0);
      expect(box.x + box.width).toBeGreaterThanOrEqual(1920);
      expect(box.y + box.height).toBeGreaterThanOrEqual(1080);
    }
    expect(seen.size).toBeGreaterThan(1);
    // Ausgeschaltet bleibt das Bild, wo es ist.
    await page.goto("/display/event/event-1?pixel_shift=0");
    await expect(page.getByTestId("tv-screen")).toBeVisible();
    await page.clock.fastForward("09:00");
    await expect(page.getByTestId("tv-stage")).toHaveAttribute("data-shift", "0,0");
  });

  test("wach halten: mit Wake Lock wird angefragt; ohne läuft die Seite normal weiter und sagt es einmal", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await mockTv(page, {});
    await openTv(page, "/display/event/event-1");
    expect(await page.evaluate(() => window.__wakeLockRequests)).toBeGreaterThan(0);
    await expect(page.getByTestId("tv-wake-hint")).toHaveCount(0);

    const other = await page.context().newPage();
    await other.setViewportSize({ width: 1920, height: 1080 });
    await mockTv(other, { wakeLock: false });
    await openTv(other, "/display/event/event-1");
    await expect(other.getByTestId("tv-wake-hint")).toBeVisible();
    await expect(other.getByTestId("event-tv")).toContainText("Lions LAN Herbst");
    await other.close();
  });

  test("Jahreszeiten nur in der Kopfleiste: auf allen drei TV-Seiten, bei drei Auflösungen, aus mit dem Schalter", async ({ page }) => {
    test.setTimeout(90_000);
    // Saison im Vorschau-Modus: das Token aus „Vorschau 60 Sekunden“ liegt in dieser Sitzung.
    await page.addInitScript(() => {
      window.sessionStorage.setItem("tls-season-preview", JSON.stringify({ token: "halloween.vorschau", expires: Date.now() + 10 * 60 * 1000 }));
    });
    const previews = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/seasonal/active")) previews.push(new URL(request.url()).searchParams.get("preview"));
    });
    await mockTv(page, { season: HALLOWEEN });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      for (const { name, path } of PAGES) {
        await openTv(page, path);
        const deco = page.getByTestId("tv-season-deco");
        await expect(deco).toHaveAttribute("data-deco", "bats");
        const inside = await page.evaluate(() => {
          const decoElement = document.querySelector("[data-testid='tv-season-deco']");
          const header = decoElement.closest("header");
          const h = header.getBoundingClientRect();
          const d = decoElement.getBoundingClientRect();
          return {
            withinHeader: d.left >= h.left - 1 && d.top >= h.top - 1 && d.right <= h.right + 1 && d.bottom <= h.bottom + 1,
            clipped: getComputedStyle(header).overflow === "hidden",
            behind: Number(getComputedStyle(decoElement).zIndex) < Number(getComputedStyle(header.querySelector(".tv-header__content")).zIndex),
          };
        });
        expect(inside, name).toEqual({ withinHeader: true, clipped: true, behind: true });
        // So flüssig wie ohne: wenige Teilchen, nur CSS-Bewegung auf Verschieben, Drehen und Deckkraft - kein Skript je Bild.
        const motion = await page.evaluate(() => {
          const decoElement = document.querySelector("[data-testid='tv-season-deco']");
          const animations = document.getAnimations().filter((animation) => decoElement.contains(animation.effect && animation.effect.target));
          const properties = new Set(animations.flatMap((animation) => animation.effect.getKeyframes().flatMap((frame) => Object.keys(frame))));
          ["offset", "computedOffset", "easing", "composite"].forEach((key) => properties.delete(key));
          return { particles: decoElement.querySelectorAll(".tv-deco__p").length, css: animations.every((animation) => Boolean(animation.animationName)), properties: [...properties].sort() };
        });
        expect(motion.particles).toBeLessThanOrEqual(16);
        expect(motion.css).toBe(true);
        expect(motion.properties.every((property) => ["transform", "translate", "rotate", "scale", "opacity"].includes(property)), motion.properties.join(",")).toBe(true);
        if (SHOTS) {
          const box = await page.locator("header").first().boundingBox();
          await page.screenshot({ path: `${SHOTS}/kopfleiste-${name}-${size.width}x${size.height}.png`, clip: { x: 0, y: 0, width: size.width, height: Math.ceil(box.height) } });
        }
      }
    }
    expect(previews.every((token) => token === "halloween.vorschau")).toBe(true);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openTv(page, "/display/event/event-1?season_header=0");
    await expect(page.getByTestId("tv-season-deco")).toHaveCount(0);
  });

  test("ohne laufende Jahreszeit sieht die Kopfleiste aus wie vorher", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await mockTv(page, {});
    for (const { path } of PAGES) {
      await openTv(page, path);
      await expect(page.getByTestId("tv-season-deco")).toHaveCount(0);
    }
  });

  test("Klartext statt Platzhalter: TV und Turnierseite vor und nach der ersten Runde", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    for (const state of ["before", "after"]) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await mockTv(page, { bracket: state, auth: "staff" });
      await openTv(page, "/display/bracket/t1?key=tv-schluessel");
      const tv = page.getByTestId("bracket-tv");
      for (const old of ["W:A:1", "W:C:1", "Freier Slot", "Keine Station"]) await expect(tv).not.toContainText(old);
      if (state === "before") {
        await expect(tv).toContainText("Sieger aus A");
        await expect(tv).toContainText("geplant ca.");
      } else {
        await expect(page.getByTestId("tv-match-m-e")).toContainText("NeonFalke");
        await expect(page.getByTestId("tv-match-m-e")).not.toContainText("Sieger aus");
      }

      await page.goto("/tournaments/herbst-cup/bracket");
      await expect(page.getByRole("heading", { name: /herbst-cup/i })).toBeVisible();
      await expect(page.getByTestId("bracket-tree").first()).toBeVisible();
      for (const old of ["W:A:1", "W:C:1", "L:E:1", "Freier Slot", "Keine Station"]) await expect(page.locator("body")).not.toContainText(old);
      if (state === "before") {
        await expect(page.getByTestId("bracket-match-v2-m-e")).toContainText("Sieger aus A");
        await expect(page.getByTestId("bracket-match-v2-m-h")).toContainText("Verlierer aus E");
      } else {
        await expect(page.getByTestId("bracket-match-v2-m-e")).toContainText("NeonFalke");
        await expect(page.getByTestId("bracket-match-v2-m-g")).toContainText("Sieger aus E");
      }
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/nachher-turnierseite-${state === "before" ? "vor" : "nach"}-runde1.png`, fullPage: true });
    }
  });
});
