const { test, expect } = require("@playwright/test");
const { mockTvApi } = require("./fixtures/tvMock");

// Sieger-Moment beim Saisonabschluss (#2410): Eine Liga-Staffel wird abgeschlossen - der TV zeigt das Podest Platz 1 bis 3 mit Team,
// Liga N und Season und je Platz der Belohnung (RewardArt). Bei 1920 und 1440 lesbar und ganz im Bild, Sockel 2-1-3, der Meister am
// höchsten; mit „Bewegung reduzieren“ steht sofort das Endbild; ohne Belohnungen die Karte wie bisher. Feste Uhr, alle Namen erfunden,
// alle Antworten aus dem Test (page.route). Bild in SHOT_DIR, wenn gesetzt.

const SHOTS = process.env.SHOT_DIR || "";
const TV = "/display/bracket/t1?key=tv-schluessel&pixel_shift=0&playlist=tree";
const TEAMS = ["Nordlicht Esports", "Steinbock Gaming", "Wolkenfuchs Clan", "Kieselkatze"];
// Schlimmster Fall: lange Namen ohne Leerzeichen, lange Belohnungen, drei Belohnungen auf Platz 1.
const LONG_TEAMS = ["Donaudampfschifffahrtsgesellschaftskapitäne Esports Akademie", "Die Unaufhaltsamen Nordlicht-Wölfe aus dem Waldviertel",
  "Kieselkatzen-Verteidigungsbündnis Ost Gaming Collective", "Kieselkatze"];
let REGS = TEAMS.map((name, index) => ({ id: `r${index + 1}`, display_name: name, status: "approved" }));
const PAIRS = [["r1", "r2"], ["r3", "r4"], ["r1", "r3"], ["r2", "r4"], ["r1", "r4"], ["r2", "r3"]];
const MATCHES = PAIRS.map(([a, b], index) => ({
  id: `m${index + 1}`, stage_id: "s1", stage_type: "league", section: "LIGA", round: Math.floor(index / 2) + 1, order: index,
  match_key: `M${index + 1}`, status: "completed", settings: { match_size: 2 }, winner_id: a,
  slots: [{ slot: 1, registration_id: a }, { slot: 2, registration_id: b }],
  results: [{ registration_id: a, rank: 1, score: 2 }, { registration_id: b, rank: 2, score: 0 }],
}));
const standingsOf = (regs) => regs.map((reg, index) => ({ registration_id: reg.id, display_name: reg.display_name, rank: index + 1, played: 3,
  won: 3 - index, drawn: 0, lost: index, score_diff: 6 - index * 4, points: (3 - index) * 3 }));
const reward = (id, kind, name, rank) => ({ id, kind, name, image_url: null, art: { place: `${rank}. Platz`, metal: { 1: "gold", 2: "silver", 3: "bronze" }[rank] } });
const PODIUM = {
  league: "Probe-Liga", season: "Season 3", division: "Liga 1",
  places: [
    { rank: 1, registration_id: "r1", rewards: [reward("gold", "medal", "Goldmedaille", 1), reward("banner", "banner", "Meister-Banner", 1), reward("title", "title", "Champion", 1)] },
    { rank: 2, registration_id: "r2", rewards: [reward("silver", "medal", "Silbermedaille", 2)] },
    { rank: 3, registration_id: "r3", rewards: [reward("bronze", "emblem", "Bronze-Emblem", 3)] },
  ],
};

function staffel(status, extra = {}) {
  return {
    tournament: { id: "t1", slug: "probe-liga-s3-a", title: "Probe-Liga · Season 3 · Liga 1 · Staffel A", status, format: "league", team_mode: "team" },
    registrations: REGS, stages: [{ id: "s1", name: "Liga", number: 1, stage_type: "league" }], matches_v2: MATCHES, standings: standingsOf(REGS),
    league_podium: null, display_key: true, ...extra,
  };
}

/** Die Staffel läuft, dann schließt die Leitung sie ab - der TV holt den neuen Stand über den Änderungsstrom. */
async function closeOnTv(page, query = "", podium = PODIUM) {
  await page.clock.install({ time: new Date("2026-11-15T20:00:00+01:00") });
  const state = await mockTvApi(page, { bracket: staffel("live") });
  await page.goto(`${TV}${query}`);
  await expect(page.getByTestId("tv-tree")).toBeVisible();
  await page.waitForTimeout(900);
  state.bracket = staffel("completed", { league_podium: podium });
  state.push();
  const card = page.getByTestId("tv-champion");
  await expect(card).toBeVisible({ timeout: 8000 });
  return card;
}

