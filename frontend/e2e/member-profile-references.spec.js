const { test, expect } = require("@playwright/test");

// Vereinsplatzierungen im Mitgliederprofil (#859, neu im Referenzen-Design #1944): Kopf nur mit Werten über null (die
// vorhandenen Medaillen, ohne Podest „Bestes Ergebnis“), Liga-Weg der Person ab zwei Saisons, Chronik je Jahr mit
// aufklappbaren Zeilen (Aufstellung mit der Person hervorgehoben, Links Saison, Details, Veranstalter). Nichts läuft
// seitlich über. Nur erfundene Namen.

const SHOTS = process.env.SHOT_DIR || "";
const ANNI = { profile_id: "p1", display_name: "Anni", profile_url: "/members/anni" };
const BENNY = { profile_id: "p2", display_name: "Benny", profile_url: "/members/benny" };

const TEAM_CUP = {
  id: "r1", title: "SEASON #3 POWERED BY PROBE® LIGA X", display_title: "SEASON #3 POWERED BY PROBE® LIGA X", organizer: "ESL",
  start_date: "2026-02-14", location: "Innsbruck", game: { id: "g1", name: "Rocket League" }, best_placement: 1, medal: "gold",
  season: "Season 3", league: "Liga X", format: "3vs3", external_url: "https://cup.example/liga-x",
  entries: [
    { id: "e1", kind: "team", team_name: "LION A", placement: 1, medal: "gold", member_profile_ids: ["p9"], lineup: ["Gast"] },
    { id: "e2", kind: "team", team_name: "LION B", placement: 2, medal: "silver", team_count: 16, member_profile_ids: ["p1"], lineup_members: [BENNY, ANNI] },
  ],
};
const LEAGUE_S2 = {
  id: "r5", title: "SEASON #2 POWERED BY PROBE® LIGA X", display_title: "SEASON #2 POWERED BY PROBE® LIGA X", organizer: "ESL",
  start_date: "2025-06-01", game: { id: "g1", name: "Rocket League" }, best_placement: 5, medal: null, season: "Season 2", league: "Liga X",
  entries: [{ id: "e6", kind: "team", team_name: "LION B", placement: 5, team_count: 8, member_profile_ids: ["p1"], lineup_members: [ANNI, BENNY] }],
};
const SOLO_CUP = {
  id: "r2", title: "Herbst Cup", display_title: "Herbst Cup", start_date: "2025-10-04", game: { id: "g2", name: "EA FC" }, best_placement: 3, medal: "bronze",
  entries: [{ id: "e3", kind: "solo", placement: 3, medal: "bronze", participant_count: 32, member_profile_ids: ["p1"], lineup_members: [ANNI] }],
};
const OPEN_CUP = {
  id: "r3", title: "Frühlings Cup", display_title: "Frühlings Cup", start_date: "2026-05-01", game: { id: "g1", name: "Rocket League" }, best_placement: null, medal: null,
  entries: [{ id: "e4", kind: "team", team_name: "LION B", placement: null, member_profile_ids: ["p1"], lineup_members: [ANNI] }],
};
const OTHER_CUP = {
  id: "r4", title: "Sommer Cup", display_title: "Sommer Cup", start_date: "2026-07-01", game: { id: "g2", name: "EA FC" }, best_placement: 1, medal: "gold",
  entries: [{ id: "e5", kind: "solo", placement: 1, medal: "gold", member_profile_ids: ["p2"], lineup_members: [BENNY] }],
};
const own = (item, profileId) => ({ ...item, member_entry: item.entries.find((entry) => entry.member_profile_ids.includes(profileId)) });

