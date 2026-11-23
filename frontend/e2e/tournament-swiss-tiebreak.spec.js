const { test, expect } = require("@playwright/test");
const path = require("node:path");

// Schweizer System komplett und Gleichstand in Turnier-Tabellen (#1559) im echten Browser: die Einstellungen der
// Turnierleitung und die Erklärung unter der öffentlichen Rangliste - am PC (1440 px) und am Handy (390 px), ohne
// Querlauf. Die API ist nachgestellt, alle Namen sind erfunden. Mit PR_SCREENS=<Ordner> legt der Lauf Bildschirmfotos ab.

const SCREENS = process.env.PR_SCREENS || "";

async function shot(page, name, target = page) {
  if (!SCREENS) return;
  const file = path.join(SCREENS, `${name}-${test.info().project.name === "mobile" ? "390" : "1440"}.png`);
  // Ein Fenster in der Höhe der ganzen Seite: so liegen feste Leisten oben und unten am Rand und nicht mitten im Bild.
  const size = page.viewportSize();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: size.width, height });
  // Was erst jetzt ins Bild kommt, zeichnet sich noch auf (Punkte zählen hoch).
  await page.waitForTimeout(1500);
  await target.screenshot({ path: file });
  await page.setViewportSize(size);
}

async function consent(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false,
      tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
}

const ADMIN = { id: "admin-1", email: "admin@example.test", display_name: "Admin", username: "admin", role: "superadmin",
  is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true };

/** Alles, was die Seiten lesen: `answers` nach Pfad, Listen sonst leer. Schreibende Anfragen landen in `sent`. */
async function mock(page, answers, { user = null, sent = [] } = {}) {
  await consent(page);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      sent.push({ method: request.method(), pathname, body: request.postDataJSON() });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "t-neu" }) });
    }
    if (pathname === "/api/auth/me") return route.fulfill({ contentType: "application/json", body: JSON.stringify(user) });
    if (pathname === "/api/settings/public") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ club_name: "THE LION SQUAD" }) });
    if (pathname in answers) return route.fulfill({ contentType: "application/json", body: JSON.stringify(answers[pathname]) });
    const single = /\/(bracket|matchdays|planning-check)$/.test(pathname);
    return route.fulfill({ contentType: "application/json", body: single ? "{}" : "[]" });
  });
  return sent;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

const mobile = () => test.info().project.name === "mobile";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(mobile() ? { width: 390, height: 844 } : { width: 1440, height: 900 });
});

// ---------------------------------------------------------------- Öffentliche Rangliste

const SWISS = {
  id: "t-swiss", slug: "nebel-open", title: "Nebel Open", status: "live", format: "swiss", team_mode: "solo",
  swiss_settings: { end_rule: "rounds", rounds: 3, top_n: 4, wins_to_advance: 3, losses_to_exit: 3, auto_next_round: true,
    tiebreakers: ["median_buchholz", "buchholz", "head_to_head", "wins"] },
};

function swissRow(name, rank, points, won, lost, buchholz, median, extra = {}) {
  return { registration_id: `r-${rank}-${name}`, display_name: name, rank, played: 3, won, drawn: 0, lost, points,
    buchholz, median_buchholz: median, form: [], ...extra };
}

const SWISS_ROWS = [
  swissRow("Nordlicht", 1, 3, 3, 0, 4, 2, { swiss_status: "advanced", form: ["W", "W", "W"] }),
  swissRow("Steinbock", 2, 2, 2, 1, 6, 2, { swiss_status: "advanced", tiebreak: "median_buchholz", form: ["W", "W", "L"] }),
  swissRow("Eisfuchs", 3, 2, 2, 1, 5, 1, { swiss_status: "advanced", tiebreak: "buchholz", form: ["W", "L", "W"] }),
  swissRow("Morgenstern", 4, 2, 2, 1, 3, 1, { swiss_status: "advanced", tiebreak: "buchholz", form: ["W", "L", "W"] }),
  swissRow("Flusskiesel", 5, 1, 1, 2, 5, 2, { tiebreak: "median_buchholz", form: ["L", "W", "L"] }),
  swissRow("xX_Nebelwolf_Xx.Rudel", 6, 1, 1, 2, 4, 1, { tiebreak: "buchholz", form: ["L", "L", "W"] }),
  swissRow("Dachsbau", 7, 1, 1, 2, 3, 1, { tiebreak: "buchholz", form: ["L", "W", "L"] }),
  swissRow("Kranich", 8, 0, 0, 3, 6, 2, { form: ["L", "L", "L"] }),
];

