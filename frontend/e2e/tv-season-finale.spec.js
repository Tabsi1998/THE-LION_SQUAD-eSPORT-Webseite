const { test, expect } = require("@playwright/test");
const { mockTvApi } = require("./fixtures/tvMock");

// Saisonfinale am TV (#1641): Nach dem Sieger-Moment drückt die Leitung „Weiter“ - der TV zeigt je Liga N die Auf- und Absteiger. Die
// Zeilen gleiten gestaffelt auf ihren Platz, danach die Ziel-Liga, zuletzt die Linie unter dem Titel. „Weiter“ blättert zur nächsten
// Liga N, „Ende“ bringt das gewohnte Bild. Bei 1920 und 2560 px lesbar und ganz im Bild, mit „Bewegung reduzieren“ sofort das Endbild.
// Viele Kandidaten (Nr. 235): höchstens 8 Zeilen je Spalte, darunter „und N weitere“ - sichtbar, über der Fußleiste, kein Name unter
// der Untergrenze der TV-Namen (--tv-fs-name-min).
// Feste Uhr, alle Namen erfunden, alle Antworten aus dem Test (page.route). Bilder in SHOT_DIR, wenn gesetzt.

const SHOTS = process.env.SHOT_DIR || "";
const TV = "/display/bracket/t1?key=tv-schluessel&pixel_shift=0&playlist=tree";
const REGS = ["Nordlicht Esports", "Steinbock Gaming", "Wolkenfuchs Clan", "Kieselkatze"].map((name, index) => ({ id: `r${index + 1}`, display_name: name, status: "approved" }));
const PAIRS = [["r1", "r2"], ["r3", "r4"], ["r1", "r3"], ["r2", "r4"], ["r1", "r4"], ["r2", "r3"]];
const MATCHES = PAIRS.map(([a, b], index) => ({
  id: `m${index + 1}`, stage_id: "s1", stage_type: "league", section: "LIGA", round: Math.floor(index / 2) + 1, order: index,
  match_key: `M${index + 1}`, status: "completed", settings: { match_size: 2 }, winner_id: a,
  slots: [{ slot: 1, registration_id: a }, { slot: 2, registration_id: b }],
  results: [{ registration_id: a, rank: 1, score: 2 }, { registration_id: b, rank: 2, score: 0 }],
}));
const STANDINGS = REGS.map((reg, index) => ({ registration_id: reg.id, display_name: reg.display_name, rank: index + 1, played: 3,
  won: 3 - index, drawn: 0, lost: index, score_diff: 6 - index * 4, points: (3 - index) * 3, zone: index === 3 ? "relegation" : null }));
const LONG = "Donaudampfschifffahrtsgesellschaftskapitäne Esports Akademie";
const PAGES = [
  { division_id: "d1", level: 1, label: "Liga 1", staffeln: 1, more: 0,
    rows: [{ registration_id: "r4", name: "Kieselkatze", rank: 4, move: "down", target: "Liga 2 · Aufbau", staffel: null }] },
  { division_id: "d2", level: 2, label: "Liga 2 · Aufbau", staffeln: 2, more: 0, rows: [
    { registration_id: "b1", name: "Talwind Tirol", rank: 1, move: "up", target: "Liga 1", staffel: "A" },
    { registration_id: "b2", name: LONG, rank: 1, move: "up", target: "Liga 1", staffel: "B" },
    { registration_id: "b3", name: "Gletscherblick Gaming", rank: 4, move: "down", target: "Liga 3", staffel: "A" },
    { registration_id: "b4", name: "Murmeltier Crew", rank: 5, move: "out", target: null, staffel: "B" },
  ] },
  { division_id: "d3", level: 3, label: "Liga 3", staffeln: 1, more: 0,
    rows: [{ registration_id: "c1", name: "Almrausch Five", rank: 1, move: "up", target: "Liga 2 · Aufbau", staffel: null }] },
];

function staffel(finale = null) {
  return {
    tournament: { id: "t1", slug: "probe-liga-s3-a", title: "Probe-Liga · Season 3 · Liga 1 · Staffel A", status: "completed", format: "league", team_mode: "team" },
    registrations: REGS, stages: [{ id: "s1", name: "Liga", number: 1, stage_type: "league" }], matches_v2: MATCHES, standings: STANDINGS,
    league_podium: null, league_finale: finale, display_key: true, staffel: true,
  };
}

const finale = (step, pages = PAGES) => ({ step, count: pages.length, league: "Probe-Liga", season: "Season 3", pages });

