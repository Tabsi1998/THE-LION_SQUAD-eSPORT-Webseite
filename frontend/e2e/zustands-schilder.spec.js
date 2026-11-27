const path = require("path");
const { test, expect } = require("@playwright/test");

// Zustands-Schilder (#1306) auf Startseite und Dashboard bei 390, 768, 1440 und 2560 px - zusammen alle neun Arten.
// Geprüft wird: kein Schild bricht um oder wird abgeschnitten, keins ist kleiner als 12 px oder GROSS, der Countdown steht
// neben dem Schild und nie darin, axe-Kontrast an Schild und Countdown. Server nachgestellt, nur erfundene Namen, feste
// Uhr. Mit SHOTS_DIR legt der Test Bilder für die Abnahme ab (kein Bildvergleich mit festen Goldwerten).

const NOW = new Date("2026-11-27T10:00:00+01:00");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (offsetMs) => new Date(NOW.getTime() + offsetMs).toISOString();
const WIDTHS = [[390, 844], [768, 1024], [1440, 900], [2560, 1440]];
const KINDS = ["soon", "registration", "checkin", "live", "joined", "waiting", "problem", "done", "cancelled"];
const HOME_KINDS = ["live", "registration", "checkin", "waiting", "cancelled"];
const DASHBOARD_KINDS = ["joined", "done", "problem", "soon"];

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
  });
}

test("alle neun Arten kommen in den beiden Seiten vor", () => {
  expect([...HOME_KINDS, ...DASHBOARD_KINDS].sort()).toEqual([...KINDS].sort());
});
