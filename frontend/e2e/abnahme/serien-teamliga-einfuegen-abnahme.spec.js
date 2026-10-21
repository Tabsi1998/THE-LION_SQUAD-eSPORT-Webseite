const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Team-Liga einfacher eintragen (#1931). Eine
// Saison wie in einer CoD-Team-Liga - 7 Spieltage, 8 Teams, 10 Spieler im Kader - wird komplett über Einfügen im
// Browser erfasst: Terminliste mit Gegner und Zeitraum, Kader von der Match-Seite, je Spieltag die Begegnungsliste
// aus der Ansicht „Alle“ (alle Spieltage untereinander, Logo- und Link-Spalten), die Aufstellung von der Match-Seite
// (Häkchen) und die Maps im Veto, am letzten Spieltag die Tabelle laut Veranstalter mit leerer Logo-Spalte. Danach
// stimmen auf der Serienseite (ohne Anmeldung, 1440 und 360 px) Tabelle, Bilanz und Einsätze, und das Mitgliederprofil
// zeigt „Aufstellung · X von 7 Spielen“. Nur erfundene Namen. Läuft nur mit ABNAHME=1.

const SERIES = "/api/reference-series/admin";
const SHOTS = process.env.ABNAHME_SHOTS || "";
const DAY_MS = 24 * 60 * 60 * 1000;

async function shot(locator, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await locator.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function send(page, method, url, data) {
  const cookies = await page.context().cookies();
  const csrf = decodeURIComponent(cookies.find((cookie) => cookie.name === "csrf_token")?.value || "");
  return page.request.fetch(url, { method, data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
}

async function ok(response) {
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

function day(offset) {
  const date = new Date(Date.now() + offset * DAY_MS);
  return { iso: date.toISOString().slice(0, 10), dotted: `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${date.getUTCFullYear()}` };
}

/** Jeder gegen jeden (Kreisverfahren), jeder zweite Spieltag tauscht das Heimrecht des eigenen Teams. */
function schedule(teams) {
  let list = [...teams];
  const days = [];
  for (let number = 1; number < teams.length; number += 1) {
    const games = [];
    for (let index = 0; index < list.length / 2; index += 1) {
      let game = [list[index], list[list.length - 1 - index]];
      if (game.includes(teams[0]) && number % 2 === 0) game = [game[1], game[0]];
      games.push(game);
    }
    days.push(games);
    list = [list[0], list[list.length - 1], ...list.slice(1, -1)];
  }
  return days;
}

// Eigene Maps je Spieltag: drei gespielte (bis 6 Runden) aus eigener Sicht, dazu zwei Banns.
function ownMaps(number) {
  return number % 3 ? [[6, 3], [6, 4], [2, 6]] : [[4, 6], [6, 5], [3, 6]];
}

function otherScore(number, index) {
  return [[2, 1], [0, 2], [1, 1], [2, 0]][(number + index) % 4];
}

test.describe("Abnahme #1931: Team-Liga komplett über Einfügen", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.accounts?.admin, `Kein Seed-Stand: ${STATE_FILE} - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 600_000 });

  test("Saison mit 7 Spieltagen, 8 Teams und 10 Spielern nur über Einfügen", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "ein Durchgang genügt");
    const stamp = Date.now().toString(36).slice(-4);
    const own = `Probe Löwen ${stamp}`;
    const teams = [own, ...["Falken", "Wölfe", "Adler", "Eulen", "Bären", "Füchse", "Luchse"].map((name) => `Probe ${name} ${stamp}`)];
    const roster = "ABCDEFGHIJ".split("").map((letter) => `Spieler ${letter} ${stamp}`);
    const days = schedule(teams);
    const rules = { points_mode: "organizer", match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff", "score_for"] };
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    let admin = null;
    let profileId = null;
    try {
      admin = await adminContext.newPage();
      await signIn(admin, "admin");
      const problems = watch(admin);
      const lineage = await ok(await send(admin, "POST", `${SERIES}/lineages`, { title: `Probe Liga S&D ${stamp}`, kind: "team_league", label: "4vs4", organizer: "Probe Verband" }));
      const series = await ok(await send(admin, "POST", `${SERIES}/series`, { lineage_id: lineage.id, season: "Season 3", status: "active", rules, team_name: own, default_time: "20:30" }));

      await admin.goto(`/admin/reference-series/${series.id}`);
      await expect(admin.getByTestId("series-calendar")).toBeVisible();

      // 1) Terminliste: Gegner mit Seite und Spieltag-Zeitraum, alle Spieltage in der Vergangenheit.
      const windows = days.map((_, index) => ({ from: day(-7 * (8 - index) - 4), to: day(-7 * (8 - index)) }));
      const lines = days.map((games, index) => {
        const game = games.find((item) => item.includes(own));
        const opponent = game[0] === own ? `vs ${game[1]}` : `@ ${game[0]}`;
        return `ST${index + 1} · ${windows[index].from.dotted}–${windows[index].to.dotted} · ${opponent}`;
      });
      await admin.getByTestId("calendar-paste").click();
      await admin.getByTestId("paste-text").fill(lines.join("\n"));
      await admin.getByTestId("paste-submit").click();
      await expect(admin.getByTestId("paste-opponent")).toHaveCount(7);
      await expect(admin.getByTestId("paste-day-end")).toHaveCount(7);
      await shot(admin.getByTestId("paste-sheet"), "teamliga-terminliste");
      await admin.getByTestId("paste-submit").click();
      await expect(admin.getByTestId("calendar-round")).toHaveCount(7);

      // 2) Kader von der Match-Seite: „Seasonteam-Mitglieder | Warorga“, Häkchen als Bild verloren.
      await admin.getByTestId("roster-paste-open").click();
      await admin.getByTestId("roster-paste-names").fill(["Seasonteam-Mitglieder\tWarorga", ...roster.map((name) => `${name}\t`)].join("\n"));
      await admin.getByTestId("roster-paste-save").click();
      await expect(admin.getByTestId("roster-player")).toHaveCount(10);
      await shot(admin.getByTestId("series-roster"), "teamliga-kader");

      // Die Ansicht „Alle“ des Veranstalters: alle Spieltage untereinander, mit Überschrift, Zeitraum, Logo und Link.
      const allText = days.flatMap((games, index) => {
        const number = index + 1;
        return [
          `Begegnungen des ${number}. Spieltags`,
          `Zeitraum: ${windows[index].from.dotted} - ${windows[index].to.dotted}`,
          "Termin\tHeim\t\tAuswärts\t\tErgebnis\tLink",
          ...games.map((game, gameIndex) => {
            let score;
            if (game.includes(own)) {
              const won = ownMaps(number).filter(([mine, theirs]) => mine > theirs).length;
              score = game[0] === own ? `${won}:${3 - won}` : `${3 - won}:${won}`;
            } else {
              score = otherScore(number, gameIndex).join(":");
            }
            return `${windows[index].from.dotted} 20:30 Uhr\t${game[0]}\t\t${game[1]}\t\t${score}\tZum Matchup`;
          }),
        ];
      }).join("\n");

      // 3) Je Spieltag: Begegnungsliste einfügen, Aufstellung von der Match-Seite, Maps im Veto, veröffentlichen.
      const played = Object.fromEntries(roster.map((name) => [name, 0]));
      let expectedRows = null;
      for (let index = 0; index < days.length; index += 1) {
        const number = index + 1;
        const lineup = [0, 1, 2, 3].map((offset) => roster[(number * 2 + offset) % roster.length]);
        lineup.forEach((name) => { played[name] += 1; });
        await admin.getByTestId("results-open").nth(index).click();
        const sheet = admin.getByTestId("result-sheet");
        await expect(sheet).toBeVisible();
        await sheet.getByTestId("result-matchday-paste-text").fill(allText);
        await sheet.getByTestId("result-matchday-paste-apply").click();
        await expect(sheet.getByTestId("result-matchday-summary")).toContainText(`${number}. Spieltag`);
        await expect(sheet.getByTestId("result-matchday-summary")).toContainText("3 weitere Spiele übernommen");
        await sheet.getByTestId("result-lineup-paste-toggle").click();
        await sheet.getByTestId("result-lineup-paste-text").fill(["Seasonteam-Mitglieder\tWarorga", ...roster.map((name) => `${name}\t${lineup.includes(name) ? "✓" : ""}`)].join("\n"));
        await sheet.getByTestId("result-lineup-paste-apply").click();
        await expect(sheet.getByTestId("result-lineup-notice")).toContainText("Häkchen übernommen");
        const home = days[index].find((game) => game.includes(own))[0] === own;
        const maps = [["Karte 4", "banned:own"], ["Karte 5", "banned:opponent"],
          ...ownMaps(number).map(([mine, theirs], mapIndex) => [`Karte ${mapIndex + 1}`, ["picked:own", "picked:opponent", "decider"][mapIndex], home ? mine : theirs, home ? theirs : mine])];
        let scored = 0;
        for (const [mapIndex, [name, role, homeScore, awayScore]] of maps.entries()) {
          await sheet.getByTestId("result-map-add").click();
          await sheet.getByTestId("result-map-name").nth(mapIndex).fill(name);
          await sheet.getByTestId("result-map-role").nth(mapIndex).selectOption(role);
          if (homeScore !== undefined) {
            await sheet.getByTestId("result-map-home").nth(scored).fill(String(homeScore));
            await sheet.getByTestId("result-map-away").nth(scored).fill(String(awayScore));
            scored += 1;
          }
        }
        if (number === days.length) {
          // Tabelle laut Veranstalter, aus dem Browser mit leerer Logo-Spalte - aus allen Spielen gerechnet.
          const table = new Map(teams.map((team) => [team, { won: 0, drawn: 0, lost: 0, for: 0, against: 0 }]));
          days.forEach((games, dayIndex) => games.forEach((game, gameIndex) => {
            let score;
            if (game.includes(own)) {
              const won = ownMaps(dayIndex + 1).filter(([mine, theirs]) => mine > theirs).length;
              score = game[0] === own ? [won, 3 - won] : [3 - won, won];
            } else score = otherScore(dayIndex + 1, gameIndex);
            [[game[0], score[0], score[1]], [game[1], score[1], score[0]]].forEach(([team, mine, theirs]) => {
              const row = table.get(team);
              row[mine > theirs ? "won" : mine < theirs ? "lost" : "drawn"] += 1;
              row.for += mine;
              row.against += theirs;
            });
          }));
          const rows = [...table.entries()].map(([team, row]) => ({ team, ...row, points: row.won * 3 + row.drawn }))
            .sort((left, right) => right.points - left.points || (right.for - right.against) - (left.for - left.against) || right.for - left.for);
          const tableText = ["Platz\t\tTeam\tSpiele\tSiege\tUnentschieden\tNiederlagen\tErgebnis\tPunkte",
            ...rows.map((row, rank) => `${rank + 1}\t\t${row.team}\t7\t${row.won}\t${row.drawn}\t${row.lost}\t${row.for}:${row.against}\t${row.points}`)].join("\n");
          await sheet.getByTestId("result-table-paste-text").fill(tableText);
          await sheet.getByTestId("result-table-paste-apply").click();
          await expect(sheet.getByTestId("result-table-row")).toHaveCount(8);
          expectedRows = rows;
        }
        if (number === 1) await shot(sheet.getByTestId("result-team-league"), "teamliga-spieltag-eingefuegt");
        await sheet.getByTestId("result-submit").click(); // Vorschau
        await expect(sheet.getByTestId("result-preview")).toBeVisible();
        await sheet.getByTestId("result-submit").click(); // Veröffentlichen
        await expect(sheet).toBeHidden();
      }
      await expect(admin.getByTestId("results-round").filter({ hasText: "Gewertet" })).toHaveCount(7);
      expect(problems).toEqual([]);

      // Mitglied mit Profil und eine Referenz der Saison für das Mitgliederprofil.
      const member = roster[0];
      profileId = (await ok(await send(admin, "POST", "/api/membership/profiles/admin", { display_name: member }))).id;
      const listed = await ok(await admin.request.get(`${SERIES}/series/${series.id}/participants`));
      const participant = (listed.participants || []).find((item) => item.name === member);
      await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/participants/${participant.id}/assign`, { link: "member", profile_id: profileId }));
      const reference = await ok(await send(admin, "POST", "/api/references", {
        title: `Probe Liga S&D ${stamp} Season 3`, start_date: day(-60).iso, visibility: "public", series_id: series.id,
        entries: [{ kind: "team", team_name: own, placement: 2, team_count: 8, member_profile_ids: [profileId] }],
      }));

      // 4) Serienseite ohne Anmeldung: Tabelle, Bilanz, Karten und Kader mit Einsätzen - breit und am Handy (360 px).
      const expected = expectedRows;
      const ownRow = expected.find((row) => row.team === own);
      for (const [width, height, name] of [[1440, 900, "breit"], [360, 780, "handy"]]) {
        const context = await browser.newContext({ viewport: { width, height }, ...(width < 400 ? { isMobile: true, hasTouch: true } : {}) });
        const page = await context.newPage();
        await signIn(page, "anon");
        const pageProblems = watch(page);
        await page.goto(`/references/series/${lineage.slug}/${series.season_slug}`);
        await expect(page.getByTestId("team-league")).toBeVisible();
        await expect(page.getByTestId("team-league-progress")).toContainText("7 von 7 gespielt");
        for (const row of expected) {
          const standing = page.getByTestId(`standing-row-${row.team}`);
          await expect(standing).toContainText(String(row.points));
        }
        await expect(page.getByTestId(`standing-row-${own}`)).toHaveAttribute("data-mine", "true");
        await expect(page.getByTestId("team-league-record")).toContainText(`${ownRow.won}–${ownRow.drawn}–${ownRow.lost}`);
        await expect(page.getByTestId("team-league-record")).toContainText(`${ownRow.for}:${ownRow.against}`);
        const cards = page.getByTestId("team-league-matchday");
        await expect(cards).toHaveCount(7);
        await expect(cards.first().getByTestId("team-league-map-pick").first()).toHaveText("Unsere Wahl");
        await expect(cards.first().getByTestId("team-league-bans")).toContainText("Karte 4 (wir)");
        await expect(cards.first().getByTestId("team-league-others")).toContainText("Weitere Spiele (3)");
        const players = page.getByTestId("team-league-player");
        await expect(players).toHaveCount(10);
        for (const person of roster) {
          await expect(players.filter({ hasText: person }).getByTestId("team-league-appearances")).toContainText(`${played[person]} von 7`);
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await page.waitForTimeout(900);
        await shot(page.getByTestId("team-league"), `teamliga-serienseite-${name}`);
        expect(pageProblems).toEqual([]);
        await context.close();
      }

      // 5) Mitgliederprofil: „Aufstellung · X von 7 Spielen“ aus der verknüpften Saison.
      const profile = await ok(await admin.request.get(`/api/membership/profiles/admin/all`));
      const slug = (profile.items || profile).find((item) => item.id === profileId)?.slug;
      const publicProfile = await ok(await admin.request.get(`/api/membership/profiles/${slug}`));
      const item = publicProfile.references.find((entry) => entry.id === reference.id);
      expect(item.appearances).toEqual({ played: played[member], of: 7, unit: "matches", team: own });
    } finally {
      if (admin && profileId) await send(admin, "PATCH", `/api/membership/profiles/admin/${profileId}`, { is_active: false }).catch(() => {});
      await adminContext.close();
    }
  });
});