/** Wo was steht: Sockel, Grafiken und Namen - alles im Bild, kein Name abgeschnitten. */
function inspectPodium(page) {
  return page.evaluate(() => {
    const view = { width: window.innerWidth, height: window.innerHeight };
    const box = (element) => element.getBoundingClientRect();
    const inside = (rect) => rect.left >= -1 && rect.top >= -1 && rect.right <= view.width + 1 && rect.bottom <= view.height + 1;
    const card = document.querySelector("[data-testid='tv-champion']");
    const places = Object.fromEntries([1, 2, 3].map((rank) => {
      const col = document.querySelector(`[data-testid='tv-podium-place-${rank}']`);
      return [rank, { x: box(col).left, block: box(col.querySelector(".tv-league-podium__block")).height, art: col.querySelector(".tv-league-podium__main .tls-reward") ? box(col.querySelector(".tv-league-podium__main .tls-reward")).width : 0 }];
    }));
    const names = [...card.querySelectorAll("[data-tv-name]")];
    // Jeder Sockel mit seiner Ziffer liegt ganz in der Karte - nichts wird unten abgeschnitten.
    const frame = box(card);
    const within = (rect) => rect.left >= frame.left - 1 && rect.top >= frame.top - 1 && rect.right <= frame.right + 1 && rect.bottom <= frame.bottom + 1;
    const blocksCut = [...card.querySelectorAll(".tv-league-podium__block")].filter((block) => {
      const digit = block.querySelector(".tv-league-podium__rank");
      return !within(box(block)) || !within(box(digit)) || !inside(box(block));
    }).map((block) => block.textContent);
    return {
      cardInside: inside(box(card)),
      cut: names.filter((element) => element.scrollWidth > element.clientWidth + 1 || !inside(box(element))).map((element) => element.textContent),
      blocksCut,
      small: names.filter((element) => parseFloat(getComputedStyle(element).fontSize) < 18).map((element) => element.textContent),
      places,
    };
  });
}