const PROFILE = {
  id: "p1", slug: "anni", display_name: "Anni", gamertag: "Anni", bio: "Spielt seit 2019 im Verein.",
  references: [TEAM_CUP, LEAGUE_S2, SOLO_CUP, OPEN_CUP].map((item) => own(item, "p1")),
  reference_stats: { total: 4, gold: 0, silver: 1, bronze: 1, podiums: 2, solo: 1, team: 3 },
};
// Ohne Podest: Benny mit zwei Teilnahmen, die beste ist Platz 4.
const NO_PODIUM = {
  id: "p2", slug: "benny", display_name: "Benny", gamertag: "Benny", bio: "",
  references: [
    own({ ...LEAGUE_S2, entries: [{ ...LEAGUE_S2.entries[0], placement: 4, member_profile_ids: ["p2"] }] }, "p2"),
    own({ ...OPEN_CUP, id: "r6", start_date: "2024-03-01", entries: [{ ...OPEN_CUP.entries[0], placement: 9, team_count: 12, member_profile_ids: ["p2"], lineup_members: [BENNY] }] }, "p2"),
  ],
  reference_stats: { total: 2, gold: 0, silver: 0, bronze: 0, podiums: 0, solo: 0, team: 2 },
};
const LINEAGES = {
  items: [{
    lineage: { title: "Probe Liga X", slug: "probe-liga", kind: "team_league", organizer: "ESL", tier_order: null },
    game: null,
    seasons: [
      { season: "Season 2", tier: "Liga X", season_slug: "s2-liga-x", status: "completed", season_result: "promoted", club: { rank: 5, of: 8 }, reference_ids: ["r5"] },
      { season: "Season 3", tier: "Liga X", season_slug: "s3-liga-x", status: "active", club: { rank: 2, of: 16 }, reference_ids: ["r1"] },
    ],
  }],
};

async function mockServer(page) {
  const json = (data) => ({ contentType: "application/json", body: JSON.stringify(data) });
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, body: "{}" }));
  await page.route("**/api/settings/public", (route) => route.fulfill(json({})));
  await page.route("**/api/home/discord", (route) => route.fulfill(json({ available: false })));
  await page.route("**/api/membership/profiles/anni", (route) => route.fulfill(json(PROFILE)));
  await page.route("**/api/membership/profiles/benny", (route) => route.fulfill(json(NO_PODIUM)));
  await page.route("**/api/reference-series/public/lineages", (route) => route.fulfill(json(LINEAGES)));
  await page.route("**/api/references", (route) => route.fulfill(json({ items: [...PROFILE.references, OTHER_CUP], summary: { total: 5, podiums: 3, gold: 1, silver: 1, bronze: 1 } })));
}

async function acceptCookies(page) {
  const consent = page.getByRole("button", { name: /alle erlauben/i });
  if (await consent.count()) await consent.click();
}

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function hideFixedBars(page) {
  await page.evaluate(() => {
    for (const element of document.querySelectorAll("body *")) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.position === "fixed" && rect.bottom >= window.innerHeight - 2 && rect.height < 140) element.style.visibility = "hidden";
    }
  });
}