// Zwölf Kandidaten in einer Liga N, so wie der Server sie schickt: je Spalte höchstens 8 Zeilen, der Rest gezählt (more_up, more_down).
const BIRDS = ["Ost", "Lux", "Elf", "Ara", "Ibis", "Ork", "Uhu", "Emu", "Gnu", "Yak", "Reh", "Hai"];
const MANY = [{ division_id: "d2", level: 2, label: "Liga 2", staffeln: 3, more: 8, more_up: 4, more_down: 4, rows: [
  ...BIRDS.slice(0, 8).map((name, index) => ({ registration_id: `u${index}`, name: index === 5 ? LONG : `${name} Aufwind`, rank: 1 + (index % 2),
    move: "up", target: "Liga 1 · Meisterklasse der Probe-Liga", staffel: "ABC"[index % 3] })),
  ...BIRDS.slice(0, 8).map((name, index) => ({ registration_id: `d${index}`, name: index === 2 ? LONG : name, rank: 4 + (index % 2),
    move: "down", target: "Liga 3", staffel: "ABC"[index % 3] })),
] }];

/** Die Staffel ist abgeschlossen, der Sieger steht - dann drückt die Leitung „Weiter“ (Stand über den Änderungsstrom). */
async function openFinale(page, query = "", step = 2, pages = PAGES) {
  await page.clock.install({ time: new Date("2026-11-23T20:00:00+01:00") });
  const state = await mockTvApi(page, { bracket: staffel() });
  await page.goto(`${TV}${query}`);
  await expect(page.getByTestId("tv-tree")).toBeVisible();
  await page.waitForTimeout(600);
  state.bracket = staffel(finale(step, pages));
  state.push();
  await expect(page.getByTestId("tv-finale")).toBeVisible({ timeout: 8000 });
  return state;
}

/** Alles im Bild, kein Name abgeschnitten, nichts zu klein, keine Zeile über der anderen. */
function inspectFinale(page) {
  return page.evaluate(() => {
    const view = { width: window.innerWidth, height: window.innerHeight };
    const box = (element) => element.getBoundingClientRect();
    const inside = (rect) => rect.left >= -1 && rect.top >= -1 && rect.right <= view.width + 1 && rect.bottom <= view.height + 1;
    const root = document.querySelector("[data-testid='tv-finale']");
    const rows = [...root.querySelectorAll(".tv-finale__row")];
    const names = [...root.querySelectorAll(".tv-finale__name")];
    const targets = [...root.querySelectorAll(".tv-finale__target")];
    const mores = [...root.querySelectorAll(".tv-finale__more")];
    const footer = document.querySelector("footer, .tv-footer");
    // Die echte Untergrenze der TV-Namen - so, wie sie bei dieser Größe gilt.
    const probe = document.createElement("span");
    probe.style.fontSize = "var(--tv-fs-name-min)";
    root.appendChild(probe);
    const minName = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    const overlap = rows.some((row, index) => rows.some((other, j) => j > index && row.parentElement === other.parentElement
      && box(row).bottom > box(other).top + 1 && box(other).bottom > box(row).top + 1));
    return {
      rowsInside: rows.every((row) => inside(box(row))),
      footer: Boolean(footer),
      aboveFooter: !footer || [...rows, ...mores].every((element) => box(element).bottom <= box(footer).top + 1),
      mores: mores.map((element) => ({ text: element.textContent, inside: inside(box(element)), height: box(element).height })),
      minName,
      nameNames: names.length,
      targetsBesideName: rows.every((row) => {
        const name = row.querySelector(".tv-finale__who");
        const target = row.querySelector(".tv-finale__target");
        return !target || box(name).right <= box(target).left + 1;
      }),
      nameWidth: Math.min(...rows.map((row) => box(row.querySelector(".tv-finale__who")).width)),
      cut: names.filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent),
      targetsInside: targets.every((target) => box(target).right <= box(target.closest(".tv-finale__row")).right + 1),
      small: names.filter((element) => parseFloat(getComputedStyle(element).fontSize) < minName - 0.5).map((element) => element.textContent),
      overlap,
      cols: [...root.querySelectorAll(".tv-finale__col")].map((col) => ({ key: col.dataset.col, x: box(col).left })),
    };
  });
}

