const { test, expect } = require("@playwright/test");
const { HOME, mockLongApi } = require("./fixtures/longTextMocks");
const { activePayload, mockSeason } = require("./seasonQa");

// Schrift-Treppe (#1302, #1303, #1304) mit schlimmen, aber echten Daten (break-ui): ein News-Titel mit 60 Zeichen und
// Umlauten, eine Rangliste mit langen Namen und Punkten in verschiedener Breite, ein Countdown in den letzten Minuten.
// Geprüft bei 390, 768, 1440 und 2560 px:
// - Der Titel steht auf Startseite, News-Liste und Artikel gleich geschrieben (wie eingetippt, nie GROSS) und läuft
//   nirgends aus seiner Fläche oder aus dem Bild.
// - Die Punkte der Rangliste stehen in der Zahlen-Schrift mit gleich breiten Ziffern: gleich viele Ziffern sind gleich
//   breit, die Spalte ist bündig.
// - Der Countdown wackelt nicht: „in 50 Minuten“ und „in 11 Minuten“ sind gleich breit.

const WIDTHS = [[390, 844], [768, 1024], [1440, 900], [2560, 1440]];
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const TITLE = "Finale in Wörgl: Überraschungssieg für Jörg im Kart-Cup 2026";
const NEWS = {
  id: "n60", slug: "grosses-finale-woergl", title: TITLE, category: "turnier", visibility: "public", pinned: true,
  published_at: "2026-11-19T10:00:00+00:00", created_at: "2026-11-19T10:00:00+00:00", author_name: "Orga-Team",
  excerpt: "Zwölf Stationen, 48 Fahrerinnen und Fahrer und ein Finale, das erst in der letzten Runde entschieden wurde.",
  content: "Was für ein Abend in Wörgl!\n\nDanke an alle, die mitgeholfen haben.", banner_url: "",
};

async function withNews(page) {
  await mockLongApi(page);
  await page.route(/\/api\/news(\?.*)?$/, (route) => route.fulfill(json([NEWS])));
  await page.route(`**/api/news/${NEWS.slug}`, (route) => route.fulfill(json(NEWS)));
  await page.route(/\/api\/home\/state(\?.*)?$/, (route) => route.fulfill(json({ ...HOME, news: [NEWS], featured_news: [NEWS] })));
}

/** Schreibweise, Großschreibung und Überlauf eines Titels - und ob die Seite seitlich scrollt. */
async function titleFacts(locator) {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node);
    const doc = document.documentElement;
    return {
      shown: node.innerText.replace(/\s+/g, " ").replace(/­/g, "").trim(),
      transform: style.textTransform,
      overflow: node.scrollWidth - node.clientWidth,
      pageOverflow: doc.scrollWidth - doc.clientWidth,
      right: node.getBoundingClientRect().right - doc.clientWidth,
    };
  });
}