for (const width of [390, 1440]) {
  test(`Profil ${width}px: Vereinsplatzierungen im Referenzen-Design - Kopf ohne Nullen, Liga-Weg, Chronik zum Aufklappen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockServer(page);
    await page.goto("/members/anni");
    await acceptCookies(page);
    const section = page.getByTestId("member-references");
    await section.scrollIntoViewIfNeeded();
    await expect(section).toContainText("Vereinsplatzierungen");

    // Kopf: nur die vorhandenen Medaillen - Silber und Bronze, kein „0 Gold“; dazu Teilnahmen, Spiele, „seit“.
    await expect(page.getByTestId("member-reference-medal-silver")).toContainText("1");
    await expect(page.getByTestId("member-reference-medal-bronze")).toContainText("1");
    await expect(page.getByTestId("member-reference-medal-gold")).toHaveCount(0);
    await expect(page.getByTestId("member-reference-best")).toHaveCount(0);
    await expect(page.getByTestId("member-reference-facts")).toContainText("4Teilnahmen");
    await expect(section).not.toContainText("Podestplätze");

    // Liga-Weg der Person: zwei Saisons derselben Spur, mit eigenem Platz und Aufstieg.
    const path = page.getByTestId("member-path-probe-liga");
    await expect(path.getByTestId("member-path-step")).toHaveCount(2);
    await expect(path.locator('[data-note="Aufstieg"]')).toContainText("5.");
    await expect(path.getByRole("link", { name: "Zur Serie" })).toHaveAttribute("href", "/references/series/probe-liga/s3-liga-x");

    // Chronik je Jahr, neueste Teilnahme zuerst offen.
    await expect(page.getByTestId("member-references-year-2026")).toContainText("2 Teilnahmen");
    await expect(page.getByTestId("member-references-year-2025")).toContainText("2 Teilnahmen");
    await expect(page.getByTestId("member-reference-row-r3")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("member-reference-r3").getByTestId("placement-badge")).toHaveAttribute("data-medal", "none");

    // Im Team: Platz 2 des eigenen Teams - nicht der Sieg des anderen Vereinsteams; kurzer Titel, langer im Tooltip.
    const team = page.getByTestId("member-reference-row-r1");
    await expect(team.getByTestId("placement-badge")).toHaveAttribute("data-medal", "silver");
    await expect(team.getByTestId("member-reference-title")).toHaveText("ESL · Liga X · Season 3");
    await expect(team.getByTestId("member-reference-title")).toHaveAttribute("title", "SEASON #3 POWERED BY PROBE® LIGA X");
    await expect(team).toContainText("LION B");
    await expect(team).not.toContainText("LION A");

    // Aufklappen: Aufstellung mit der Person hervorgehoben, Links Saison ansehen, Details, Beim Veranstalter.
    await team.click();
    await expect(team).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("member-reference-row-r3")).toHaveAttribute("aria-expanded", "false");
    const details = page.getByTestId("member-reference-details-r1");
    await expect(details).toBeVisible();
    await expect(details.locator('[data-testid="member-reference-person"][data-self="true"]')).toHaveText("Anni");
    await expect(details.locator('[data-testid="member-reference-person"][data-self="false"]')).toHaveText("Benny");
    const links = page.getByTestId("member-reference-links-r1").getByRole("link");
    await expect(links).toHaveText(["Saison ansehen", "Details", "Beim Veranstalter"]);
    await expect(links.nth(0)).toHaveAttribute("href", "/references/series/probe-liga/s3-liga-x");
    await expect(links.nth(1)).toHaveAttribute("href", "/references/r1");
    await expect(links.nth(2)).toHaveAttribute("href", "https://cup.example/liga-x");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    if (SHOTS) {
      await hideFixedBars(page);
      await section.screenshot({ path: `${SHOTS}/member-references-${width}.png` });
    }

    // „Alle Referenzen“: die Referenzen-Seite nur mit den Teilnahmen dieser Person, der Chip hebt den Filter auf.
    await page.getByTestId("member-references-all").click();
    await expect(page).toHaveURL(/\/references\?member=p1/);
    await expect(page.getByTestId("references-member")).toContainText("Nur Anni");
    // Dieselbe Platzierung und derselbe kurze Titel wie im Profil.
    const ownRow = page.getByTestId("reference-card-r1");
    await expect(ownRow).toBeVisible();
    await expect(ownRow.getByTestId("placement-badge")).toHaveAttribute("data-medal", "silver");
    await expect(ownRow.getByTestId("reference-row-title")).toHaveText("ESL · Liga X · Season 3");
    await expect(page.getByTestId("reference-card-r4")).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/references-member-${width}.png` });
    await page.getByTestId("references-member").click();
    await expect(page.getByTestId("reference-card-r4")).toBeVisible();
    await expect(page.getByTestId("reference-card-r1").getByTestId("placement-badge")).toHaveAttribute("data-medal", "gold");
  });

  test(`Profil ${width}px: ohne Podest „Bestes Ergebnis“ statt Medaillen, ohne zweite Saison kein Liga-Weg`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockServer(page);
    await page.goto("/members/benny");
    await acceptCookies(page);
    const section = page.getByTestId("member-references");
    await section.scrollIntoViewIfNeeded();
    const best = page.getByTestId("member-reference-best");
    await expect(best).toContainText("Bestes Ergebnis");
    await expect(best.getByTestId("placement-badge")).toHaveText("4.");
    await expect(best).toContainText("ESL · Liga X");
    await expect(best).toContainText("Juni 2025 · von 8 Teams");
    await expect(page.getByTestId("member-reference-medals")).toHaveCount(0);
    await expect(section).not.toContainText(/\b0\s*(Gold|Silber|Bronze)/);
    // Nur eine Saison der Spur: kein Weg, die Zeile führt trotzdem zur Saison.
    await expect(page.getByTestId("member-paths")).toHaveCount(0);
    await expect(page.getByTestId("member-references-year-2024")).toContainText("1 Teilnahme");
    await expect(page.getByTestId("member-reference-row-r5")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("member-reference-links-r5").getByRole("link")).toHaveText(["Saison ansehen", "Details"]);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    if (SHOTS) {
      await hideFixedBars(page);
      await section.screenshot({ path: `${SHOTS}/member-references-ohne-podest-${width}.png` });
    }
  });
}
