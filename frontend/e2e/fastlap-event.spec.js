const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

// Fast Lap vor Ort (#1585): Schnelleingabe mit Gast, „Am Start / Als Nächstes“, TV-Band, Tabelle mit Gast und
// „Versuch 2 von 3“, Urkunde live für die Leitung. Die API ist ein kleines Spielzeug im Browser (page.route), das wie der
// Server rechnet: beste Zeit je Person, Gleichstand früher vorn, Versuche je Person, Grenze aus der Challenge.
// Der letzte Block nimmt den schlimmsten realistischen Fall (lange Namen, Emoji, ein Buchstabe, 200 Fahrer, lange
// Station, 40 Zeichen Gast-Name) und prüft, dass nichts seitlich herausläuft. Mit FASTLAP_SHOTS=<Ordner> legen die Tests
// Bildschirmfotos ab.

const SHOTS = process.env.FASTLAP_SHOTS || "";
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

const LONG_NAMES = [
  "Aleksandra Wiśniewska-Kowalczyk",
  "Maximilian-Alexander von Hohenzoller",
  "Lena 🏎️💨",
  "Jo",
  "Ö",
];

function fakeBackend({ lead = true, worst = false } = {}) {
  const WORST = worst;
  const state = {
    challenge: {
      id: "c-1", slug: "event-fastlap", title: WORST ? "Gamers Heaven 2026 • F1 25 • Fastest Lap Challenge am Simulator | Samstag" : "Fast Lap am Simulator",
      status: "live", visibility: "public", unlimited_attempts: false, max_attempts: 3, attempt_limit: 3,
      online_registration_enabled: false, registration_enabled: false, can_manage_times: true, is_championship: false,
      public_phase: { state: "live", label: "Live" },
      tracks: [{ id: "t-1", name: WORST ? "Spielberg | Red Bull Ring (Grand-Prix-Kurs, trocken)" : "Spielberg", country: "Österreich" }],
      updated_at: "x",
    },
    users: [{ id: "u-1", name: "Fahrerin" }, { id: "u-2", name: "Ben" }],
    guests: [],
    laps: [],
    queue: [],
    clock: Date.parse("2026-10-31T10:00:00Z"),
  };
  const nameOf = (lap) => (lap.guest_id ? state.guests.find((g) => g.id === lap.guest_id)?.display_name : state.users.find((u) => u.id === lap.user_id)?.name) || "?";
  const keyOf = (row) => row.user_id || `guest-${row.guest_id}`;
  const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
  const add = (lap) => { state.clock += 1000; state.laps.push({ id: `lap-${state.laps.length + 1}`, created_at: state.clock, ...lap }); return state.laps.at(-1); };
  if (WORST) {
    LONG_NAMES.forEach((name, index) => state.users.push({ id: `w-${index}`, name }));
    for (let index = 0; index < 195; index += 1) state.users.push({ id: `bulk-${index}`, name: `Fahrer ${index + 1}` });
    state.users.forEach((user, index) => {
      add({ user_id: user.id, track_id: "t-1", time_ms: 80000 + index * 97 + (index % 7) * 13 });
      if (index % 3 === 0) add({ user_id: user.id, track_id: "t-1", time_ms: 0, is_invalid: true });
    });
    state.guests.push({ id: "g-long", display_name: "Maximilian-Alexander von Hohenzoller", number: 1 });
    add({ guest_id: "g-long", track_id: "t-1", time_ms: 599999 });
    add({ guest_id: "g-long", track_id: "t-1", time_ms: 0, is_invalid: true });
    add({ guest_id: "g-long", track_id: "t-1", time_ms: 0, is_invalid: true });
  }
  const board = () => {
    const best = new Map();
    const attempts = new Map();
    for (const lap of state.laps) {
      const key = keyOf(lap);
      attempts.set(key, (attempts.get(key) || 0) + 1);
      if (lap.is_invalid) continue;
      const old = best.get(key);
      if (!old || lap.time_ms < old.time_ms || (lap.time_ms === old.time_ms && lap.created_at < old.created_at)) best.set(key, lap);
    }
    const ordered = [...best.values()].sort((a, b) => a.time_ms - b.time_ms || a.created_at - b.created_at);
    const lead = ordered[0]?.time_ms || 0;
    return {
      track: state.challenge.tracks[0], max_attempts: 3, club_reference_entries: [],
      entries: ordered.map((lap, index) => ({
        user_id: lap.user_id || null, guest_id: lap.guest_id || null, participant_id: keyOf(lap), is_guest: !lap.user_id,
        display_name: nameOf(lap), rank: index + 1, time_ms: lap.time_ms, time_str: fmt(lap.time_ms), attempts: attempts.get(keyOf(lap)),
        gap_ms: lap.time_ms - lead, gap_str: index ? `+${((lap.time_ms - lead) / 1000).toFixed(3)}s` : "", penalty_seconds: 0,
      })),
    };
  };
  const queueRow = (row) => ({
    ...row, is_guest: !!row.guest_id, participant_id: keyOf(row),
    display_name: row.guest_id ? state.guests.find((g) => g.id === row.guest_id)?.display_name : state.users.find((u) => u.id === row.user_id)?.name,
    attempts_used: state.laps.filter((lap) => keyOf(lap) === keyOf(row)).length,
  });
  const queue = () => ({
    max_attempts: 3, stations: ["Simulator 1", "Simulator 2"],
    on_track: state.queue.filter((row) => row.state === "on_track").map(queueRow),
    next: state.queue.filter((row) => row.state !== "on_track").map(queueRow),
  });
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  async function install(page) {
    await page.addInitScript(() => {
      window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
        essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
        saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
      }));
    });
    await page.route("**/api/auth/me", (route) => json(route, lead
      ? { id: "lead-1", display_name: "Leitung", username: "leitung", role: "tournament_admin", is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true }
      : { id: "fan-1", display_name: "Fan", username: "fan", role: "user" }));
    await page.route("**/api/settings/public", (route) => json(route, { club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at" }));
    await page.route("**/api/sponsors**", (route) => json(route, []));
    // Wie der Server: die Suche für Fahrer braucht die Challenge (context_id), sonst fehlt das Recht.
    await page.route("**/api/admin/people/search**", (route) => (new URL(route.request().url()).searchParams.get("context_id") === "c-1"
      ? json(route, state.users.slice(0, 2).map((u) => ({ id: u.id, name: u.name, context: "Community" })))
      : json(route, { detail: "Dafür fehlt dir das Recht: Fahrer und Team einer Fast Lap." }, 403)));
    await page.route(/\/api\/f1\/challenges\/(c-1|event-fastlap)(\?.*)?$/, (route) => json(route, state.challenge));
    await page.route(/\/api\/f1\/challenges\/c-1\/leaderboard/, (route) => json(route, { challenge: state.challenge, ...board() }));
    await page.route(/\/api\/f1\/challenges\/c-1\/(staff|friends)/, (route) => json(route, []));
    await page.route(/\/api\/f1\/challenges\/c-1\/guests$/, async (route) => {
      if (route.request().method() === "GET") return json(route, state.guests);
      const { display_name: name } = route.request().postDataJSON();
      const guest = { id: `g-${state.guests.length + 1}`, display_name: name.trim(), number: state.guests.length + 1, participant_id: `guest-g-${state.guests.length + 1}` };
      state.guests.push(guest);
      return json(route, guest);
    });
    await page.route(/\/api\/f1\/challenges\/c-1\/times(\?.*)?$/, async (route) => {
      if (route.request().method() === "GET") {
        return json(route, [...state.laps].reverse().map((lap) => ({
          ...lap, attempt_number: 1, time_str: lap.is_invalid && !lap.time_ms ? "ohne Zeit" : fmt(lap.time_ms),
          user: { display_name: nameOf(lap), is_guest: !lap.user_id },
        })));
      }
      const body = route.request().postDataJSON();
      const used = state.laps.filter((lap) => keyOf(lap) === keyOf(body)).length;
      if (used >= 3) return json(route, { detail: "Maximale Anzahl Versuche erreicht (3) für offizielle Zeiten." }, 400);
      return json(route, { ...add(body), attempt_number: used + 1 });
    });
    await page.route(/\/api\/f1\/guests\/[^/]+\/link-preview/, (route) => {
      const gid = route.request().url().split("/guests/")[1].split("/")[0];
      const userId = new URL(route.request().url()).searchParams.get("user_id");
      return json(route, {
        laps: state.laps.filter((lap) => lap.guest_id === gid && !lap.user_id).length,
        account_laps: state.laps.filter((lap) => lap.user_id === userId).length,
        guest_name: state.guests.find((g) => g.id === gid)?.display_name,
        account_name: state.users.find((u) => u.id === userId)?.name,
        over_limit: [], needs_reason: false,
      });
    });
    await page.route(/\/api\/f1\/guests\/[^/]+\/link$/, (route) => {
      const gid = route.request().url().split("/guests/")[1].split("/")[0];
      const { user_id: userId } = route.request().postDataJSON();
      let moved = 0;
      for (const lap of state.laps) if (lap.guest_id === gid && !lap.user_id) { lap.user_id = userId; moved += 1; }
      const guest = state.guests.find((g) => g.id === gid);
      if (guest) guest.linked_user_id = userId;
      return json(route, { ok: true, laps_moved: moved, over_limit: [] });
    });
    await page.route(/\/api\/f1\/challenges\/c-1\/queue\/next$/, async (route) => {
      const body = route.request().postDataJSON() || {};
      state.queue = state.queue.filter((row) => row.id !== body.done_id);
      const following = state.queue.find((row) => row.state !== "on_track");
      if (!following) return json(route, null);
      following.state = "on_track";
      following.station = body.station || following.station;
      return json(route, queueRow(following));
    });
    await page.route(/\/api\/f1\/challenges\/c-1\/queue(\?.*)?$/, async (route) => {
      if (route.request().method() === "GET") return json(route, queue());
      const body = route.request().postDataJSON();
      const row = { id: `q-${state.queue.length + 1}-${Date.now()}`, track_id: "t-1", user_id: body.user_id || null, guest_id: body.guest_id || null, station: body.station, state: "next" };
      state.queue.push(row);
      return json(route, queueRow(row));
    });
  }
  return { state, install, add, board };
}

async function expectNoPageXOverflow(page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

test.describe("Fast Lap vor Ort (#1585)", () => {
  test("Schnelleingabe: Gast anlegen, Zeit am Ziffernblock, Versuch zählt, nächster Fahrer", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "einmal reicht - das Handy prüft der Test darunter");
    const api = fakeBackend();
    api.state.queue.push({ id: "q-a", track_id: "t-1", user_id: "u-1", guest_id: null, station: "Simulator 1", state: "on_track" });
    api.state.queue.push({ id: "q-b", track_id: "t-1", user_id: "u-2", guest_id: null, station: null, state: "next" });
    await api.install(page);
    await page.setViewportSize({ width: 1366, height: 1000 });
    await page.goto("/admin/f1/c-1");
    const quick = page.getByTestId("fl-quick");
    await expect(quick).toBeVisible();
    // Genau eine Person am Start: sie ist schon gewählt.
    await expect(page.getByTestId("fl-quick-driver-selected")).toContainText("Fahrerin");
    await expect(page.getByTestId("fl-quick-attempt")).toHaveText("Versuch 1 von 3");
    for (const key of ["1", "colon", "2", "4", "comma", "5", "8", "7"]) await page.getByTestId(`fl-key-${key}`).click();
    await expect(page.getByTestId("fl-quick-time")).toHaveValue("1:24,587");
    await shot(page, "01-schnelleingabe-desktop");
    await page.getByTestId("fl-quick-save").click();
    await expect(page.getByTestId("fl-quick-attempt")).toHaveText("Versuch 2 von 3");
    await page.getByTestId("fl-quick-time").fill("84,2");
    await page.getByTestId("fl-quick-save-next").click();
    await expect(page.getByTestId("fl-quick-driver-selected")).toContainText("Ben");
    await expect(page.getByTestId("fl-queue-ontrack")).toContainText("Ben");
    await expect(page.getByTestId("fl-queue-ontrack")).toContainText("Simulator 1");
    // Ein Gast ohne Konto.
    await page.getByTestId("fl-quick-driver-selected").getByRole("button").click();
    await page.getByTestId("fl-quick-driver-tab-guest").click();
    await page.getByTestId("fl-quick-driver-guest-name").fill("Anna K.");
    await page.getByTestId("fl-quick-driver-guest-create").click();
    await expect(page.getByTestId("fl-quick-driver-selected")).toContainText("Anna K.");
    await page.getByTestId("fl-quick-time").fill("83,9");
    await page.getByTestId("fl-quick-time").press("Enter");
    await expect(page.getByTestId("fl-quick-attempt")).toHaveText("Versuch 2 von 3");
    expect(api.state.laps.at(-1)).toMatchObject({ guest_id: "g-1", time_ms: 83900 });
    await shot(page, "02-am-start-als-naechstes");
  });

  test("Handy 375 px: Schnelleingabe und Tabelle ohne seitliches Scrollen", async ({ page }) => {
    const api = fakeBackend();
    api.add({ user_id: "u-1", track_id: "t-1", time_ms: 84587 });
    api.state.guests.push({ id: "g-1", display_name: "Lena 🏎️💨", number: 1 });
    api.add({ guest_id: "g-1", track_id: "t-1", time_ms: 83990 });
    await api.install(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/admin/f1/c-1");
    await expect(page.getByTestId("fl-quick")).toBeVisible();
    await page.getByTestId("fl-quick").scrollIntoViewIfNeeded();
    await expectNoPageXOverflow(page);
    await shot(page, "03-handy-schnelleingabe");
    await page.goto("/fastlap/event-fastlap");
    await expect(page.getByTestId("f1-row-1")).toContainText("Lena");
    await expect(page.getByTestId("f1-row-1")).toContainText("Gast");
    await expect(page.getByTestId("f1-attempts-1")).toHaveText("1 / 3");
    await expectNoPageXOverflow(page);
    await page.getByTestId("f1-board").scrollIntoViewIfNeeded();
    await shot(page, "04-handy-tabelle");
  });

  test("Tabelle: neue Bestzeit gleitet nach oben, Band „Neue Bestzeit!“, Urkunde jetzt drucken", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "Bewegung einmal am Desktop");
    const api = fakeBackend();
    api.add({ user_id: "u-1", track_id: "t-1", time_ms: 81000 });
    api.add({ user_id: "u-2", track_id: "t-1", time_ms: 82500 });
    api.state.guests.push({ id: "g-1", display_name: "Anna K.", number: 1 });
    api.add({ guest_id: "g-1", track_id: "t-1", time_ms: 83400 });
    await api.install(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/fastlap/event-fastlap");
    await expect(page.getByTestId("f1-row-3")).toContainText("Anna K.");
    await expect(page.getByTestId("f1-attempts-3")).toHaveText("1 / 3");
    // Urkunde jetzt drucken: die Leitung sieht sie live - für den Gast mit seinem Schlüssel.
    await expect(page.getByTestId("f1-certificates")).toHaveText(/Urkunden jetzt drucken/);
    await expect(page.getByTestId("f1-certificate-3")).toHaveAttribute("href", /certificates\/guest-g-1\.pdf/);
    await page.getByTestId("f1-board").scrollIntoViewIfNeeded();
    // Ohne Änderungsstrom fragt die Seite alle 10 s nach - dann gleitet die Zeile nach oben.
    api.add({ guest_id: "g-1", track_id: "t-1", time_ms: 80588 });
    await expect(page.getByTestId("f1-row-1")).toContainText("Anna K.", { timeout: 20000 });
    await shot(page, "05-animation-mittendrin");
    await expect(page.getByTestId("f1-best-flash")).toContainText("Neue Bestzeit!");
    await expect(page.getByTestId("f1-chip-guest-g-1")).toContainText("Neue Bestzeit");
    await expect(page.getByTestId("f1-attempts-1")).toHaveText("2 / 3");
  });

  test("Ohne Leitung: keine Urkunde, solange es läuft", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "einmal reicht");
    const api = fakeBackend({ lead: false });
    api.add({ user_id: "u-1", track_id: "t-1", time_ms: 81000 });
    await api.install(page);
    await page.goto("/fastlap/event-fastlap");
    await expect(page.getByTestId("f1-row-1")).toBeVisible();
    await expect(page.getByTestId("f1-certificates")).toHaveCount(0);
  });

  test("TV zeigt Am Start (mit Station und Versuch) und Als Nächstes", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "TV nur am Desktop");
    const api = fakeBackend();
    api.add({ user_id: "u-1", track_id: "t-1", time_ms: 81000 });
    api.state.guests.push({ id: "g-1", display_name: "Anna K.", number: 1 });
    api.add({ guest_id: "g-1", track_id: "t-1", time_ms: 80400 });
    api.state.queue.push({ id: "q-a", track_id: "t-1", guest_id: "g-1", user_id: null, station: "Simulator 1", state: "on_track" });
    api.state.queue.push({ id: "q-b", track_id: "t-1", user_id: "u-2", guest_id: null, station: null, state: "next" });
    api.state.queue.push({ id: "q-c", track_id: "t-1", user_id: "u-1", guest_id: null, station: null, state: "next" });
    await api.install(page);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/display/f1/c-1");
    await expect(page.getByTestId("tv-queue")).toBeVisible();
    await expect(page.getByTestId("tv-queue-ontrack")).toContainText("Versuch 2 von 3");
    await expect(page.getByTestId("tv-queue-next").first()).toContainText("Ben");
    await expectNoPageXOverflow(page);
    await shot(page, "06-tv-am-start");
  });

  test.describe("schlimmster Fall (break-ui)", () => {
    for (const width of [375, 1366]) {
      test(`lange Namen, Emoji, 200 Fahrer bei ${width} px: nichts läuft seitlich heraus`, async ({ page }, info) => {
        test.skip(info.project.name !== "chromium", "Breiten setzt der Test selbst");
        const api = fakeBackend({ worst: true });
        api.state.queue.push({ id: "q-a", track_id: "t-1", guest_id: "g-long", user_id: null, station: "Simulator 1 – Logitech G Pro Rennsitz", state: "on_track" });
        api.state.queue.push({ id: "q-b", track_id: "t-1", user_id: "w-0", guest_id: null, station: null, state: "next" });
        api.state.queue.push({ id: "q-c", track_id: "t-1", user_id: "w-2", guest_id: null, station: null, state: "next" });
        await api.install(page);
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/fastlap/event-fastlap");
        await expect(page.getByTestId("f1-row-200")).toBeAttached();
        await expectNoPageXOverflow(page);
        await page.getByTestId("f1-board").scrollIntoViewIfNeeded();
        await shot(page, `07-schlimmster-fall-tabelle-${width}`);
        await page.goto("/admin/f1/c-1");
        await expect(page.getByTestId("fl-quick-driver-selected")).toContainText("Maximilian");
        await expect(page.getByTestId("fl-queue-ontrack")).toContainText("Simulator 1");
        await page.getByTestId("fl-quick").scrollIntoViewIfNeeded();
        await expectNoPageXOverflow(page);
        await shot(page, `08-schlimmster-fall-eingabe-${width}`);
      });
    }

    test("TV mit langen Namen und langer Station", async ({ page }, info) => {
      test.skip(info.project.name !== "chromium", "TV nur am Desktop");
      const api = fakeBackend({ worst: true });
      api.state.queue.push({ id: "q-a", track_id: "t-1", guest_id: "g-long", user_id: null, station: "Simulator 1 – Logitech G Pro Rennsitz", state: "on_track" });
      for (const id of ["w-0", "w-1", "w-2", "w-3"]) api.state.queue.push({ id: `q-${id}`, track_id: "t-1", user_id: id, guest_id: null, station: null, state: "next" });
      await api.install(page);
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto("/display/f1/c-1");
      await expect(page.getByTestId("tv-queue-ontrack")).toContainText("Alle 3 Versuche gefahren");
      await expectNoPageXOverflow(page);
      await shot(page, "09-schlimmster-fall-tv");
    });
  });

  test("Gast mit Konto verknüpfen: Vorschau, dann gehören die Zeiten dem Konto", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "einmal reicht");
    const api = fakeBackend();
    api.state.guests.push({ id: "g-1", display_name: "Anna K.", number: 1 });
    const lap = api.add({ guest_id: "g-1", track_id: "t-1", time_ms: 80400 });
    api.add({ guest_id: "g-1", track_id: "t-1", time_ms: 80900 });
    await api.install(page);
    await page.setViewportSize({ width: 1366, height: 1000 });
    await page.goto("/admin/f1/c-1");
    await page.getByTestId(`f1-link-guest-${lap.id}`).click();
    await page.getByTestId("fl-link-person-search").fill("Fa");
    await page.getByTestId("fl-link-person-option-u-1").click();
    await expect(page.getByTestId("fl-link-preview")).toContainText("2 Zeiten von Gast „Anna K.“ gehen an Konto „Fahrerin“");
    await shot(page, "10-gast-verknuepfen");
    await page.getByTestId("fl-link-confirm").click();
    await expect(page.getByTestId("fl-link-dialog")).toHaveCount(0);
    expect(api.state.laps.every((row) => row.user_id === "u-1")).toBe(true);
  });
});