test.describe("Schrift-Treppe", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of WIDTHS) {
    test(`News-Titel mit 60 Zeichen bei ${width} px: überall gleich geschrieben, nichts läuft über`, async ({ page }) => {
      expect(TITLE).toHaveLength(60);
      await page.setViewportSize({ width, height });
      await withNews(page);
      const seen = [];
      for (const [path, locate] of [
        ["/", (p) => p.getByRole("heading", { name: TITLE }).first()],
        ["/news", (p) => p.getByRole("heading", { name: TITLE }).first()],
        [`/news/${NEWS.slug}`, (p) => p.getByRole("heading", { level: 1, name: TITLE })],
      ]) {
        await page.goto(path);
        const title = locate(page);
        await expect(title).toBeVisible();
        const facts = await titleFacts(title);
        expect(facts.transform, `${path}: Titel nie GROSS`).toBe("none");
        expect(facts.shown, `${path}: Titel wie eingetippt`).toBe(TITLE);
        expect(facts.overflow, `${path}: Titel läuft aus seiner Fläche`).toBeLessThanOrEqual(1);
        expect(facts.right, `${path}: Titel läuft aus dem Bild`).toBeLessThanOrEqual(1);
        expect(facts.pageOverflow, `${path}: Seite scrollt seitlich`).toBeLessThanOrEqual(1);
        seen.push(facts.shown);
      }
      expect(new Set(seen).size).toBe(1);
    });
  }

  const SEASON = { id: "s-26", slug: "jahreswertung-2026", name: "Jahreswertung 2026", status: "active", start_date: "2026-01-01", end_date: "2026-12-31", drop_worst: 1 };
  const NAMES = ["Aleksandra Wiśniewska-Kowalczyk", "Jo", "Ömer Yılmaz", "xX_Nebelwolf_Xx.Rudel", "Lena", "Bartholomäus Fitzgerald-Hinterberger"];
  // Ziffern mit verschiedener Breite in proportionalen Schriften: 1 ist schmal, 0 und 8 sind breit.
  const POINTS = [1888, 1111, 1080, 808, 111, 101];
  const STANDINGS = NAMES.map((name, index) => ({
    user_id: `u-${index}`, username: `spieler${index}`, display_name: name, rank: index + 1, points: POINTS[index],
    events_count: 12 - index, wins: Math.max(0, 4 - index), achievement_count: 3, profile_points: 10,
  }));

  for (const [width, height] of WIDTHS) {
    test(`Rangliste bei ${width} px: Punkte in Rajdhani, gleich viele Ziffern gleich breit, Spalte bündig`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockLongApi(page);
      await page.route(`**/api/seasons/${SEASON.slug}/standings**`, (route) => route.fulfill(json({ season: SEASON, standings: STANDINGS })));
      await page.goto(`/seasons/${SEASON.slug}`);
      const row = (id) => page.locator(`[data-testid="season-row-${id}"]:visible, [data-testid="season-item-${id}"]:visible`).first();
      await expect(row("u-5")).toBeVisible();
      const cells = await page.evaluate((ids) => ids.map((id) => {
        const root = document.querySelector(`[data-testid="season-row-${id}"]`)?.offsetParent
          ? document.querySelector(`[data-testid="season-row-${id}"]`)
          : document.querySelector(`[data-testid="season-item-${id}"]`);
        const cell = [...root.querySelectorAll(".tls-type-num")].find((node) => /^\d[\d.]*$/.test(node.textContent.trim()) && node.textContent.trim().replace(/\D/g, "").length >= 3);
        const range = document.createRange();
        range.selectNodeContents(cell);
        const box = range.getBoundingClientRect();
        const style = getComputedStyle(cell);
        return { text: cell.textContent.trim(), width: box.width, right: box.right, family: style.fontFamily, numeric: style.fontVariantNumeric };
      }), STANDINGS.map((row_) => row_.user_id));
      for (const cell of cells) {
        expect(cell.family).toMatch(/Rajdhani/);
        expect(cell.numeric).toContain("tabular-nums");
      }
      // Gleich viele Ziffern, gleich breit: 1.888 / 1.111 / 1.080 und 808 / 111 / 101.
      const byDigits = new Map();
      for (const cell of cells) {
        const key = cell.text.length;
        byDigits.set(key, [...(byDigits.get(key) || []), cell.width]);
      }
      for (const widths of byDigits.values()) expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(0.5);
      // Bündig: rechte Kanten gleich (die Spalte steht rechts).
      const rights = cells.map((cell) => cell.right);
      expect(Math.max(...rights) - Math.min(...rights)).toBeLessThanOrEqual(1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  for (const [width, height] of WIDTHS) {
    test(`Countdown bei ${width} px: „in 50 Minuten“ und „in 11 Minuten“ sind gleich breit`, async ({ page, context }) => {
      await page.setViewportSize({ width, height });
      const measure = async (now) => {
        const tab = await context.newPage();
        await tab.setViewportSize({ width, height });
        await mockLongApi(tab, { now });
        await tab.goto("/");
        const value = tab.getByTestId("home-countdown-value");
        await expect(value).toHaveText(/^in \d\d Minuten$/);
        const facts = await value.evaluate((node) => {
          const style = getComputedStyle(node);
          return { text: node.textContent, width: node.getBoundingClientRect().width, family: style.fontFamily, numeric: style.fontVariantNumeric };
        });
        await tab.close();
        return facts;
      };
      // Die Herbst-LAN beginnt um 17:00 Uhr UTC (fixtures/longTextMocks).
      const early = await measure("2026-11-27T16:10:00+00:00");
      const late = await measure("2026-11-27T16:49:00+00:00");
      expect(early.text).toBe("in 50 Minuten");
      expect(late.text).toBe("in 11 Minuten");
      expect(early.family).toMatch(/Rajdhani/);
      expect(early.numeric).toContain("tabular-nums");
      expect(Math.abs(early.width - late.width)).toBeLessThanOrEqual(0.5);
    });
  }

  // Jahreswertung am Handy (Liste unter 768 px): „Wertungen · Siege“ und „Achievements“ stehen unter dem Namen statt
  // rechts daneben - der Name hat so Platz und bricht nur zwischen Wörtern, nie Buchstabe für Buchstabe. Nur ein Wort,
  // das allein breiter ist als die Spalte („xX_Nebelwolf_Xx.Rudel“), darf brechen.
  const UNBREAKABLE = ["xX_Nebelwolf_Xx.Rudel"];
  for (const width of [320, 390, 767]) {
    test(`Jahreswertung bei ${width} px: Namen in ganzen Wörtern, Etiketten unter dem Namen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await mockLongApi(page);
      await page.route(`**/api/seasons/${SEASON.slug}/standings**`, (route) => route.fulfill(json({ season: SEASON, standings: STANDINGS })));
      await page.goto(`/seasons/${SEASON.slug}`);
      await expect(page.getByTestId("season-item-u-5")).toBeVisible();
      const rows = await page.evaluate((ids) => ids.map((id) => {
        const row = document.querySelector(`[data-testid="season-item-${id}"]`);
        const name = row.querySelector(".tls-wrap--name");
        const facts = row.querySelector(`[data-testid="season-item-facts-${id}"]`);
        const nameBox = name.getBoundingClientRect();
        const factsBox = facts?.getBoundingClientRect();
        // Jedes Wort, das allein in die Spalte passt, steht auf einer Zeile.
        const broken = [];
        const tooWide = [];
        const text = name.firstChild;
        let offset = 0;
        for (const word of name.textContent.split(/(?<=[\s-])/)) {
          const range = document.createRange();
          range.setStart(text, offset);
          range.setEnd(text, offset + word.trimEnd().length);
          offset += word.length;
          const probe = document.createElement("span");
          probe.style.whiteSpace = "nowrap";
          probe.textContent = word.trimEnd();
          name.after(probe);
          const alone = probe.getBoundingClientRect().width;
          probe.remove();
          const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
          if (alone <= nameBox.width && lines > 1) broken.push(word.trim());
          if (alone > nameBox.width + 1) tooWide.push(word.trim());
        }
        return {
          id,
          nameWidth: Math.round(nameBox.width),
          broken,
          tooWide,
          below: factsBox ? factsBox.top >= nameBox.bottom - 1 : null,
          right: factsBox ? factsBox.left >= nameBox.right - 1 : null,
        };
      }), STANDINGS.map((row) => row.user_id));
      for (const row of rows) {
        expect(row.broken, `${row.id}: Wörter mitten im Wort gebrochen`).toEqual([]);
        expect(row.tooWide.filter((word) => !UNBREAKABLE.includes(word)), `${row.id}: Wörter breiter als die Namensspalte (${row.nameWidth} px)`).toEqual([]);
        expect(row.right, `${row.id}: Etiketten rechts neben dem Namen`).toBe(false);
        expect(row.below, `${row.id}: Etiketten unter dem Namen`).toBe(true);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      if (process.env.SHOT_DIR) await page.locator('[data-testid="season-item-u-0"]').locator("xpath=..").screenshot({ path: `${process.env.SHOT_DIR}/jahreswertung-${width}.png` });
    });
  }

  // Teilnehmerliste eines Turniers bei 320 px: Das Schild „ANGENOMMEN“ ist ein Etikett (12 px). Kein Name wird
  // abgeschnitten und keiner endet mit „…“ (#1314): Namen wie „NeonFalke“ stehen in einer Zeile, längere brechen
  // zwischen Wörtern um („🦁“ / „Löwenherz“) - nie mitten in einem Wort, das allein in die Spalte passt.
  const TOURNAMENT = { id: "t-cup", slug: "herbst-cup", title: "Herbst-Cup 2026", status: "registration_open", start_date: "2026-12-05T13:00:00+00:00", max_participants: 16, participant_count: 8, public_phase: { state: "registration_open", label: "Anmeldung offen" } };
  const PLAYERS = ["NeonFalke", "Der unglaublich schnelle Kartfahrer", "LuckyLion", "🦁 Löwenherz", "DriftDaniel", "BoostBernd", "TurboTom", "SchnellSchnecke"];
  const REGISTRATIONS = PLAYERS.map((name, index) => ({ id: `r${index + 1}`, display_name: name, status: "approved", seed: index + 1 }));

  test("Teilnehmerliste bei 320 px: Schilder als Etikett, kein Name abgeschnitten", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await mockLongApi(page);
    await page.route(`**/api/tournaments/${TOURNAMENT.slug}`, (route) => route.fulfill(json(TOURNAMENT)));
    await page.route(`**/api/tournaments/${TOURNAMENT.id}/registrations**`, (route) => route.fulfill(json(REGISTRATIONS)));
    await page.route(`**/api/tournaments/${TOURNAMENT.id}/standings**`, (route) => route.fulfill(json([])));
    await page.goto(`/tournaments/${TOURNAMENT.slug}`);
    const first = page.getByTestId("tournament-participant-r1");
    await expect(first).toBeVisible();
    const badge = first.getByTestId("status-approved");
    expect(await badge.evaluate((node) => getComputedStyle(node).fontSize)).toBe("12px");
    for (const [index, player] of PLAYERS.entries()) {
      const facts = await page.getByTestId(`tournament-participant-r${index + 1}`).evaluate((row, name) => {
        const node = [...row.querySelectorAll("span")].find((span) => span.textContent === name);
        const linesOf = (range) => new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
        const all = document.createRange();
        all.selectNodeContents(node);
        const width = node.getBoundingClientRect().width;
        const broken = [];
        let offset = 0;
        for (const word of name.split(/(?<=\s)/)) {
          const range = document.createRange();
          range.setStart(node.firstChild, offset);
          range.setEnd(node.firstChild, offset + word.trimEnd().length);
          offset += word.length;
          const probe = document.createElement("span");
          probe.style.whiteSpace = "nowrap";
          probe.textContent = word.trimEnd();
          node.after(probe);
          const alone = probe.getBoundingClientRect().width;
          probe.remove();
          if (alone <= width && linesOf(range) > 1) broken.push(word.trim());
        }
        return { cut: node.scrollWidth > node.clientWidth + 1 || getComputedStyle(node).textOverflow === "ellipsis", lines: linesOf(all), broken };
      }, player);
      expect(facts.cut, `Name „${player}“ abgeschnitten`).toBe(false);
      expect(facts.broken, `„${player}“ mitten im Wort gebrochen`).toEqual([]);
      if (["NeonFalke", "LuckyLion", "TurboTom"].includes(player)) expect(facts.lines, `„${player}“ in einer Zeile`).toBe(1);
    }
    // Die Namen stehen bündig hinter dem Setzplatz - auch wenn ein langer Name umbricht.
    const lefts = await page.evaluate((names) => names.map((name) => {
      const node = [...document.querySelectorAll("[data-testid^='tournament-participant-r'] span")].find((span) => span.textContent === name);
      return Math.round(node.getBoundingClientRect().left);
    }), PLAYERS);
    expect(Math.max(...lefts) - Math.min(...lefts), `linke Kanten der Namen: ${lefts.join(", ")}`).toBeLessThanOrEqual(1);
    if (process.env.SHOT_DIR) await page.getByTestId("tournament-participants").screenshot({ path: `${process.env.SHOT_DIR}/teilnehmer-320.png` });
  });

  // Kopf der Matchseite: Die Überschrift besteht aus Namen - nie GROSS (#1303), auch kurz („Jo gegen Max“).
  for (const [label, participants] of [["kurz", ["Jo", "Max"]], ["ein Name", ["NeonFalke", null]]]) {
    test(`Match-Kopf (${label}): Namen stehen, wie sie eingetippt wurden`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await mockLongApi(page);
      const MATCH = {
        match: { id: "m1", match_key: "A", status: "scheduled", round: 1, round_name: "Halbfinale", scheduled_at: "2026-11-28T16:00:00+00:00", slots: [{ slot: 1, status: "filled", registration_id: "r1" }, { slot: 2, status: participants[1] ? "filled" : "bye", registration_id: participants[1] ? "r2" : null }], results: [] },
        tournament: { id: "t1", slug: "kart-cup", title: "Kart-Cup" },
        participants: participants.map((name, index) => ({ slot: index + 1, status: name ? "filled" : "bye", registration_id: name ? `r${index + 1}` : null, display_name: name })),
        schedule_proposals: [], can_act: false, can_report_score: false, can_player_report_result: false, can_submit_result: false, can_staff_submit_result: false,
        can_propose_schedule: false, can_manage_schedule: false, can_dispute: false, can_forfeit: false, event_mode: "local", result_entry_mode: "staff_only",
        schedule_mode: "fixed_by_staff", collection: "matches_v2", matchday: 1, matchday_label: "Halbfinale",
      };
      await page.route("**/api/matches/m1/page", (route) => route.fulfill(json(MATCH)));
      await page.route("**/api/matches/m1/chat", (route) => route.fulfill(json([])));
      await page.goto("/matches/m1");
      const headline = page.getByTestId("match-headline");
      await expect(headline).toBeVisible();
      const facts = await headline.evaluate((node) => ({ shown: node.innerText.trim(), text: node.textContent.trim(), upper: [...node.querySelectorAll("*")].concat(node).some((el) => getComputedStyle(el).textTransform === "uppercase") }));
      expect(facts.upper).toBe(false);
      expect(facts.shown).toBe(facts.text);
      expect(facts.shown).toContain(participants[0]);
    });
  }

  // Adventkalender (Fabians Entscheidung vom 26.11.: auch Deko-Text ab 12 px): das Schild „Heute“ und die Titel in den
  // geöffneten Türchen haben bei 360, 390 und 1440 px mindestens 12 px. Kein Titel wird abgeschnitten und keiner endet
  // mit „…“: Was nicht in die Nische passt, zeigt dort die kurze Art des Türchens („Gruß“, „Bild“) - der ganze Titel
  // steht im Fenster.
  const ADVENT_ORDER = [8, 22, 9, 14, 5, 13, 17, 12, 2, 18, 6, 16, 19, 7, 10, 3, 24, 23, 11, 15, 21, 4, 1, 20];
  const ADVENT_SEASON = { key: "advent_calendar", label: "Adventkalender", phase: "tuerchen", intensity: "normal", channels: ["web", "app"], texts: {}, data: { today_door: 12, catch_up: false, door_hour: 6, ready: true }, starts_at: "2026-12-01T00:00:00+01:00", ends_at: "2027-01-06T23:59:59+01:00", forced: false };
  const LONG_DOOR = "Ein ziemlich langer Titel für das heutige Türchen im Advent";
  const LONGEST_DOOR = "Weihnachtsgrüße vom ganzen Vorstand der Lion Squad an alle Mitglieder, Fahrerinnen und Fahrer, Fans und Freunde - danke für dieses Jahr voller Rennen, Turniere und Abende im Vereinsheim in Wörgl!";
  const PIXEL = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'><rect width='4' height='4' fill='%23305'/></svg>";
  const ADVENT_CONTENT = {
    1: { kind: "text", title: LONGEST_DOOR },
    2: { kind: "quiz", title: "Kranz-Quiz" },
    5: { kind: "text", title: LONG_DOOR },
    8: { kind: "prize", title: "Heute gibt es etwas zu gewinnen" },
    9: { kind: "image", title: "Das Team beim Saisonfinale in Wörgl", media_url: PIXEL },
  };
  const KINDS = { text: "Gruß", quiz: "Quiz", prize: "Gewinn", image: "Bild" };

  function adventCalendar(opened) {
    const doors = [];
    for (let day = 1; day <= 24; day += 1) {
      const state = day > 12 ? "locked" : opened.includes(day) ? "opened" : "available";
      const content = { kind: "text", title: `Türchen ${day}`, body: "Der Löwe wünscht dir einen schönen Adventtag.", media_url: null, link: null, ...ADVENT_CONTENT[day] };
      doors.push({ day, opens_at: `2026-12-${String(day).padStart(2, "0")}T06:00:00+01:00`, seed: day * 7919, state, ...(state === "opened" ? { content } : {}) });
    }
    return { active: true, year: 2026, now: "2026-12-12T10:00:00+01:00", ends_at: "2027-01-06T23:59:59+01:00", catch_up: false, newest_door: 12, door_hour: 6, order: ADVENT_ORDER, doors, total: 24, signed_in: false, opened: opened.length };
  }

  for (const [width, height] of [[360, 780], [390, 844], [1440, 900]]) {
    test(`Adventkalender bei ${width} px: „Heute“ und Türchen-Titel ab 12 px, nichts abgeschnitten`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const opened = [1, 2, 5, 8, 9];
      await mockSeason(page, activePayload({ season: ADVENT_SEASON, now: "2026-12-12T10:00:00+01:00" }));
      await page.route(/\/api\/seasonal\/advent(\?.*)?$/, (route) => route.fulfill(json(adventCalendar(opened))));
      await page.addInitScript((days) => window.localStorage.setItem("tls-advent-opened", JSON.stringify({ year: 2026, days })), opened);
      await page.goto("/advent");
      await expect(page.getByTestId("advent-board")).toBeVisible({ timeout: 20000 });
      await expect(page.locator(".tls-adv__preview-title")).toHaveCount(opened.length);
      await page.evaluate(() => document.fonts.ready);

      const today = await page.locator(".tls-adv__today").evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
      expect(today, "Schild „Heute“").toBeGreaterThanOrEqual(12);

      await expect.poll(() => page.locator(".tls-adv__preview-title").evaluateAll((nodes) => nodes.map((node) => {
        const preview = node.closest(".tls-adv__preview").getBoundingClientRect();
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          day: Number(node.closest("[data-day]").dataset.day),
          size: Number.parseFloat(style.fontSize),
          text: node.textContent,
          clamp: style.webkitLineClamp,
          cut: node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1,
          outside: box.top < preview.top - 1 || box.bottom > preview.bottom + 1 || box.left < preview.left - 1 || box.right > preview.right + 1,
        };
      })).then((titles) => titles.filter((title) => title.size < 12 || title.cut || title.outside || title.clamp !== "none" || title.text.includes("…")
        || ![ADVENT_CONTENT[title.day]?.title || `Türchen ${title.day}`, KINDS[ADVENT_CONTENT[title.day]?.kind || "text"]].includes(title.text))), { timeout: 5000 }).toEqual([]);

      // Kurze Titel stehen ganz in der Nische, der längste weicht auf die Art aus.
      await expect(page.getByTestId("advent-door-2").locator(".tls-adv__preview-title")).toHaveText("Kranz-Quiz");
      await expect(page.getByTestId("advent-door-1").locator(".tls-adv__preview-title")).toHaveText("Gruß");

      // Das Fenster zeigt den langen Titel ganz.
      await page.getByTestId("advent-door-button-5").click();
      await expect(page.getByTestId("advent-dialog-title")).toHaveText(LONG_DOOR);
    });
  }
});
