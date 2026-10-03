const { test, expect } = require("@playwright/test");

// Vereinsplatzierungen im Mitgliederprofil (#859): dieselben Bausteine wie die Referenzen-Seite - Medaillen mit
// Zahlen, Podest/Einzel/Team, je Teilnahme die Karte mit der Platzierung dieser Person; nichts läuft seitlich über.

const SHOTS = process.env.SHOT_DIR || "";
const TEAM_CUP = {
  id: "r1", title: "Winter Cup", display_title: "Winter Cup", organizer: "ESL", start_date: "2026-02-14", location: "Innsbruck",
  game: { id: "g1", name: "Rocket League" }, best_placement: 1, medal: "gold", season: "Season 3", league: "Liga X",
  entries: [
    { id: "e1", kind: "team", team_name: "LION A", placement: 1, medal: "gold", member_profile_ids: ["p9"], lineup: ["Gast"] },
    { id: "e2", kind: "team", team_name: "LION B", placement: 2, medal: "silver", team_count: 16, member_profile_ids: ["p1"],
      lineup_members: [{ profile_id: "p1", display_name: "Anni", profile_url: "/members/anni" }, { profile_id: "p2", display_name: "Benny" }] },
  ],
};
const SOLO_CUP = {
  id: "r2", title: "Herbst Cup", display_title: "Herbst Cup", start_date: "2025-10-04", game: { id: "g2", name: "EA FC" }, best_placement: 3, medal: "bronze",
  entries: [{ id: "e3", kind: "solo", placement: 3, medal: "bronze", participant_count: 32, member_profile_ids: ["p1"], lineup_members: [{ profile_id: "p1", display_name: "Anni" }] }],
};
const OPEN_CUP = {
  id: "r3", title: "Frühlings Cup", display_title: "Frühlings Cup", start_date: "2026-05-01", game: { id: "g1", name: "Rocket League" }, best_placement: null, medal: null,
  entries: [{ id: "e4", kind: "team", team_name: "LION B", placement: null, member_profile_ids: ["p1"], lineup_members: [{ profile_id: "p1", display_name: "Anni" }] }],
};
const OTHER_CUP = {
  id: "r4", title: "Sommer Cup", display_title: "Sommer Cup", start_date: "2026-07-01", game: { id: "g2", name: "EA FC" }, best_placement: 1, medal: "gold",
  entries: [{ id: "e5", kind: "solo", placement: 1, medal: "gold", member_profile_ids: ["p2"], lineup_members: [{ profile_id: "p2", display_name: "Benny" }] }],
};
const PROFILE = {
  id: "p1", slug: "anni", display_name: "Anni", gamertag: "Anni", bio: "Spielt seit 2019 im Verein.",
  references: [TEAM_CUP, SOLO_CUP, OPEN_CUP].map((item) => ({ ...item, member_entry: item.entries.find((entry) => entry.member_profile_ids.includes("p1")) })),
  reference_stats: { total: 3, gold: 0, silver: 1, bronze: 1, podiums: 2, solo: 1, team: 2 },
};

async function mockServer(page) {
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, body: "{}" }));
  await page.route("**/api/settings/public", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/home/discord", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ available: false }) }));
  await page.route("**/api/membership/profiles/anni", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(PROFILE) }));
  await page.route("**/api/references", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [...PROFILE.references, OTHER_CUP], summary: { total: 4, podiums: 3, gold: 1, silver: 1, bronze: 1 } }) }));
}

async function acceptCookies(page) {
  const consent = page.getByRole("button", { name: /alle akzeptieren/i });
  if (await consent.count()) await consent.click();
}

for (const width of [390, 1440]) {
  test(`Profil ${width}px: Vereinsplatzierungen wie auf der Referenzen-Seite, je Karte die eigene Platzierung`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockServer(page);
    await page.goto("/members/anni");
    await acceptCookies(page);
    const section = page.getByTestId("member-references");
    await section.scrollIntoViewIfNeeded();
    await expect(section).toContainText("Vereinsplatzierungen");
    await expect(page.getByTestId("member-reference-stat-silver")).toContainText("1");
    await expect(page.getByTestId("member-reference-stat-podiums")).toHaveText("2 Podestplätze");
    const team = page.getByTestId("member-reference-r1");
    await expect(team.getByTestId("placement-badge")).toHaveAttribute("data-medal", "silver");
    await expect(team.getByTestId("reference-entry-e2")).toContainText("LION B");
    await expect(team.getByTestId("reference-entry-e1")).toHaveCount(0);
    await expect(page.getByTestId("member-reference-r3").getByTestId("placement-badge")).toHaveAttribute("data-medal", "none");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    if (SHOTS) {
      await page.evaluate(() => {
        for (const element of document.querySelectorAll("body *")) {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          if (style.position === "fixed" && rect.bottom >= window.innerHeight - 2 && rect.height < 140) element.style.visibility = "hidden";
        }
      });
      await section.screenshot({ path: `${SHOTS}/member-references-${width}.png` });
    }

    // „Alle Referenzen“: die Referenzen-Seite nur mit den Teilnahmen dieser Person, der Chip hebt den Filter auf.
    await page.getByTestId("member-references-all").click();
    await expect(page).toHaveURL(/\/references\?member=p1/);
    await expect(page.getByTestId("references-member")).toContainText("Nur Anni");
    // Dieselbe Platzierung wie im Profil: Platz 2 des eigenen Teams, nicht der Sieg des anderen Vereinsteams.
    const own = page.getByTestId("reference-card-r1");
    await expect(own).toBeVisible();
    await expect(own.getByTestId("placement-badge")).toHaveAttribute("data-medal", "silver");
    await expect(own.getByTestId("reference-entry-e1")).toHaveCount(0);
    await expect(page.getByTestId("reference-card-r4")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/references-member-${width}.png` });
    await page.getByTestId("references-member").click();
    await expect(page.getByTestId("reference-card-r4")).toBeVisible();
    await expect(page.getByTestId("reference-card-r1").getByTestId("placement-badge")).toHaveAttribute("data-medal", "gold");
  });
}