for (const size of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
  test.describe(`TV-Saisonfinale bei ${size.width} px (#1641)`, () => {
    test("Weiter zeigt je Liga N die Auf- und Absteiger - gestaffelt, ganz im Bild, Ende bringt das gewohnte Bild", async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize(size);
      const state = await openFinale(page);
      await expect(page.getByTestId("tv-finale-title")).toHaveText("Liga 2 · Aufbau Auf- und Absteiger");
      // Die Kopfleiste trägt die Season, nicht die eigene Staffel.
      await expect(page.getByTestId("tv-header").locator("h1")).toHaveText("Saisonfinale");
      await expect(page.getByTestId("tv-header")).toContainText("Probe-Liga · Season 3");
      await expect(page.getByTestId("tv-header")).not.toContainText("Staffel A");
      await expect(page.getByTestId("bracket-tv")).toHaveAttribute("data-slide", "finale");
      // Gestaffelt: gut eine halbe Sekunde nach dem Schritt ist die erste Zeile unterwegs, die letzte noch nicht da.
      await page.waitForTimeout(550);
      const early = await page.evaluate(() => ["b1", "b4"].map((id) => Number(getComputedStyle(document.querySelector(`[data-testid='tv-finale-row-${id}']`)).opacity)));
      expect(early[0]).toBeGreaterThan(early[1]);
      await page.waitForTimeout(2600);
      for (const id of ["b1", "b2", "b3", "b4"]) await expect(page.getByTestId(`tv-finale-row-${id}`)).toHaveCSS("opacity", "1");
      await expect(page.getByTestId("tv-finale-target-b1")).toHaveText("Liga 1");
      await expect(page.getByTestId("tv-finale-target-b3")).toHaveText("Liga 3");
      await expect(page.getByTestId("tv-finale-target-b4")).toHaveText("scheidet aus");
      await expect(page.getByTestId("tv-finale-row-b2")).toContainText(LONG);
      const seen = await inspectFinale(page);
      expect(seen.rowsInside).toBe(true);
      expect(seen.footer).toBe(true);
      expect(seen.aboveFooter).toBe(true);
      expect(seen.cut).toEqual([]);
      expect(seen.targetsInside).toBe(true);
      expect(seen.minName).toBeGreaterThan(0);
      expect(seen.small).toEqual([]);
      expect(seen.overlap).toBe(false);
      expect(seen.cols.map((col) => col.key)).toEqual(["up", "down"]);
      expect(seen.cols[0].x).toBeLessThan(seen.cols[1].x);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/tv-saisonfinale-${size.width}.png` });

      // Weiter: Liga 3. Ende: das gewohnte Bild, die Wiedergabeliste läuft wieder.
      state.bracket = staffel(finale(3));
      state.push();
      await expect(page.getByTestId("tv-finale-title")).toHaveText("Liga 3 Auf- und Absteiger", { timeout: 8000 });
      await expect(page.getByTestId("tv-finale")).toHaveAttribute("data-columns", "1");
      state.bracket = staffel(null);
      state.push();
      await expect(page.getByTestId("tv-finale")).toHaveCount(0, { timeout: 8000 });
      await expect(page.getByTestId("tv-main")).toHaveAttribute("data-paused", "0");
    });

    test("12 Kandidaten (Nr. 235): je Spalte 8 Zeilen und „und 4 weitere“, alles über der Fußleiste, kein Name zu klein", async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize(size);
      await openFinale(page, "", 1, MANY);
      await page.waitForTimeout(3600);
      for (const key of ["up", "down"]) {
        await expect(page.getByTestId(`tv-finale-col-${key}`).locator(".tv-finale__row")).toHaveCount(8);
        await expect(page.getByTestId(`tv-finale-more-${key}`)).toHaveText("und 4 weitere");
        await expect(page.getByTestId(`tv-finale-more-${key}`)).toHaveCSS("opacity", "1");
      }
      const seen = await inspectFinale(page);
      expect(seen.footer).toBe(true);
      expect(seen.rowsInside).toBe(true);
      expect(seen.aboveFooter).toBe(true);
      expect(seen.mores.every((more) => more.inside && more.height > 0)).toBe(true);
      expect(seen.cut).toEqual([]);
      expect(seen.small).toEqual([]);
      expect(seen.overlap).toBe(false);
      // Die lange Ziel-Liga bricht um und verdrängt den Teamnamen nicht.
      expect(seen.targetsInside).toBe(true);
      expect(seen.targetsBesideName).toBe(true);
      expect(seen.nameWidth).toBeGreaterThan(size.width * 0.12);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/tv-saisonfinale-12-kandidaten-${size.width}.png` });
    });

    test("„Bewegung reduzieren“: der Schritt steht sofort, nichts bewegt sich", async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize(size);
      await openFinale(page, "&reduce_motion=1");
      await expect(page.getByTestId("tv-screen")).toHaveAttribute("data-tv-motion", "off");
      for (const id of ["b1", "b2", "b3", "b4"]) await expect(page.getByTestId(`tv-finale-row-${id}`)).toHaveCSS("opacity", "1");
      await expect(page.getByTestId("tv-finale-target-b4")).toHaveCSS("opacity", "1");
      const running = await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running"
        && animation.effect?.target?.closest?.("[data-testid='tv-finale']")).length);
      expect(running).toBe(0);
      const seen = await inspectFinale(page);
      expect(seen.rowsInside).toBe(true);
      expect(seen.cut).toEqual([]);
    });
  });
}
