const { test, expect } = require("@playwright/test");

// Turniere I (#833): Turnierliste mit sichtbaren Bildern, ohne leeres Format-Kästchen, ohne losen Punkt, nach dem
// Ende mit Stand statt „Anmeldung geschlossen“ und einem Knopf; Turnierbaum mit Kürzeln statt leerer Quadrate,
// zweizeiligen Köpfen, „Spiel um Platz 3“, dem Weg eines Spielers beim Darüberfahren und „nicht gespielt“ nach
// dem Ende. Kein seitliches Überlaufen bei 390 px.

const SHOTS = process.env.SHOT_DIR || "";
const COLORS = ["#29B6E8", "#9F7AEA", "#FFD700"];

function banner(index) {
  const color = COLORS[index % COLORS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/>`
    + `<stop offset="1" stop-color="#111"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="1180" cy="420" r="260" fill="rgba(255,255,255,0.18)"/>`
    + `<text x="90" y="800" font-family="Arial" font-size="110" font-weight="900" fill="rgba(255,255,255,0.8)">CUP ${index + 1}</text></svg>`;
}

const LIST = [
  { id: "t1", slug: "herbst-cup", title: "Herbst-Cup 2026", status: "registration_open", format: "single_elim", platform: "PC", game: { short_name: "RL" },
    start_date: "2026-11-14T10:00:00+01:00", max_participants: 16, participant_count: 9, banner_url: "/api/static/uploads/public/cup-0.svg", registration_enabled: true },
  { id: "t2", slug: "smash-sonntag", title: "Gamers Heaven • Super Smash Bros • Sonntag", status: "results_published", format: null, platform: "Nintendo Switch",
    start_date: "2026-06-21T13:00:00+02:00", max_participants: 16, participant_count: 15, banner_url: "/api/static/uploads/public/cup-1.svg" },
  { id: "t3", slug: "mario-kart", title: "Mario Kart Summer Cup", status: "archived", format: "double_elim", platform: "Switch 2", game: { short_name: "MK8DX" },
    start_date: "2026-05-23T13:00:00+02:00", max_participants: 16, participant_count: 13, banner_url: "/api/static/uploads/public/cup-2.svg" },
];

const PLAYERS = ["MrBelt", "Saphira095", "LapanYepLab", "Joey Jo-Jo Junior", "Fluxlplex", "Jacky", "wiasl", "Ryuuu"];
const regs = PLAYERS.map((name, index) => ({ id: `r${index + 1}`, display_name: name, user: index === 0 ? { avatar_url: "/api/static/uploads/public/cup-0.svg" } : {} }));
const duel = (id, round, order, a, b, extra = {}) => ({
  id, stage_id: "s1", section: "WB", round, order, match_key: id.toUpperCase(), match_type: "duel", status: "completed",
  slots: [{ slot: 1, registration_id: a, status: a ? "filled" : "empty" }, { slot: 2, registration_id: b, status: b ? "filled" : "empty" }],
  results: a && b ? [{ registration_id: a, rank: 1, score: 2 }, { registration_id: b, rank: 2, score: 0 }] : [], scheduled_at: "2026-06-21T13:00:00+02:00", ...extra,
});
const BRACKET = {
  stages: [{ id: "s0", name: "Vorrunde", number: 1 }, { id: "s1", name: "Playoffs", number: 2 }],
  registrations: regs,
  matches_v2: [
    { id: "h1", stage_id: "s0", section: "MAIN", round: 1, order: 0, match_key: "A", match_type: "ffa", status: "completed", settings: { qualifiers_per_match: 2 },
      slots: [1, 2, 3, 4].map((n) => ({ slot: n, registration_id: `r${n}` })), results: [1, 2, 3, 4].map((n) => ({ registration_id: `r${n}`, rank: n, score: 20 - n })) },
    { id: "h2", stage_id: "s0", section: "MAIN", round: 1, order: 1, match_key: "B", match_type: "ffa", status: "completed", settings: { qualifiers_per_match: 2 },
      slots: [5, 6, 7, 8].map((n) => ({ slot: n, registration_id: `r${n}` })), results: [5, 6, 7, 8].map((n, i) => ({ registration_id: `r${n}`, rank: i + 1, score: 20 - i })) },
    duel("wa", 1, 0, "r1", "r6"), duel("wb", 1, 1, "r5", "r2"),
    duel("wf", 2, 0, "r1", "r5", { status: "in_progress", results: [] }),
    { ...duel("tp", 1, 0, "r6", "r2", { status: "scheduled", results: [] }), section: "TP", round_name: "Platz 3 Match" },
  ],
};

async function mockServer(page, { status = "live" } = {}) {
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, body: "{}" }));
  await page.route("**/api/settings/public", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/tournaments?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(LIST) }));
  const tournament = { id: "t9", slug: "gamers-heaven", title: "Gamers Heaven • Super Smash Bros", status, format: "custom_bracket", banner_url: "/api/static/uploads/public/cup-1.svg" };
  await page.route("**/api/tournaments/gamers-heaven", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(tournament) }));
  await page.route("**/api/tournaments/t9/bracket**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...BRACKET, tournament }) }));
  await page.route("**/api/static/uploads/public/cup-*", (route) => {
    const index = Number((route.request().url().match(/cup-(\d)/) || [0, 0])[1]);
    return route.fulfill({ contentType: "image/svg+xml", body: banner(index) });
  });
}

async function acceptCookies(page) {
  const consent = page.getByRole("button", { name: /alle akzeptieren/i });
  if (await consent.count()) await consent.click();
}

async function noSideScroll(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

async function shot(page, name) {
  if (!SHOTS) return;
  await page.evaluate(() => {
    for (const element of document.querySelectorAll("body *")) {
      const rect = element.getBoundingClientRect();
      if (getComputedStyle(element).position === "fixed" && rect.bottom >= window.innerHeight - 2 && rect.height < 140) element.style.visibility = "hidden";
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

for (const width of [1440, 390]) {
  test(`Turnierliste ${width}px: Bilder sichtbar, kein Strich-Kästchen, kein loser Punkt, Stand statt „Anmeldung geschlossen“`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockServer(page);
    await page.goto("/tournaments");
    await acceptCookies(page);
    const open = page.getByTestId("tournament-card-herbst-cup");
    const done = page.getByTestId("tournament-card-smash-sonntag");
    await expect(open).toBeVisible();
    expect(Number(await open.locator("img").first().evaluate((node) => getComputedStyle(node).opacity))).toBeGreaterThanOrEqual(0.9);
    await expect(open.getByTestId("tournament-card-action")).toHaveText(/Mitmachen/);
    await expect(done.getByTestId("tournament-card-format")).toHaveCount(0);
    await expect(done.getByTestId("tournament-card-game")).toHaveText("Nintendo Switch");
    await expect(done.getByTestId("tournament-card-registration")).toHaveCount(0);
    await expect(done.getByTestId("tournament-card-action")).toHaveText(/Ergebnisse/);
    await expect(done).not.toContainText("Turnierdetails");
    await noSideScroll(page);
    await shot(page, `tournaments-list-${width}`);
  });
}

test("Turnierbaum 1440px: Kürzel, zweizeilige Köpfe, Spiel um Platz 3, Weg eines Spielers, laufende Partie atmet", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockServer(page);
  await page.goto("/tournaments/gamers-heaven/bracket");
  await acceptCookies(page);
  await expect(page.getByTestId("bracket-match-v2-wa")).toBeVisible();

  // Kürzel statt leerer Quadrate; wer ein Bild hat, zeigt es.
  await expect(page.getByTestId("bracket-match-v2-wb").getByTestId("bracket-initials").first()).toHaveText("F");
  await expect(page.getByTestId("bracket-match-v2-wa").locator("img")).toHaveCount(1);
  // Zweizeiliger Kopf ohne Abschneiden.
  const meta = page.getByTestId("bracket-heat-meta-h1");
  await expect(meta).toHaveText("4 Spieler · 2 kommen weiter");
  expect(await meta.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  // „TP“ heißt jetzt „Spiel um Platz 3“ - und der Runden-Kopf wiederholt es nicht.
  await expect(page.getByTestId("bracket-section-title-tp")).toHaveText("Spiel um Platz 3");
  await expect(page.getByTestId("bracket-section-tp")).not.toContainText("Platz 3 Match");
  // Die laufende Partie atmet.
  expect(await page.getByTestId("bracket-match-v2-wf").evaluate((node) => getComputedStyle(node).animationName)).toBe("tls-bracket-live");

  // Fahren über „MrBelt“: seine Partien leuchten, der Rest tritt zurück; die Linie zwischen seinen Partien zieht mit.
  // Ohne Maus (Touch) bleibt alles ruhig - dort öffnet ein Tippen die Partie.
  const canHover = await page.evaluate(() => window.matchMedia("(hover: hover)").matches);
  await page.getByTestId("bracket-match-v2-wa").getByText("MrBelt").hover();
  if (!canHover) {
    await expect(page.getByTestId("bracket-match-v2-wb")).not.toHaveAttribute("data-path", /.+/);
    return;
  }
  await expect(page.getByTestId("bracket-match-v2-wa")).toHaveAttribute("data-path", "on");
  await expect(page.getByTestId("bracket-match-v2-wf")).toHaveAttribute("data-path", "on");
  await expect(page.getByTestId("bracket-match-v2-wb")).toHaveAttribute("data-path", "off");
  await expect(page.locator(".tls-bracket-line[data-path='on']")).toHaveCount(1);
  await expect.poll(() => page.getByTestId("bracket-match-v2-wb").evaluate((node) => Number(getComputedStyle(node).opacity))).toBeLessThan(0.5);
  // Mehrere Phasen: Vorrunden-Sieger tragen kein Podium - Plätze kommen nur aus den Playoffs.
  await expect(page.getByTestId("bracket-match-v2-wa")).not.toContainText("#1");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tournament-bracket-1440-path.png` });
  await shot(page, "tournament-bracket-1440");
  await page.mouse.move(5, 5);
  await expect(page.getByTestId("bracket-match-v2-wb")).not.toHaveAttribute("data-path", /.+/);
});

test("Turnierbaum nach dem Ende: „nicht gespielt“ statt „Geplant“, nichts atmet; 390px ohne Überlaufen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockServer(page, { status: "archived" });
  await page.goto("/tournaments/gamers-heaven/bracket");
  await acceptCookies(page);
  await expect(page.getByTestId("bracket-section-title-tp")).toHaveText("Spiel um Platz 3");
  await expect(page.getByTestId("bracket-section-tp").getByTestId("bracket-not-played")).toHaveText("nicht gespielt");
  await noSideScroll(page);
  await shot(page, "tournament-bracket-390-archived");
});
