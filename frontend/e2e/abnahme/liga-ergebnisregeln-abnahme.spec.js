const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Ergebnisregeln gegen den echten Server (docs/LIGA.md, C.3, #1617) - ohne nachgestellte API. Stand aus scripts/seed_abnahme_liga.py,
// Staffel „Liga-Probelauf“ gestartet von liga-ablauf-abnahme.spec.js (vorher laufen lassen). Die Leitung stellt in der Season die
// Regeln ein und überträgt sie; ein Captain meldet bei 390 und 1440 px: falscher Endstand abgelehnt (Server und Formular),
// richtiger angenommen, die Gegenseite bestätigt ohne Punkte. Übergehen darf die Leitung nicht. Erfundene Werte.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const ablauf = state?.ablauf;
const tid = ablauf?.tournament_id;
const RULES = {
  stellung: { kind: "score", target: 250, time_limit_minutes: 10, draw_allowed: false, overtime: false },
  suchen: { kind: "rounds", target: 6, round_limit: 11, draw_allowed: false, overtime: false },
};

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function as(browser, testInfo, role, viewport) {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport, locale: "de-AT", timezoneId: "Europe/Vienna" });
  const page = await context.newPage();
  await signIn(page, role);
  return { page, problems: watch(page), close: () => context.close() };
}

/** Ein offenes Spiel ohne Meldung in dieser Runde, mit den Rollen der beiden Captains. */
async function openMatch(page, round) {
  const body = await (await page.request.get(`/api/tournaments/${tid}/matches-v2`)).json();
  const rows = (Array.isArray(body) ? body : body.matches || []).filter((row) => !row.is_preview);
  const match = rows.find((row) => Number(row.round) === round && row.status !== "completed" && !(row.reports || []).length);
  expect(match, `offenes Spiel in Runde ${round}`).toBeTruthy();
  const [home, away] = match.slots.map((slot) => slot.registration_id);
  const registrations = await (await page.request.get(`/api/tournaments/${tid}/registrations`)).json();
  const captainOf = (id) => `captain-${state.teams.findIndex((row) => row.squad_id === registrations.find((reg) => reg.id === id).squad_id)}`;
  return { id: match.id, home, away, homeRole: captainOf(home), awayRole: captainOf(away) };
}

/** Direkt an den Server schreiben - mit dem CSRF-Kopf, den sonst lib/api.js setzt. */
async function post(page, url, data) {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "csrf_token")?.value;
  return page.request.post(url, { data, headers: csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {} });
}

function reportBody(match, map2) {
  const [stellung, suchen] = [ablauf.pool.stellung[0], ablauf.pool.suchen[1]];
  return {
    results: [{ registration_id: match.home, rank: 1, score: 2 }, { registration_id: match.away, rank: 2, score: 0 }],
    lineup: [],
    games: [
      { position: 1, mode: "stellung", map_id: stellung, winner_registration_id: match.home, scores: { [match.home]: 250, [match.away]: 180 } },
      { position: 2, mode: "suchen", map_id: suchen, winner_registration_id: match.home, scores: { [match.home]: map2[0], [match.away]: map2[1] } },
    ],
  };
}

