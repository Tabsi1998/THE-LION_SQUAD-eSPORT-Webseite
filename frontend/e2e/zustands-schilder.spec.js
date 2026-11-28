const path = require("path");
const { test, expect } = require("@playwright/test");

// Zustands-Schilder (#1306) auf Startseite, Dashboard, den Stationen der Turnierleitung und der öffentlichen Turnierseite
// bei 390, 768, 1440 und 2560 px - zusammen alle zehn Arten und die ruhige Spielart „Bestätigt“.
// Geprüft wird: kein Schild bricht um oder wird abgeschnitten, keins ist kleiner als 12 px oder GROSS, der Countdown steht
// neben dem Schild und nie darin, axe-Kontrast an Schild und Countdown. Server nachgestellt, nur erfundene Namen, feste
// Uhr. Mit SHOTS_DIR legt der Test Bilder für die Abnahme ab (kein Bildvergleich mit festen Goldwerten).

const NOW = new Date("2026-11-27T10:00:00+01:00");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (offsetMs) => new Date(NOW.getTime() + offsetMs).toISOString();
const WIDTHS = [[390, 844], [768, 1024], [1440, 900], [2560, 1440]];
const KINDS = ["soon", "registration", "checkin", "free", "live", "joined", "waiting", "problem", "done", "cancelled"];
const HOME_KINDS = ["live", "registration", "checkin", "waiting", "cancelled"];
const DASHBOARD_KINDS = ["joined", "done", "problem", "soon"];
const STATION_KINDS = ["free", "live", "problem", "soon"];

const CONSENT = () => window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
  essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
  saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
}));

function cup(slug, title, phase, startIn = DAY) {
  return { id: slug, slug, title, status: phase.state === "live" ? "live" : "registration_open", start_date: at(startIn), end_date: at(startIn + 6 * HOUR), public_phase: phase };
}

// Startseite, „Nächste Termine“ (höchstens fünf Zeilen): fünf Turniere mit fünf Arten, zwei mit Countdown daneben.
const HOME = {
  has_live: false, live: {}, today: {}, upcoming: {}, leagues: [], news: [], featured_news: [], stats: {},
  soon: {
    tournaments: [
      cup("probe-live", "Probe-Cup am Abend", { state: "live", label: "Läuft" }, -2 * HOUR),
      cup("probe-anmeldung", "Winter-Probe mit sehr langem Namen für schmale Bildschirme", { state: "registration_open", label: "Anmeldung offen", target_at: at(2 * DAY + 3 * HOUR), countdown_kind: "registration_closes" }, 5 * DAY),
      cup("probe-checkin", "Check-in-Probe", { state: "check_in", label: "Check-in offen", target_at: at(3 * HOUR), countdown_kind: "check_in_closes" }, 4 * HOUR),
      cup("probe-pause", "Pausen-Probe", { state: "paused", label: "Pausiert" }, 6 * HOUR),
      cup("probe-abgesagt", "Abgesagte Probe", { state: "cancelled", label: "Abgesagt" }, 2 * DAY),
    ],
  },
};

// Dashboard: heute ein Turnier, dessen Phase schon „Beendet“ ist, mit eigener Anmeldung („Du bist dabei“), dazu ein Spiel
// in Klärung (Problem) und ein angekündigtes (Bald).
const ME = { id: "probe-user", username: "probespieler", display_name: "Probe Spieler", role: "player" };
const DASHBOARD = {
  me: {
    tournaments: [{ id: "d-heute", slug: "heute-probe", title: "Heute-Probe", status: "live", start_date: at(-3 * HOUR), end_date: at(HOUR), public_phase: { state: "completed", label: "Beendet" }, my_registration: { status: "approved" } }],
    events: [],
    matches: [
      { id: "m-probe", tournament_title: "Heute-Probe", status: "disputed", opponent_name: "Team Probe", round: 2 },
      { id: "m-bald", tournament_title: "Heute-Probe", status: "scheduled", opponent_name: "Team Morgen", round: 3, scheduled_at: at(5 * HOUR) },
    ],
    staff_matches: [],
    actions: [],
  },
  season: null,
  stats: {},
};

