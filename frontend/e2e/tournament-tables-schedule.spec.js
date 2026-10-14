const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fixture = require("./fixtures/tableScheduleGenerated.json");

// Tabellen, Spielplan, Podest und Sieger-Moment (#1562, #1179, #1339, #1180) im echten Browser. Die Daten kommen aus
// scripts/make_table_schedule_fixture.py (echte Generatoren, Planer und Routen) - keine handgeschriebenen Bäume.
// Mit PR_SCREENS=<Ordner> legt der Lauf zusätzlich Bildschirmfotos für den PR ab.

const SCREENS = process.env.PR_SCREENS || "";

async function shot(page, name) {
  if (!SCREENS) return;
  await page.screenshot({ path: path.join(SCREENS, `${name}-${test.info().project.name}.png`), fullPage: true });
}

async function mock(page, set, { user = null } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false,
      tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const { tournament } = set;
  const base = `/api/tournaments/${tournament.id}`;
  const answers = {
    [`/api/tournaments/${tournament.slug}`]: tournament,
    [`/api/tournaments/${tournament.id}`]: tournament,
    [`${base}/bracket`]: set.bracket,
    [`${base}/standings`]: set.standings || [],
    [`${base}/matchdays`]: set.matchdays || { applies: false, matchdays: [] },
    [`${base}/registrations`]: set.bracket?.registrations || [],
    "/api/auth/me": user,
    "/api/settings/public": { club_name: "THE LION SQUAD" },
  };
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") return route.fulfill({ status: 405, contentType: "application/json", body: "{}" });
    if (pathname in answers) return route.fulfill({ contentType: "application/json", body: JSON.stringify(answers[pathname]) });
    const list = /\/(sponsors|notifications|games|partners|teams\/my|achievements\/me|streams)/.test(pathname);
    return route.fulfill({ contentType: "application/json", body: list ? "[]" : "{}" });
  });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

const PLAYER = { id: "spieler-1", username: "spieler", display_name: "Spieler", role: "user" };

// PC mit 1440 px, Handy mit 375 px (kleinstes übliches Telefon).
test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize(info.project.name === "mobile" ? { width: 375, height: 812 } : { width: 1440, height: 900 });
});

test.describe("Rangliste (#1562, #1179)", () => {
  test("Gruppen: je Gruppe eine Tabelle, die eigene Zeile markiert, am Handy ohne Querlauf", async ({ page }) => {
    await mock(page, fixture.groups, { user: PLAYER });
    await page.goto(`/tournaments/${fixture.groups.tournament.slug}/standings`);
    await expect(page.getByRole("heading", { name: /Gruppe A/ })).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(2);
    await expect(page.locator("tr[data-mine='true']")).toHaveCount(1);
    await expect(page.getByText("Deine Gruppe")).toBeVisible();
    await noSideScroll(page);
    await shot(page, "rangliste-gruppen");
  });

  test("Liga: Form, Differenz und Pfeile seit dem vorigen Spieltag", async ({ page }) => {
    await mock(page, fixture.league, { user: PLAYER });
    await page.goto(`/tournaments/${fixture.league.tournament.slug}/standings`);
    await expect(page.getByRole("columnheader", { name: "Form" })).toBeVisible();
    const moved = fixture.league.standings.filter((row) => row.previous_rank != null && row.previous_rank !== row.rank);
    await expect(page.locator("[data-testid^='standing-move-']")).toHaveCount(moved.length);
    await noSideScroll(page);
    await shot(page, "rangliste-liga");
  });

  test("64 Teilnehmer in acht Gruppen: Sprungmarken, acht Tabellen, kein Querlauf", async ({ page }) => {
    await mock(page, fixture.groups64, { user: PLAYER });
    await page.goto(`/tournaments/${fixture.groups64.tournament.slug}/standings`);
    await expect(page.getByRole("table")).toHaveCount(8);
    await expect(page.getByTestId("standings-group-nav").getByRole("link")).toHaveCount(8);
    await noSideScroll(page);
    await shot(page, "rangliste-64");
  });
});

test.describe("Spielplan (#1562)", () => {
  const live = fixture.onsite.bracket.matches_v2.find((match) => match.status === "in_progress");

  test("das laufende Spiel steht in der Live-Farbe, nicht in Gold", async ({ page }) => {
    await mock(page, fixture.onsite, { user: PLAYER });
    await page.goto(`/tournaments/${fixture.onsite.tournament.slug}/matches`);
    const status = page.getByTestId(`schedule-status-${live.id}`);
    await expect(status).toHaveText(/Läuft/);
    await expect(status).toHaveCSS("color", "rgb(255, 59, 48)");
    await noSideScroll(page);
    await shot(page, "spielplan-runden");
  });

  test("je Station eine Liste, „Nur meine Spiele“, Antippen öffnet die Spielseite", async ({ page }) => {
    await mock(page, fixture.onsite, { user: PLAYER });
    await page.goto(`/tournaments/${fixture.onsite.tournament.slug}/matches`);
    await page.getByTestId("schedule-view-stations").click();
    await expect(page.getByTestId("schedule-stations").getByRole("heading", { level: 2 })).toHaveCount(3);
    await noSideScroll(page);
    await shot(page, "spielplan-stationen");
    await page.getByTestId("schedule-only-mine").click();
    const mineId = fixture.onsite.bracket.registrations.find((reg) => reg.is_mine).id;
    const mine = fixture.onsite.bracket.matches_v2.filter((match) => match.slots.some((slot) => slot.registration_id === mineId));
    await expect(page.locator("[data-testid^='schedule-line-']")).toHaveCount(mine.length);
    await shot(page, "spielplan-nur-meine");
    await page.locator("[data-testid^='schedule-line-']").first().click();
    await expect(page).toHaveURL(new RegExp(`/matches/${mine[0].id}`));
  });
});

test.describe("Podest und Sieger-Moment (#1339, #1180)", () => {
  test("Treppchen nach dem Ende, der eigene Platz einmal als Karte", async ({ page }) => {
    await mock(page, fixture.finished, { user: PLAYER });
    await page.goto(`/tournaments/${fixture.finished.tournament.slug}`);
    const moment = page.getByTestId("placement-moment");
    await expect(moment).toBeVisible();
    await expect(moment).toContainText("Champion");
    if (SCREENS) {
      // Zwischenbild mitten in der Bewegung: alle Animationen bei 300 ms anhalten.
      await page.evaluate(() => document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = 300; }));
      await page.screenshot({ path: path.join(SCREENS, `sieger-moment-zwischenbild-${test.info().project.name}.png`) });
      await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SCREENS, `sieger-moment-${test.info().project.name}.png`) });
    }
    await page.getByTestId("placement-moment-close").click();
    await expect(moment).toHaveCount(0);
    const podium = page.getByTestId("podium");
    await podium.scrollIntoViewIfNeeded();
    await expect(podium.locator("[data-place]")).toHaveCount(3);
    await page.waitForTimeout(1500);
    await noSideScroll(page);
    if (SCREENS) await podium.screenshot({ path: path.join(SCREENS, `podest-${test.info().project.name}.png`) });
    // Einmal je Browser: nach dem Neuladen keine Karte mehr.
    await page.reload();
    await expect(page.getByTestId("podium")).toBeVisible();
    await expect(page.getByTestId("placement-moment")).toHaveCount(0);
  });
});