test.describe("Rangliste erklärt Abschluss und Punktgleichheit (#1559)", () => {
  test("Schweizer System: Abschlussregel, Reihenfolge, Median-Buchholz und wer weiter ist", async ({ page }) => {
    await mock(page, { "/api/tournaments/nebel-open": SWISS, "/api/tournaments/t-swiss": SWISS, "/api/tournaments/t-swiss/standings": SWISS_ROWS });
    await page.goto("/tournaments/nebel-open/standings");
    const rules = page.getByTestId("standings-rules");
    await expect(rules).toContainText("Gespielt werden 3 Runden. Die besten 4 kommen weiter.");
    await expect(rules).toContainText("Reihenfolge: Punkte → Median-Buchholz → Buchholz → Direkter Vergleich → Mehr Siege");
    await expect(rules.locator("[data-rule='median_buchholz']")).toContainText("ohne den besten und den schlechtesten");
    await expect(page.getByRole("columnheader", { name: "MBHZ" })).toBeVisible();
    // Am Handy bleibt neben Median-Buchholz kein zweiter Buchholz-Wert stehen.
    if (mobile()) await expect(page.getByRole("columnheader", { name: "BHZ", exact: true })).toBeHidden();
    else await expect(page.getByRole("columnheader", { name: "BHZ", exact: true })).toBeVisible();
    await expect(page.getByTestId("standing-notes-r-1-Nordlicht")).toHaveText("Weiter");
    await expect(page.getByTestId("standing-notes-r-2-Steinbock")).toContainText("Median-Buchholz");
    await expect(page.locator(".tls-standing-note[data-tone='advance']")).toHaveCount(4);
    // Die Punkte zählen beim ersten Sichtbarwerden hoch - erst am Ziel stimmt das Bild.
    await expect(page.getByTestId("standing-row-r-1-Nordlicht").locator("td[data-col='points']")).toHaveText("3");
    await noSideScroll(page);
    await shot(page, "tabelle-schweizer-system");
  });

  test("Gruppenphase: direkter Vergleich steht unter den Tabellen und an der Zeile", async ({ page }) => {
    const groups = { id: "t-gruppen", slug: "herbst-gruppen", title: "Herbst-Gruppen", status: "live", format: "groups", team_mode: "team",
      table_tiebreakers: ["head_to_head", "score_diff", "score_for", "wins"] };
    const row = (name, rank, points, won, lost, diff, extra = {}) => ({ registration_id: `g-${name}`, display_name: name, rank, played: 3, won, drawn: 0,
      lost, score_for: 4 + diff, score_against: 4, score_diff: diff, points, form: [], ...extra });
    const standings = [
      { group: { id: "ga", group_key: "A", name: "Gruppe A" }, standings: [
        row("Nordlicht", 1, 9, 3, 0, 5), row("Steinbock", 2, 3, 1, 2, -1, { tiebreak: "head_to_head" }),
        row("Eisfuchs", 3, 3, 1, 2, 0, { tiebreak: "head_to_head" }), row("Morgenstern", 4, 3, 1, 2, -4, { tiebreak: "head_to_head" })] },
      { group: { id: "gb", group_key: "B", name: "Gruppe B" }, standings: [
        row("Flusskiesel", 1, 6, 2, 1, 2, { tiebreak: "score_diff" }), row("Dachsbau", 2, 6, 2, 1, 1, { tiebreak: "score_diff" }),
        row("Kranich", 3, 3, 1, 2, 0), row("Uferschwalbe", 4, 3, 1, 2, 0)] },
    ];
    await mock(page, { "/api/tournaments/herbst-gruppen": groups, "/api/tournaments/t-gruppen": groups, "/api/tournaments/t-gruppen/standings": standings });
    await page.goto("/tournaments/herbst-gruppen/standings");
    await expect(page.getByRole("table")).toHaveCount(2);
    const rules = page.getByTestId("standings-rules");
    await expect(rules).toContainText("Reihenfolge: Punkte → Direkter Vergleich → Differenz → Mehr erzielt → Mehr Siege");
    await expect(rules).toContainText("nur die Spiele der Punktgleichen untereinander");
    await expect(page.getByTestId("standing-notes-g-Steinbock")).toHaveText("Direkter Vergleich");
    // Turnier-Worte: „Differenz“, nicht „Map-Differenz“ wie in der Liga.
    await expect(page.getByTestId("standing-notes-g-Flusskiesel")).toHaveText("Differenz");
    await expect(page.getByTestId("standing-row-g-Nordlicht").locator("td[data-col='points']")).toHaveText("9");
    await page.getByTestId("standing-row-g-Flusskiesel").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("standing-row-g-Flusskiesel").locator("td[data-col='points']")).toHaveText("6");
    await noSideScroll(page);
    await shot(page, "tabelle-gruppen-direkter-vergleich");
  });

  test("ein Turnier von früher: die bisherige Reihenfolge steht da, ein K.-o. bekommt keine Erklärung", async ({ page }) => {
    const old = { id: "t-alt", slug: "alt-gruppen", title: "Alt-Gruppen", status: "completed", format: "round_robin", team_mode: "solo" };
    const row = (name, rank) => ({ registration_id: `a-${name}`, display_name: name, rank, played: 2, won: 2 - rank + 1, drawn: 0, lost: rank - 1,
      score_for: 3, score_against: 2, score_diff: 1, points: 9 - 3 * rank, form: [] });
    await mock(page, { "/api/tournaments/alt-gruppen": old, "/api/tournaments/t-alt": old, "/api/tournaments/t-alt/standings": [row("Nordlicht", 1), row("Steinbock", 2)] });
    await page.goto("/tournaments/alt-gruppen/standings");
    await expect(page.getByTestId("standings-rules")).toHaveText("Reihenfolge: Punkte → Mehr Siege → Differenz");
    await expect(page.locator(".tls-standing-note")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------- Turnierverwaltung

const EDIT = {
  id: "t-1", slug: "nebel-open", title: "Nebel Open", status: "registration_open", format: "swiss", team_mode: "solo", max_participants: 16,
  can_manage_structure: true, can_manage_results: true, can_manage_all_results: true, can_plan_matches: true, staff_scopes: [],
  can_check_in: true, can_manage_participants: true, can_assign_stations: true, can_use_staff_tools: true,
};

test.describe("Turnierverwaltung stellt Schweizer System und Gleichstand ein (#1559)", () => {
  test("Bearbeiten: der Kasten „Schweizer System“ steht beim Format, gespeichert wird nur die Änderung", async ({ page }) => {
    const sent = await mock(page, { "/api/tournaments/t-1": EDIT, "/api/games": [{ id: "g1", name: "Sternenkart" }] }, { user: ADMIN });
    await page.goto("/admin/tournaments/t-1?tab=edit");
    const box = page.getByTestId("tr-edit-swiss-settings");
    await expect(box).toBeVisible();
    // Ein Turnier von früher zeigt, wie es bisher läuft.
    await expect(page.getByTestId("tr-edit-swiss-end-rule")).toHaveValue("manual");
    await expect(page.getByTestId("tr-edit-swiss-auto")).not.toBeChecked();
    await page.getByTestId("tr-edit-swiss-end-rule").selectOption("rounds");
    await expect(page.getByTestId("tr-edit-swiss-rounds")).toBeVisible();
    await page.getByTestId("tr-edit-swiss-rounds").fill("5");
    await page.getByTestId("tr-edit-swiss-top-n").fill("8");
    await page.getByTestId("tr-edit-swiss-auto").check();
    // Reihenfolge durch Anklicken: erst alles aus, dann in der gewünschten Folge an.
    await page.getByTestId("tr-edit-swiss-tiebreaker-buchholz").uncheck();
    await page.getByTestId("tr-edit-swiss-tiebreaker-wins").uncheck();
    for (const key of ["median_buchholz", "buchholz", "head_to_head", "wins"]) await page.getByTestId(`tr-edit-swiss-tiebreaker-${key}`).check();
    await expect(page.getByTestId("tr-edit-swiss-tiebreaker-median_buchholz").locator("xpath=..")).toContainText("1.");
    await noSideScroll(page);
    await shot(page, "einstellungen-schweizer-system", box);
    await page.getByTestId("tr-edit-save").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ method: "PATCH", pathname: "/api/tournaments/t-1", body: { swiss_settings: {
      end_rule: "rounds", rounds: 5, top_n: 8, wins_to_advance: 3, losses_to_exit: 3, auto_next_round: true,
      tiebreakers: ["median_buchholz", "buchholz", "head_to_head", "wins"] } } });
    expect(Object.keys(sent[0].body)).toEqual(["swiss_settings"]);
  });

  test("Bearbeiten: Siege und Niederlagen haben eigene Felder; die Turnierseite nennt den Stand", async ({ page }) => {
    const stored = { ...EDIT, status: "live", swiss_settings: { end_rule: "wins_losses", wins_to_advance: 3, losses_to_exit: 3, auto_next_round: true,
      tiebreakers: ["median_buchholz", "buchholz", "head_to_head", "wins"] } };
    await mock(page, {
      "/api/tournaments/t-1": stored,
      "/api/tournaments/t-1/bracket": { rounds: [], swiss: { end_rule: "wins_losses", rounds_played: 3, rounds_total: null, round_open: true, complete: false,
        auto_next_round: true, advanced: 2, eliminated: 2, active: 12, wins_to_advance: 3, losses_to_exit: 3, top_n: null } },
    }, { user: ADMIN });
    await page.goto("/admin/tournaments/t-1?tab=edit");
    await expect(page.getByTestId("admin-tr-swiss-state")).toHaveText("Runde 3 läuft · 2 weiter, 2 raus, 12 offen · die nächste Runde entsteht automatisch");
    await expect(page.getByTestId("tr-edit-swiss-wins")).toHaveValue("3");
    await expect(page.getByTestId("tr-edit-swiss-losses")).toHaveValue("3");
    await expect(page.getByTestId("tr-edit-swiss-rounds")).toHaveCount(0);
    await noSideScroll(page);
  });

  test("Bearbeiten, Gruppenphase: „Bei Punktgleichheit in der Tabelle“ mit direktem Vergleich", async ({ page }) => {
    const sent = await mock(page, { "/api/tournaments/t-1": { ...EDIT, format: "groups" } }, { user: ADMIN });
    await page.goto("/admin/tournaments/t-1?tab=edit");
    const box = page.getByTestId("tr-edit-table-settings");
    await expect(box).toBeVisible();
    await expect(page.getByTestId("tr-edit-swiss-settings")).toHaveCount(0);
    await expect(page.getByTestId("tr-edit-table-tiebreaker-wins")).toBeChecked();
    await page.getByTestId("tr-edit-table-tiebreaker-wins").uncheck();
    await page.getByTestId("tr-edit-table-tiebreaker-score_diff").uncheck();
    for (const key of ["head_to_head", "score_diff", "score_for", "wins"]) await page.getByTestId(`tr-edit-table-tiebreaker-${key}`).check();
    await expect(page.getByTestId("tr-edit-table-tiebreaker-head_to_head").locator("xpath=..")).toContainText("1.");
    await noSideScroll(page);
    await shot(page, "einstellungen-gruppen-punktgleichheit", box);
    await page.getByTestId("tr-edit-save").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].body).toEqual({ table_tiebreakers: ["head_to_head", "score_diff", "score_for", "wins"] });
  });

  test("Anlegen: Schweizer System startet mit fester Rundenzahl, automatischer Runde und Median-Buchholz zuerst", async ({ page }) => {
    const sent = await mock(page, { "/api/games": [{ id: "g1", name: "Sternenkart", slug: "sternenkart" }] }, { user: ADMIN });
    await page.goto("/admin/tournaments/new");
    await expect(page.getByRole("heading", { name: /neues turnier/i })).toBeVisible();
    await page.getByTestId("new-tr-title").fill("Nebel Open");
    await page.getByTestId("new-tr-game").selectOption("g1");
    await page.getByTestId("new-tr-format").selectOption("swiss");
    await page.getByText("Spieloptionen", { exact: true }).click();
    const box = page.getByTestId("new-tr-swiss-settings");
    await expect(box).toBeVisible();
    await expect(page.getByTestId("new-tr-swiss-end-rule")).toHaveValue("rounds");
    await expect(page.getByTestId("new-tr-swiss-auto")).toBeChecked();
    await expect(page.getByTestId("new-tr-swiss-rounds")).toHaveAttribute("placeholder", "Vorschlag: 4");
    await noSideScroll(page);
    await page.getByTestId("new-tr-form").evaluate((form) => form.requestSubmit());
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].body).toMatchObject({ format: "swiss", table_tiebreakers: null, swiss_settings: {
      end_rule: "rounds", rounds: null, top_n: null, auto_next_round: true, tiebreakers: ["median_buchholz", "buchholz", "head_to_head", "wins"] } });
  });
});
