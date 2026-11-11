const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Map-Veto live (#1651, docs/LIGA.md D.4): zwei Captains parallel in eigenen Browser-Kontexten bei 390 und 1440 px, dazu Zuschauer und
// TV bei 1920 px. Die API ist nachgestellt, aber mit echtem Stand: Ein Zug des einen landet über den kurzen Abruf beim anderen (Karte
// leuchtet auf, Ablauf rückt weiter), am Ende steht bei beiden die Spielreihenfolge. Bilder je Schritt und ein Ablauf-Video landen mit
// VETO_SHOT_DIR in diesem Ordner, sonst im Testbericht. Kein seitlicher Überlauf. Erfundene Namen.

const SHOT_DIR = process.env.VETO_SHOT_DIR || "";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const iso = (ms) => new Date(ms).toISOString();
const CAPTAIN_A = { id: "u-a", username: "mila", display_name: "Mila Mustermann", role: "player" };
const CAPTAIN_B = { id: "u-b", username: "falk", display_name: "Falk Beispiel", role: "player" };
const SIDES = { a: "Loewen mit sehr langem Namen · Rudel Alpha", b: "Falken · Horst" };
const MODES = [
  { mode: "hp", label: "Stellung", maps: [["hafen", "Hafenkante"], ["nebel", "Nebelwerk"], ["turm", "Funkturm"], ["glut", "Glutsenke"]] },
  { mode: "snd", label: "Suchen & Zerstören", maps: [["nebel", "Nebelwerk"], ["turm", "Funkturm"], ["kai", "Kaimauer"], ["werk", "Kieswerk"]] },
  { mode: "ctl", label: "Kontrolle", maps: [["hafen", "Hafenkante"], ["kai", "Kaimauer"], ["ruine", "Ruine"]] },
];
const step = (kind, mode, team, position = null) => ({ kind, mode, team, position });
const ANLAGE_B = [
  step("ban", "hp", "A"), step("ban", "hp", "B"), step("pick", "hp", "A", 1), step("pick", "hp", "B", 4),
  step("ban", "snd", "B"), step("ban", "snd", "A"), step("pick", "snd", "B", 2), step("pick", "snd", "A", 5),
  step("ban", "ctl", "A"), step("ban", "ctl", "B"), step("decider", "ctl", null, 3),
];
const HUES = { hafen: 200, nebel: 260, turm: 20, glut: 8, kai: 170, werk: 40, ruine: 110 };
const image = (id) => `/uploads/maps/${id}.svg`;

/** Ein Veto mit echtem Stand - Züge, automatischer Decider, Spielreihenfolge - für beide Kontexte zugleich. */
function createVeto() {
  const state = { version: 1, done: [], deadline: Date.now() + 60000 };
  const label = (mode) => MODES.find((row) => row.mode === mode).label;
  const nameOf = (mode, id) => MODES.find((row) => row.mode === mode).maps.find(([mapId]) => mapId === id)[1];
  const regOf = (team) => (team === "A" ? "a" : team === "B" ? "b" : null);
  const taken = (mode, id) => state.done.find((row) => row.mode === mode && row.map_id === id);
  const index = () => state.done.length;
  const status = () => (index() >= ANLAGE_B.length ? "done" : "running");
  const apply = (mapId, via) => {
    const current = ANLAGE_B[index()];
    state.done.push({ index: index(), ...current, map_id: mapId, map_name: nameOf(current.mode, mapId), via });
    state.version += 1;
    state.deadline = Date.now() + 60000;
    const next = ANLAGE_B[index()];
    if (next?.kind === "decider") {
      const rest = MODES.find((row) => row.mode === next.mode).maps.find(([id]) => !taken(next.mode, id));
      apply(rest[0], "auto");
    }
  };
  const block = (own) => {
    const running = status() === "running";
    const current = running ? ANLAGE_B[index()] : null;
    const turn = current ? regOf(current.team) : null;
    const ownTurn = Boolean(own && turn === own);
    const statusOf = (row) => (row.kind === "ban" ? "banned" : row.kind === "decider" ? "decider" : "picked");
    return {
      status: status(), skipped_reason: null, version: state.version, step_seconds: 60, server_now: iso(Date.now()),
      team_a: { registration_id: "a", name: SIDES.a, via: "home" }, team_b: { registration_id: "b", name: SIDES.b },
      current: current ? { index: index(), number: index() + 1, total: ANLAGE_B.length, kind: current.kind, mode: current.mode, mode_label: label(current.mode),
        registration_id: turn, name: turn ? SIDES[turn] : null, position: current.position, deadline_at: iso(state.deadline),
        remaining_seconds: Math.round((state.deadline - Date.now()) / 1000) } : null,
      own_turn: ownTurn, can_pick: ownTurn, own_side: own === "a" ? "A" : own === "b" ? "B" : null,
      pick_hint: running && own && !ownTurn ? `Jetzt ist ${SIDES[turn]} am Zug.` : running ? null : "Das Veto ist abgeschlossen.",
      options: ownTurn ? MODES.find((row) => row.mode === current.mode).maps.map(([id, name]) => ({ map_id: id, name, image_url: image(id),
        allowed: !taken(current.mode, id), hint: taken(current.mode, id) ? `${name} ist in diesem Modus schon gesperrt oder gewählt.` : null })) : [],
      remaining: MODES.map((group) => ({ mode: group.mode, label: group.label, maps: group.maps.map(([id, name]) => {
        const row = taken(group.mode, id);
        return { map_id: id, name, image_url: image(id), status: row ? statusOf(row) : "open", by_name: row && regOf(row.team) ? SIDES[regOf(row.team)] : null,
          side: row ? row.team : null, position: row ? row.position : null };
      }) })),
      history: state.done.map((row) => ({ index: row.index, kind: row.kind, mode_label: label(row.mode), name: regOf(row.team) ? SIDES[regOf(row.team)] : null,
        map_name: row.map_name, position: row.position, via: row.via, at: iso(Date.now()) })),
      planned_games: running ? [] : state.done.filter((row) => row.kind !== "ban").sort((x, y) => x.position - y.position).map((row) => ({
        position: row.position, mode: row.mode, mode_label: label(row.mode), map_id: row.map_id, map_name: row.map_name, map_image_url: image(row.map_id),
        role: row.kind === "decider" ? "decider" : "picked", by_registration_id: regOf(row.team) })),
      paused: null, lead: null, week: null, presets: [], blocked: null, start: null,
      plan: ANLAGE_B.map((item, at) => {
        const row = state.done[at];
        return { index: at, number: at + 1, kind: item.kind, mode: item.mode, mode_label: label(item.mode), side: item.team, name: regOf(item.team) ? SIDES[regOf(item.team)] : null,
          position: item.position, state: row ? "done" : at === index() ? "current" : "open", map_id: row?.map_id || null, map_name: row?.map_name || null,
          map_image_url: row ? image(row.map_id) : null, via: row?.via || null };
      }),
    };
  };
  const pick = (own, mapId, version) => {
    const current = ANLAGE_B[index()];
    if (!current || regOf(current.team) !== own || version !== state.version || taken(current.mode, mapId)) return false;
    apply(mapId, "side");
    return true;
  };
  return { block, pick, status, state };
}

const RULES = { opens_minutes_before: 15, closes_minutes_after: 15, min_present: 3, remind_minutes_before_close: 5 };
function matchPage(veto, own) {
  const now = Date.now();
  const side = (reg, mine) => ({ registration_id: reg, name: SIDES[reg], own: mine, checked_in: true, at: iso(now - 120000),
    present: [{ id: `${reg}1`, name: "Spieler Eins" }, { id: `${reg}2`, name: "Spieler Zwei" }, { id: `${reg}3`, name: "Spieler Drei" }], present_count: 3, consent_open: false });
  const done = veto.status() === "done";
  return {
    tournament: { id: "t1", slug: "probe-liga-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A" },
    participants: [{ slot: 1, status: "filled", registration_id: "a", display_name: SIDES.a }, { slot: 2, status: "filled", registration_id: "b", display_name: SIDES.b }],
    matchday_label: "Spieltag 2", collection: "matches_v2", can_act: Boolean(own), can_report_score: false, can_player_report_result: false,
    can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false,
    can_forfeit: false, allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal",
    acting_registration_id: own, report_state: null, schedule_proposals: [], schedule_block: null,
    match: { id: "m1", match_key: "L2", status: "scheduled", schedule_status: "accepted", schedule_source: "accepted", scheduled_at: iso(now + 300000),
      slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
    checkin: own ? {
      rules: RULES, state: done ? "ready" : "veto", scheduled_at: iso(now + 300000), window: { opens_at: iso(now - 600000), closes_at: iso(now + 1200000) },
      ready_at: iso(now - 60000), started_at: null, sides: [side("a", own === "a"), side("b", own === "b")], own_registration_id: own, can_checkin: true,
      checkin_hint: null, roster: [], min_present: 3, can_start: done, start_hint: done ? null : "Erst das Veto abschließen, dann starten.", proposal: null,
      lead: null, veto: veto.block(own),
    } : null,
    veto_view: own ? null : veto.block(null),
  };
}

function mapSvg(id) {
  const hue = HUES[id] ?? 200;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="hsl(${hue} 55% 34%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 45% 12%)"/></linearGradient></defs>`
    + `<rect width="640" height="360" fill="url(#g)"/><path d="M0 260 L120 190 L240 230 L380 150 L520 210 L640 170 L640 360 L0 360Z" fill="hsl(${hue} 30% 8%)" opacity="0.75"/>`
    + `<circle cx="${120 + (hue % 400)}" cy="90" r="38" fill="hsl(${hue} 80% 70%)" opacity="0.35"/></svg>`;
}

async function wire(context, veto, user, own) {
  await context.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await context.route("**/api/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    // Bilder der Maps (über /api/static/uploads/...): ein ruhiges Platzhalter-Bild je Map.
    if (url.pathname.includes("/uploads/maps/")) {
      return route.fulfill({ status: 200, contentType: "image/svg+xml", body: mapSvg(path.basename(url.pathname, ".svg")) });
    }
    if (url.pathname.startsWith("/api/changes")) return route.abort();
    if (url.pathname === "/api/auth/me") return user ? route.fulfill(json(user)) : route.fulfill(json({ detail: "Nicht angemeldet" }, 401));
    if (url.pathname === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (url.pathname === "/api/tv/settings") return route.fulfill(json({ settings: { pixel_shift: false } }));
    if (url.pathname === "/api/leagues") return route.fulfill(json({ leagues: [] }));
    if (url.pathname === "/api/matches/m1/page") return route.fulfill(json(matchPage(veto, own)));
    if (url.pathname === "/api/matches/m1/chat") return route.fulfill(json([]));
    if (url.pathname === "/api/matches/m1/veto" && request.method() === "GET") {
      const display = url.searchParams.get("display") === "1";
      const viewer = display ? null : own;
      return route.fulfill(json({ veto: veto.block(viewer), now: iso(Date.now()), state: viewer ? (veto.status() === "done" ? "ready" : "veto") : null,
        match: { id: "m1", tournament_title: "Probe-Liga Season 1 · Liga 1 · Staffel A", matchday_label: "Spieltag 2", sides: [SIDES.a, SIDES.b] } }));
    }
    if (url.pathname === "/api/matches/m1/veto/pick" && request.method() === "POST") {
      const body = request.postDataJSON();
      const ok = own && veto.pick(own, body.map_id, body.version);
      return ok ? route.fulfill(json({ version: veto.state.version, status: veto.status(), step: veto.state.done.length, idempotent_replay: false }))
        : route.fulfill(json({ detail: "Gerade hat sich am Veto etwas geändert – bitte die Seite neu laden." }, 409));
    }
    if (url.pathname === "/api/friends") return route.fulfill(json({ incoming: [], friends: [], outgoing: [] }));
    return route.fulfill(json([]));
  });
}

/** Bild je Schritt: auf der Matchseite der Check-in-Block mit dem Veto (lesbar auch bei 390 px), am TV der ganze Bildschirm. */
async function shot(page, testInfo, name) {
  const area = page.getByTestId("checkin-panel").or(page.getByTestId("veto-panel")).first();
  // Kopf, Leiste unten und „Nach oben“ stehen fest über der Seite - im Ausschnitt würden sie über dem Veto liegen.
  // Am TV der Hinweis „Bildschirm wach halten“ - den kennt der Testbrowser nicht, im echten TV steht er nicht da.
  const style = "[data-testid='site-header'], [data-testid='bottom-nav'], [data-testid='scroll-top-btn'], [data-sonner-toaster], [data-testid='tv-wake-hint'] { visibility: hidden !important; }";
  const body = await area.count() ? await area.screenshot({ animations: "allow", style }) : await page.screenshot({ style });
  await testInfo.attach(name, { body, contentType: "image/png" });
  if (SHOT_DIR) {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(SHOT_DIR, name), body);
  }
}

async function expectNoSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Wartet, bis die Karte nicht mehr aufbaut - dann sind Bilder ruhig. */
async function settle(page) {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((item) => item.effect?.getTiming?.().iterations !== Infinity).map((item) => item.finished.catch(() => {}))));
}

test.describe("Liga: Map-Veto live", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const width of [390, 1440]) {
    test(`zwei Captains parallel: Zug des einen erscheint beim anderen, bis zur Spielreihenfolge bei ${width} px`, async ({ browser }, testInfo) => {
      test.setTimeout(90_000);
      const veto = createVeto();
      const viewport = { width, height: 1000 };
      const contextA = await browser.newContext({ viewport });
      const contextB = await browser.newContext({ viewport });
      await wire(contextA, veto, CAPTAIN_A, "a");
      await wire(contextB, veto, CAPTAIN_B, "b");
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      await Promise.all([pageA.goto("/matches/m1"), pageB.goto("/matches/m1")]);

      // Schritt 1: Team A ist am Zug - bei A die Auswahl, bei B das Warten. Countdown, Ablauf und Brett mit Bildern bei beiden.
      await expect(pageA.getByTestId("veto-own")).toBeVisible();
      await expect(pageA.getByTestId("veto-option-hafen")).toBeEnabled();
      await expect(pageB.getByTestId("veto-own")).toHaveCount(0);
      await expect(pageB.getByTestId("veto-wait")).toContainText("am Zug");
      for (const page of [pageA, pageB]) {
        await expect(page.getByTestId("veto-countdown-text")).toHaveText(/^\d:\d\d$/);
        await expect(page.getByTestId("veto-timeline").locator("li")).toHaveCount(11);
        await expect(page.getByTestId("veto-step-0")).toHaveAttribute("aria-current", "step");
        await expect(page.getByTestId("veto-map-hp-hafen").locator("img")).toBeVisible();
        await expectNoSideScroll(page);
      }
      await settle(pageA);
      await settle(pageB);
      await shot(pageA, testInfo, `veto-live-${width}-1-a-am-zug.png`);
      await shot(pageB, testInfo, `veto-live-${width}-1-b-wartet.png`);

      // A sperrt Hafenkante: bei B leuchtet die Karte auf, B ist am Zug - ohne Neuladen.
      await pageA.getByTestId("veto-option-hafen").click();
      await expect(pageB.getByTestId("veto-flash-hafen")).toBeAttached({ timeout: 6000 });
      await expect(pageB.getByTestId("veto-map-hp-hafen")).toHaveAttribute("data-status", "banned");
      await expect(pageB.getByTestId("veto-own")).toBeVisible();
      await expect(pageB.getByTestId("veto-step-0")).toContainText("Hafenkante");
      await expect(pageB.getByTestId("veto-step-1")).toHaveAttribute("aria-current", "step");
      // Bei A dimmt die eigene Sperre nur - kein Aufleuchten.
      await expect(pageA.getByTestId("veto-map-hp-hafen")).toHaveAttribute("data-status", "banned");
      await expect(pageA.getByTestId("veto-flash-hafen")).toHaveCount(0);
      await settle(pageB);
      await shot(pageB, testInfo, `veto-live-${width}-2-b-sieht-bann.png`);

      // B sperrt Funkturm, A wählt Nebelwerk als Map 1 - die Wahl leuchtet bei B in der Farbe von Team A.
      await pageB.getByTestId("veto-option-turm").click();
      await expect(pageA.getByTestId("veto-flash-turm")).toBeAttached({ timeout: 6000 });
      await pageA.getByTestId("veto-option-nebel").click();
      await expect(pageB.getByTestId("veto-map-hp-nebel")).toHaveAttribute("data-status", "picked", { timeout: 6000 });
      await expect(pageB.getByTestId("veto-map-hp-nebel").locator("button")).toHaveAttribute("data-tone", "a");
      await expect(pageB.getByTestId("veto-flash-nebel")).toBeAttached();
      await settle(pageA);
      await shot(pageA, testInfo, `veto-live-${width}-3-a-nach-wahl.png`);

      // Der Rest des Vetos (zwischen den Kontexten), dann steht bei beiden die Spielreihenfolge.
      const rest = { 3: ["b", "glut"], 4: ["b", "werk"], 5: ["a", "kai"], 6: ["b", "turm"], 7: ["a", "nebel"], 8: ["a", "hafen"], 9: ["b", "kai"] };
      for (const [at, [own, mapId]] of Object.entries(rest)) {
        expect(veto.pick(own, mapId, veto.state.version), `Schritt ${at}`).toBe(true);
      }
      expect(veto.status()).toBe("done");
      for (const page of [pageA, pageB]) {
        await expect(page.getByTestId("veto-headline")).toHaveText("Spielreihenfolge steht", { timeout: 8000 });
        await expect(page.getByTestId("veto-planned").locator("li")).toHaveCount(5);
        await expect(page.getByTestId("veto-planned-3")).toContainText("Ruine");
        await expect(page.getByTestId("veto-step-10")).toContainText("Ruine");
        await expectNoSideScroll(page);
      }
      await settle(pageB);
      await shot(pageB, testInfo, `veto-live-${width}-4-fertig.png`);
      await contextA.close();
      await contextB.close();
    });
  }

  test("Zuschauer sieht das laufende Veto nur lesend; reduzierte Bewegung zeigt alles sofort", async ({ browser }, testInfo) => {
    const veto = createVeto();
    veto.pick("a", "hafen", 1);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    await wire(context, veto, null, null);
    const page = await context.newPage();
    await page.goto("/matches/m1");
    const panel = page.getByTestId("veto-panel");
    await expect(panel).toHaveAttribute("data-read-only", "true");
    await expect(page.getByTestId("veto-text")).toContainText(`${SIDES.b} ist am Zug`);
    await expect(page.locator("[data-testid^='veto-option-']")).toHaveCount(0);
    await expect(page.getByTestId("veto-lead")).toHaveCount(0);
    await expect(page.getByTestId("veto-tv-link")).toHaveAttribute("href", "/display/veto/m1");
    // Reduzierte Bewegung: Aufbau und Rahmen ohne Dauer, der Ring ohne Bild-Schleife.
    const durations = await page.evaluate(() => [...document.querySelectorAll(".tls-veto-card--live, .tls-veto-trace > span")]
      .map((node) => parseFloat(getComputedStyle(node).animationDuration)));
    expect(durations.length).toBeGreaterThan(4);
    expect(Math.max(...durations)).toBeLessThan(0.001);
    // Ein Zug von B erscheint beim Zuschauer ohne Neuladen.
    veto.pick("b", "turm", veto.state.version);
    await expect(page.getByTestId("veto-map-hp-turm")).toHaveAttribute("data-status", "banned", { timeout: 6000 });
    await expectNoSideScroll(page);
    await shot(page, testInfo, "veto-live-1440-zuschauer.png");
    await context.close();
  });

  test("TV bei 1920 px: großer Countdown, Brett und Ablauf - live mitgezogen, mit Ablauf-Video", async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const veto = createVeto();
    const size = { width: 1920, height: 1080 };
    const videoDir = SHOT_DIR ? path.join(SHOT_DIR, "video") : testInfo.outputPath("video");
    const context = await browser.newContext({ viewport: size, recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } } });
    await wire(context, veto, null, null);
    const page = await context.newPage();
    await page.goto("/display/veto/m1");
    await expect(page.getByTestId("veto-tv-grid")).toBeVisible();
    await expect(page.getByTestId("tv-header")).toContainText(`${SIDES.a} vs ${SIDES.b}`);
    await expect(page.getByTestId("veto-tv-who")).toContainText(SIDES.a);
    await expect(page.getByTestId("veto-tv-turn")).toHaveAttribute("data-tone", "a");
    await expect(page.getByTestId("veto-timeline").locator("li")).toHaveCount(11);
    await settle(page);
    // Alles auf einem Bildschirm, ohne Scrollen.
    const fits = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(fits).toBe(true);
    await shot(page, testInfo, "veto-live-tv-1920-1-start.png");
    const moves = [["a", "hafen"], ["b", "turm"], ["a", "nebel"], ["b", "glut"]];
    for (const [own, mapId] of moves) {
      veto.pick(own, mapId, veto.state.version);
      await expect(page.getByTestId(`veto-flash-${mapId}`)).toBeAttached({ timeout: 12000 });
      await page.waitForTimeout(1200);
    }
    await expect(page.getByTestId("veto-tv-who")).toContainText(SIDES.b);
    await shot(page, testInfo, "veto-live-tv-1920-2-laeuft.png");
    for (const [own, mapId] of [["b", "werk"], ["a", "kai"], ["b", "turm"], ["a", "nebel"], ["a", "hafen"], ["b", "kai"]]) veto.pick(own, mapId, veto.state.version);
    await expect(page.getByTestId("veto-tv-planned")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("veto-tv-planned").locator("li")).toHaveCount(5);
    await settle(page);
    await page.waitForTimeout(800);
    await shot(page, testInfo, "veto-live-tv-1920-3-fertig.png");
    await context.close();
    const video = await page.video()?.path();
    if (video) await testInfo.attach("veto-live-tv-ablauf.webm", { path: video, contentType: "video/webm" });
  });
});