// Stationen der Turnierleitung: frei (eigene Art „Frei“), läuft, defekt und aufgerufen.
const LEAD = { id: "probe-leitung", username: "leitung", display_name: "Probe Leitung", role: "tournament_admin", is_tournament_staff: true };
const queued = (id, key, extra = {}) => ({
  match_id: id, match_key: key, label: "Viertelfinale", stage_name: "Turnierbaum", names: ["Probe Eins", "Probe Zwei"], open_slots: 0,
  ready: true, heat: false, state: "queued", position: 1, forecast: false, delay_minutes: 0, duration_minutes: 20,
  forecast_at: at(HOUR), planned_at: at(HOUR), ...extra,
});
const QUEUE = {
  applies: true, reason: null, now: NOW.toISOString(), unplaced: [], operate: { all: true, station_ids: [] },
  summary: { delay_minutes: 0, last: { label: "Finale", forecast_at: at(3 * HOUR) } }, matches: {},
  stations: [
    { id: "st-1", name: "PC 1", station_text: "PC 1 · PC", status: "free", waiting: 0, running: null, next: null, after: null },
    { id: "st-2", name: "PC 2", station_text: "PC 2 · PC", status: "busy", waiting: 0, running: queued("m-2", "B", { state: "running", position: 0, started_at: at(-10 * 60000) }), next: null, after: null },
    { id: "st-3", name: "PC 3", station_text: "PC 3 · PC", status: "broken", waiting: 0, running: null, next: null, after: null },
    { id: "st-4", name: "PC 4", station_text: "PC 4 · PC", status: "reserved", waiting: 0, running: null, next: queued("m-4", "D", { state: "called", called_at: at(-60000), report_by: at(60000) }), after: null },
    // Geteilte Station, an der ein anderes Turnier spielt (Fabian Nr. 304): grau, ohne Puls.
    { id: "st-5", name: "Halle 1", station_text: "Halle 1 · Switch 2", status: "reserved", waiting: 0, running: null, next: null, after: null, hold_issue: { kind: "other", tournament_title: "Abend-Probe" } },
  ],
};

// Öffentliche Turnierseite: Kopf „Check-in offen“ mit Countdown daneben, Teilnehmerliste mit fremden Anmeldungen in
// ruhigem Grau (Fabian Nr. 303) und der Warteliste.
const DETAIL = {
  id: "t-detail", slug: "probe-turnier", title: "Probe-Turnier", status: "check_in", start_date: at(4 * HOUR), max_participants: 16,
  participant_count: 3, registration_enabled: true, format: "single_elimination", game: { display_name: "Mario Kart World" },
  public_phase: { state: "check_in", label: "Check-in offen", target_at: at(3 * HOUR), countdown_kind: "check_in_closes" },
};
const REGS = [
  { id: "r1", display_name: "Probe Eins", status: "checked_in", seed: 1 },
  { id: "r2", display_name: "Probe Zwei mit einem langen Namen", status: "approved", seed: 2 },
  { id: "r3", display_name: "Probe Drei", status: "waitlist", seed: null },
];

async function mock(page, { user = null } = {}) {
  await page.addInitScript(CONSENT);
  await page.clock.install({ time: NOW });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname.startsWith("/changes")) return route.abort();
    if (pathname === "/auth/me") return user ? json(user) : route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    if (pathname === "/home/state") return json(HOME);
    if (pathname === "/mobile/dashboard") return json(DASHBOARD);
    if (pathname === "/tournaments/probe-cup/lead") {
      return json({ tournament: { id: "t-probe", slug: "probe-cup", title: "Probe-Cup", status: "live", event_mode: "local" }, now: NOW.toISOString(), matches: [], attention: [], recent: [], stations: [], counts: { open: 0 } });
    }
    if (pathname === "/tournaments/probe-cup/live-queue") return json(QUEUE);
    if (pathname === "/tournaments/probe-turnier") return json(DETAIL);
    if (pathname === "/tournaments/t-detail/registrations") return json(REGS);
    const objects = ["/settings/public", "/home/about", "/chats/unread", "/seasonal/active", "/friends"];
    return json(objects.includes(pathname) ? {} : []);
  });
}

/** Alle sichtbaren Schilder mit Maßen: Art, Text, Zeilen des Worts, abgeschnitten, Schriftgröße, Schreibweise, Lage. */
function measure(page) {
  return page.evaluate(() => [...document.querySelectorAll(".tls-status-chip")]
    .filter((chip) => chip.getClientRects().length && getComputedStyle(chip).visibility !== "hidden")
    .map((chip) => {
      const word = chip.querySelector(".tls-status-chip__word");
      const box = chip.getBoundingClientRect();
      const style = getComputedStyle(chip);
      return {
        kind: chip.dataset.kind,
        text: chip.textContent,
        lines: word.getClientRects().length,
        clipped: chip.scrollWidth > chip.clientWidth + 1,
        fontSize: Number.parseFloat(style.fontSize),
        upper: style.textTransform === "uppercase",
        left: Math.round(box.left),
        right: Math.round(box.right),
        hasMetaInside: Boolean(chip.querySelector(".tls-status__meta")),
        hasIcon: Boolean(chip.querySelector("svg, .tls-live-dot")),
      };
    }));
}

/** Countdowns: stehen in .tls-status neben dem Schild, nie darin. */
function metas(page) {
  return page.evaluate(() => [...document.querySelectorAll(".tls-status__meta")].map((meta) => ({
    text: meta.textContent,
    insideChip: Boolean(meta.closest(".tls-status-chip")),
    besideChip: Boolean(meta.parentElement?.matches(".tls-status") && meta.parentElement.querySelector(":scope > .tls-status-chip")),
  })));
}

async function contrast(page) {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return page.evaluate(async () => {
    const result = await window.axe.run({ include: [[".tls-status-chip"], [".tls-status__meta"]] }, { runOnly: { type: "rule", values: ["color-contrast"] } });
    return result.violations.flatMap((violation) => violation.nodes.map((node) => `${node.target.join(" ")}: ${node.any.map((check) => check.message).join(" ")}`));
  });
}