test.describe("TV-Podest beim Saisonabschluss (#2410)", () => {
  test("1920 px: Podest 2-1-3 mit Liga N, Season und Belohnungen, ganz im Bild - danach parkt der Meister", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const card = await closeOnTv(page);
    await expect(card).toHaveAttribute("data-podium", "1");
    await expect(page.getByTestId("tv-podium-line")).toHaveText("Probe-Liga · Liga 1 · Season 3");
    await expect(page.getByTestId("tv-podium-winner")).toContainText("Nordlicht Esports");
    await expect(page.getByTestId("tv-podium-place-2")).toContainText("Steinbock Gaming");
    await expect(page.getByTestId("tv-podium-place-3")).toContainText("Wolkenfuchs Clan");
    await expect(page.getByTestId("tv-podium-art-gold")).toHaveAttribute("data-metal", "gold");
    await expect(page.getByTestId("tv-podium-art-silver")).toHaveAttribute("data-metal", "silver");
    await expect(page.getByTestId("tv-podium-art-bronze")).toHaveAttribute("data-metal", "bronze");
    await expect(page.getByTestId("tv-podium-place-1")).toContainText("Goldmedaille · Meister-Banner · Champion");
    // Gestaffelt: der Meister kommt zuletzt - kurz nach dem Start ist er noch nicht da, die Sockel schon unterwegs.
    const early = await page.getByTestId("tv-podium-winner").evaluate((element) => Number(getComputedStyle(element).opacity));
    expect(early).toBeLessThan(0.5);
    await page.waitForTimeout(3200);
    await expect(page.getByTestId("tv-podium-winner")).toHaveCSS("opacity", "1");
    const seen = await inspectPodium(page);
    expect(seen.cardInside).toBe(true);
    expect(seen.cut).toEqual([]);
    expect(seen.small).toEqual([]);
    expect(seen.places[2].x).toBeLessThan(seen.places[1].x);
    expect(seen.places[1].x).toBeLessThan(seen.places[3].x);
    expect(seen.places[1].block).toBeGreaterThan(seen.places[2].block);
    expect(seen.places[2].block).toBeGreaterThan(seen.places[3].block);
    expect(seen.places[1].art).toBeGreaterThan(seen.places[2].art);
    expect(seen.places[2].art).toBeGreaterThan(100);
    expect(seen.blocksCut).toEqual([]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/tv-podest-1920.png` });
    await expect(page.getByTestId("tv-champion-parked")).toBeVisible({ timeout: 8000 });
    await expect(card).toHaveCount(0);
  });

  test("1440 px: alles lesbar und ganz im Bild", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await closeOnTv(page);
    await page.waitForTimeout(3200);
    const seen = await inspectPodium(page);
    expect(seen.cardInside).toBe(true);
    expect(seen.cut).toEqual([]);
    expect(seen.places[1].block).toBeGreaterThan(seen.places[3].block);
    expect(seen.blocksCut).toEqual([]);
  });

  for (const size of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    test(`schlimmster Fall bei ${size.width} px: lange Namen und Belohnungen - Sockel mit Ziffer ganz in der Karte`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize(size);
      REGS = LONG_TEAMS.map((name, index) => ({ id: `r${index + 1}`, display_name: name, status: "approved" }));
      const long = (id, kind, name, rank) => reward(id, kind, name, rank);
      const podium = { league: "Lionsquad Call of Duty Ranked Liga Europa", season: "Season 2026/27 Herbst-Winter-Split", division: "Liga 1 · Elite-Division",
        places: [
          { rank: 1, registration_id: "r1", rewards: [long("gold", "medal", "Goldmedaille der unbesiegbaren Meisterinnen und Meister", 1),
            long("banner", "banner", "Meister-Banner für die Ewigkeit", 1), long("title", "title", "Unaufhaltsame Legende", 1)] },
          { rank: 2, registration_id: "r2", rewards: [long("silver", "medal", "Silbermedaille für die tapfersten Zweitplatzierten", 2)] },
          { rank: 3, registration_id: "r3", rewards: [long("bronze", "emblem", "Bronze-Emblem der Durchhaltekünstler", 3)] },
        ] };
      try {
        await closeOnTv(page, "", podium);
        await page.waitForTimeout(3200);
        const seen = await inspectPodium(page);
        expect(seen.cardInside).toBe(true);
        expect(seen.blocksCut).toEqual([]);
        expect(seen.places[1].block).toBeGreaterThan(seen.places[2].block);
        expect(seen.places[2].block).toBeGreaterThan(seen.places[3].block);
        if (SHOTS && size.width === 1440) await page.screenshot({ path: `${SHOTS}/worst-1440.png` });
      } finally {
        REGS = TEAMS.map((name, index) => ({ id: `r${index + 1}`, display_name: name, status: "approved" }));
      }
    });
  }

  test("„Bewegung reduzieren“: das Podest steht sofort, nichts bewegt sich", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const card = await closeOnTv(page, "&reduce_motion=1");
    await expect(page.getByTestId("tv-screen")).toHaveAttribute("data-tv-motion", "off");
    await expect(card).toHaveAttribute("data-podium", "1");
    await expect(page.getByTestId("tv-podium-winner")).toHaveCSS("opacity", "1");
    const running = await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length);
    expect(running).toBe(0);
    await expect(page.getByTestId("tv-podium-art-gold")).not.toHaveAttribute("data-play", /.+/);
  });

  test("ohne Belohnungen bleibt der Sieger-Moment wie bisher", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const card = await closeOnTv(page, "", null);
    await expect(card).not.toHaveAttribute("data-podium", /.+/);
    await expect(card).toContainText("Champion");
    await expect(card).toContainText("Platz 2: Steinbock Gaming");
  });
});

// Liga-Wörter am TV (#2262, Paket D): Eine entschiedene Staffel heißt „Staffel entschieden“, nicht „Turnier entschieden“. Der Server
// schickt dafür nur `staffel: true`. Bild in E2E_SCREENS_DIR, wenn gesetzt.
for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`TV einer Staffel (${width} px): „Staffel entschieden“ statt „Turnier entschieden“`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.clock.install({ time: new Date("2026-11-15T20:00:00+01:00") });
    await mockTvApi(page, { bracket: staffel("completed", { staffel: true }) });
    await page.goto(TV);
    const tv = page.getByTestId("bracket-tv");
    await expect(tv).toContainText("Staffel entschieden", { timeout: 8000 });
    await expect(tv).not.toContainText("Turnier entschieden");
    if (process.env.E2E_SCREENS_DIR) await page.screenshot({ path: require("node:path").join(process.env.E2E_SCREENS_DIR, `tv-staffel-${width}.png`) });
  });
}