test.describe("Abnahme: Ergebnisregeln gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !ablauf, `Kein Ablauf-Stand in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  test("Leitung: Regeln der Season einstellen und auf die laufende Staffel übertragen", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", { width: 1440, height: 900 });
    await lead.page.goto(`/admin/leagues/seasons/${ablauf.season.id}`);
    const panel = lead.page.getByTestId("season-result-rules");
    await expect(panel).toBeVisible();
    await expect(lead.page.getByTestId("result-rules-required")).toBeChecked();
    for (const [mode, rule] of Object.entries(RULES)) {
      await lead.page.getByTestId(`result-rules-${mode}-kind`).selectOption(rule.kind);
      await lead.page.getByTestId(`result-rules-${mode}-target`).fill(String(rule.target));
      if (rule.round_limit) await lead.page.getByTestId(`result-rules-${mode}-limit`).fill(String(rule.round_limit));
      if (rule.time_limit_minutes) await lead.page.getByTestId(`result-rules-${mode}-time`).fill(String(rule.time_limit_minutes));
    }
    await lead.page.getByTestId("result-rules-save").click();
    await expect(lead.page.getByTestId("season-sync-hint")).toBeVisible();
    await lead.page.getByTestId("season-sync-now").click();
    await expect(lead.page.getByTestId("season-sync-hint")).toBeHidden();
    await noSideScroll(lead.page);
    await panel.scrollIntoViewIfNeeded();
    await shot(lead.page, "ergebnisregeln-season-1440.png");

    const saved = await (await lead.page.request.get(`/api/admin/leagues/seasons/${ablauf.season.id}/result-rules`)).json();
    expect(saved.scores_required).toBe(true);
    expect(Object.fromEntries(saved.rules.filter((row) => row.season_rule).map((row) => [row.mode, row.season_rule]))).toMatchObject(RULES);
    expect(lead.problems).toEqual([]);
    await lead.close();
  });

  for (const [width, height, round] of [[390, 844, 3], [1440, 900, 4]]) {
    test(`Captain (${width} px): falscher Endstand abgelehnt, richtiger angenommen`, async ({ browser }, testInfo) => {
      const viewport = { width, height };
      const lead = await as(browser, testInfo, "lead", viewport);
      const match = await openMatch(lead.page, round);
      const home = await as(browser, testInfo, match.homeRole, viewport);
      const away = await as(browser, testInfo, match.awayRole, viewport);

      // Der Server ist maßgeblich: 7:5 bei höchstens 11 Runden lehnt er mit deutschem Satz ab, auch ohne Formular.
      await home.page.goto(`/matches/${match.id}`);
      const refused = await post(home.page, `/api/matches/${match.id}/report`, reportBody(match, [7, 5]));
      expect(refused.status()).toBe(422);
      expect((await refused.json()).detail).toBe("Map 2: höchstens 11 Runden – 7:5 sind 12.");

      // Im Formular: die Regel je Map, der falsche Endstand vorab im Klartext, dann der richtige.
      await home.page.goto(`/matches/${match.id}`);
      await expect(home.page.getByTestId("match-report-form")).toBeVisible();
      await expect(home.page.getByTestId("league-game-1-rule")).toHaveText("Gewertet: bis 250 Punkte · 10 Min.");
      const maps = [ablauf.pool.stellung[0], ablauf.pool.suchen[1]];
      const scores = [["250", "180"], ["7", "5"]];
      for (const [index, mapId] of maps.entries()) {
        const position = index + 1;
        await home.page.getByTestId(`league-game-${position}-map-${mapId}`).click();
        await home.page.getByTestId(`league-game-${position}-winner-${match.home}`).click();
        await home.page.getByTestId(`league-game-${position}-score-${match.home}`).fill(scores[index][0]);
        await home.page.getByTestId(`league-game-${position}-score-${match.away}`).fill(scores[index][1]);
      }
      await expect(home.page.getByTestId("league-game-2-rule")).toHaveText("Gewertet: 6 Runden, höchstens 11");
      const chips = home.page.getByTestId("league-participants").getByRole("button");
      for (let chip = 0; chip < 3; chip += 1) await chips.nth(chip).click();
      await home.page.getByTestId("match-report-submit").click();
      await expect(home.page.getByTestId("match-report-error")).toHaveText("Map 2: höchstens 11 Runden – 7:5 sind 12.");
      await noSideScroll(home.page);
      await shot(home.page, `ergebnisregeln-abgelehnt-${width}.png`);

      await home.page.getByTestId(`league-game-2-score-${match.home}`).fill("6");
      await home.page.getByTestId("match-report-submit").click();
      await expect(home.page.getByTestId("match-report-state")).toHaveAttribute("data-status", "waiting");

      // Die Gegenseite bestätigt ohne Punkte - es gelten die der ersten Meldung.
      await away.page.goto(`/matches/${match.id}`);
      await expect(away.page.getByTestId("match-report-state")).toHaveAttribute("data-status", "confirm");
      const list = away.page.getByTestId("league-confirm-participants").getByRole("button");
      for (let chip = 0; chip < 3; chip += 1) await list.nth(chip).click();
      await away.page.getByTestId("match-report-confirm").click();
      await expect(away.page.getByTestId("league-games-2")).toBeVisible();
      await expect(away.page.getByTestId("league-games-2")).toContainText("6");
      await noSideScroll(away.page);
      await shot(away.page, `ergebnisregeln-bestaetigt-${width}.png`);

      // Übergehen darf nur der Superadmin - die Liga-Leitung bekommt 403, auch mit Grund.
      await lead.page.goto(`/matches/${match.id}`);
      const override = await post(lead.page, `/api/matches/${match.id}/result?force=true`,
        { ...reportBody(match, [7, 5]), reason: "Stand korrigiert", rule_override_reason: "Server stürzte ab" });
      expect(override.status()).toBe(403);
      expect((await override.json()).detail).toBe("Eine Ergebnisregel übergehen darf nur der Superadmin.");

      for (const person of [lead, home, away]) {
        expect(person.problems).toEqual([]);
        await person.close();
      }
    });
  }
});