async function check(page, width, expectedKinds) {
  const chips = await measure(page);
  const kinds = new Set(chips.map((chip) => chip.kind));
  for (const kind of expectedKinds) expect(kinds.has(kind), `Art ${kind} fehlt bei ${width} px`).toBe(true);
  for (const chip of chips) {
    expect(chip.lines, `${chip.text} bricht um bei ${width} px`).toBe(1);
    expect(chip.clipped, `${chip.text} abgeschnitten bei ${width} px`).toBe(false);
    expect(chip.fontSize, `${chip.text} kleiner als 12 px`).toBeGreaterThanOrEqual(12);
    expect(chip.upper, `${chip.text} GROSS`).toBe(false);
    expect(chip.hasMetaInside, `${chip.text} mit Countdown im Schild`).toBe(false);
    expect(chip.hasIcon, `${chip.text} ohne Symbol`).toBe(true);
    expect(chip.left, `${chip.text} links aus dem Bild`).toBeGreaterThanOrEqual(0);
    expect(chip.right, `${chip.text} rechts aus dem Bild`).toBeLessThanOrEqual(width);
  }
  for (const meta of await metas(page)) {
    expect(meta.insideChip, `Countdown „${meta.text}“ im Schild`).toBe(false);
    expect(meta.besideChip, `Countdown „${meta.text}“ nicht neben dem Schild`).toBe(true);
  }
  expect(await contrast(page)).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `seitliches Scrollen bei ${width} px`).toBeLessThanOrEqual(1);
}

async function shot(page, name, width, locator) {
  if (!process.env.SHOTS_DIR) return;
  await locator.screenshot({ path: path.join(process.env.SHOTS_DIR, `${name}-${width}.png`) });
}

for (const [width, height] of WIDTHS) {
  test.describe(`Zustands-Schilder bei ${width} px`, () => {
    test.use({ viewport: { width, height } });

    test("Startseite: fünf Arten, Countdown neben dem Schild", async ({ page }) => {
      await mock(page);
      await page.goto("/");
      const next = page.getByTestId("home-next-up");
      await expect(next).toBeVisible();
      await expect(page.getByTestId("home-next-tournament-probe-abgesagt")).toBeVisible();
      await expect(page.getByTestId("home-next-tournament-probe-anmeldung")).toContainText("Anmeldung offen, endet in 2 Tagen");
      await next.scrollIntoViewIfNeeded();
      await check(page, width, HOME_KINDS);
      await shot(page, "startseite", width, next);
    });

    test("Dashboard: Du bist dabei, Beendet, Problem und Bald", async ({ page }) => {
      await mock(page, { user: ME });
      await page.goto("/dashboard");
      await expect(page.getByTestId("dashboard-timeline-reg-d-heute")).toHaveText("Du bist dabei");
      await expect(page.getByTestId("status-disputed")).toHaveText("Klärung");
      await expect(page.getByTestId("status-scheduled")).toHaveText("Angekündigt");
      await check(page, width, DASHBOARD_KINDS);
      await shot(page, "dashboard", width, page.locator("main"));
    });
    test("Stationen der Turnierleitung: Frei, Läuft, Problem und Bald", async ({ page }) => {
      await mock(page, { user: LEAD });
      await page.goto("/tournaments/probe-cup/leitung?reiter=stationen");
      await expect(page.getByTestId("live-chip-st-1")).toHaveText("Frei");
      await expect(page.getByTestId("live-chip-st-1")).toHaveAttribute("data-kind", "free");
      await expect(page.getByTestId("live-chip-st-2")).toHaveAttribute("data-kind", "live");
      // Ein anderes Turnier an der geteilten Station: grau, ohne Punkt (Fabian Nr. 304).
      await expect(page.getByTestId("live-chip-st-5")).toHaveAttribute("data-kind", "waiting");
      await expect(page.getByTestId("live-chip-st-5").locator(".tls-live-dot")).toHaveCount(0);
      await check(page, width, STATION_KINDS);
      await shot(page, "stationen", width, page.locator("main"));
    });

    test("Turnierseite: Kopf mit Countdown daneben, fremde Anmeldungen ruhig grau", async ({ page }) => {
      await mock(page);
      await page.goto("/tournaments/probe-turnier");
      const head = page.getByTestId("phase-chip").first();
      await expect(head).toHaveText("Check-in offen");
      await expect(page.getByTestId("phase-meta").first()).toContainText("Check-in endet");
      await page.getByTestId("tournament-participants").scrollIntoViewIfNeeded();
      const approved = page.getByTestId("status-approved");
      await expect(approved).toHaveText("Bestätigt");
      await expect(approved).toHaveAttribute("data-variant", "quiet");
      await expect(page.getByTestId("status-checked_in")).toHaveAttribute("data-variant", "quiet");
      await check(page, width, ["checkin", "joined", "waiting"]);
      await shot(page, "turnierseite", width, page.locator("main"));
    });
  });
}

test("alle zehn Arten kommen in den drei Seiten vor", () => {
  expect(new Set([...HOME_KINDS, ...DASHBOARD_KINDS, ...STATION_KINDS])).toEqual(new Set(KINDS));
});
