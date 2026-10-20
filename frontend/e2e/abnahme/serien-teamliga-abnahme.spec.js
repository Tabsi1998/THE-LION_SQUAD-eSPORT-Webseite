const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Seite Team-Liga (#1747). Der Vorstand legt über
// die echten Routen eine Spur vom Typ Team-Liga mit zwei Saisons an (Punkte 2/1/0 aus den Regeln), ordnet ein
// Vereinsmitglied und einen Gast zu und trägt die eigenen Spiele mit Maps und Aufstellung ein - einmal mit der Tabelle
// laut Veranstalter. Ohne Anmeldung zeigt die Serienseite dann Spieltage mit nächstem Gegner, die Tabelle mit dem
// eigenen Team, Platzierungsverlauf, Spielplan, Aufstellung (nur das Mitglied verlinkt, der Gast getrennt) und den
// Liga-Weg - bei 1440 und 360 px, ohne Konsolenfehler, nicht indexiert. `ABNAHME_SHOTS` legt Bilder ab (optional).
// Nur erfundene Namen. Läuft nur mit ABNAHME=1.

const SERIES = "/api/reference-series/admin";
const SHOTS = process.env.ABNAHME_SHOTS || "";
const DAY_MS = 24 * 60 * 60 * 1000;

async function shot(locator, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await locator.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** Anfrage wie die Website: mit dem CSRF-Kopf aus dem Cookie der Sitzung. */
async function send(page, method, url, data) {
  const cookies = await page.context().cookies();
  const csrf = decodeURIComponent(cookies.find((cookie) => cookie.name === "csrf_token")?.value || "");
  return page.request.fetch(url, { method, data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
}

async function ok(response) {
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

/** Ein Kalendertag `days` Tage vor heute (JJJJ-MM-TT) - Ergebnisse gibt es nur für vergangene Termine. */
function daysAgo(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
}

test.describe("Abnahme #1747: Seite Team-Liga - Tabelle, Spielplan, Aufstellung, Liga-Weg", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.accounts?.admin, `Kein Seed-Stand: ${STATE_FILE} - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test("Vorstand trägt ein, die Seite zeigt die Team-Liga", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "ein Durchgang genügt");
    const stamp = Date.now().toString(36).slice(-5);
    const own = `Probe Löwen ${stamp}`;
    const memberName = `Probe Kapitän ${stamp}`;
    const guestName = `Gast Probe ${stamp}`;
    const rules = { points_mode: "organizer", match_points: { win: 2, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff", "wins"] };
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const wideContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const phoneContext = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    let admin = null;
    let profileId = null;
    try {
      admin = await adminContext.newPage();
      await signIn(admin, "admin");

      // Spur und zwei Saisons; ein Vereinsprofil für das Mitglied.
      profileId = (await ok(await send(admin, "POST", "/api/membership/profiles/admin", { display_name: memberName }))).id;
      const lineage = await ok(await send(admin, "POST", `${SERIES}/lineages`, { title: `Probe Liga ${stamp}`, kind: "team_league", label: "4vs4", organizer: "Probe Verband" }));
      const season = async (name, tier, status) => ok(await send(admin, "POST", `${SERIES}/series`, { lineage_id: lineage.id, season: name, tier, status, rules, team_name: own }));
      const before = await season("2025", "Division 2", "completed");
      const current = await season("2026", "Division 1", "active");

      async function round(series, code, day, opponent) {
        return ok(await send(admin, "POST", `${SERIES}/series/${series.id}/rounds`, { code, day, opponent }));
      }
      async function people(series) {
        const member = await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/participants`, { name: memberName }));
        const guest = await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/participants`, { name: guestName }));
        return { member, guest };
      }
      async function publish(series, item, sheet) {
        const url = `${SERIES}/series/${series.id}/rounds/${item.id}/results`;
        const { version } = await ok(await admin.request.get(url));
        return ok(await send(admin, "PUT", url, { rows: [], ...sheet, status: "published", expected_version: version }));
      }

      // Vorsaison: ein Spiel, Tabelle laut Veranstalter (Platz 1 von 3).
      const oldPeople = await people(before);
      await ok(await send(admin, "POST", `${SERIES}/series/${before.id}/participants/${oldPeople.member.id}/assign`, { link: "member", profile_id: profileId }));
      await ok(await send(admin, "POST", `${SERIES}/series/${before.id}/participants/${oldPeople.guest.id}/assign`, { link: "guest" }));
      const oldRound = await round(before, "ST1", daysAgo(380), "Fremd Füchse");
      await publish(before, oldRound, {
        matches: [{ home: own, away: "Fremd Füchse", home_score: 3, away_score: 0, maps: [], lineup: [{ participant_id: oldPeople.member.id }] }],
        official_table: [{ team: own, rank: 1, points: 6 }, { team: "Fremd Füchse", rank: 2, points: 3 }, { team: "Fremd Bären", rank: 3, points: 0 }],
      });

      // Laufende Saison: der bestätigte Alias erkennt das Mitglied selbst; zwei Spiele, ein offener Spieltag.
      const nowPeople = await people(current);
      const listed = await ok(await admin.request.get(`${SERIES}/series/${current.id}/participants`));
      const items = Array.isArray(listed) ? listed : listed.participants || listed.items || [];
      expect(items.find((item) => item.id === nowPeople.member.id)?.link).toBe("member");
      const first = await round(current, "ST1", daysAgo(14), "Fremd Füchse");
      const second = await round(current, "ST2", daysAgo(7), "Fremd Bären");
      await round(current, "ST3", daysAgo(-7), "Fremd Adler");
      await publish(current, first, {
        matches: [{ home: own, away: "Fremd Füchse", home_score: 3, away_score: 1,
          maps: [{ name: "Karte Nord", home_score: 6, away_score: 2 }, { name: "Karte Süd", home_score: 4, away_score: 6 }, { name: "Karte Ost", home_score: 6, away_score: 3 }],
          lineup: [{ participant_id: nowPeople.member.id }, { participant_id: nowPeople.guest.id }] }],
      });
      await publish(current, second, {
        matches: [{ home: "Fremd Bären", away: own, home_score: 2, away_score: 2,
          maps: [{ name: "Karte West", home_score: 6, away_score: 4 }, { name: "Karte Nord", home_score: 3, away_score: 6 }],
          lineup: [{ participant_id: nowPeople.member.id }] }],
      });

      const url = `/references/series/${lineage.slug}/${current.season_slug}`;
      for (const [context, name] of [[wideContext, "breit"], [phoneContext, "handy"]]) {
        const page = await context.newPage();
        const problems = watch(page);
        await page.goto(url);
        const league = page.getByTestId("team-league");
        await expect(league).toBeVisible();
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
        await expect(page.getByTestId("team-league-progress")).toContainText("2 von 3 gespielt");
        await expect(page.getByTestId("team-league-next")).toContainText("gegen Fremd Adler");
        await expect(page.getByTestId("team-league-rules")).toContainText("Sieg 2 · Unentschieden 1 · Niederlage 0");
        const ownRow = page.getByTestId(`standing-row-${own}`);
        await expect(ownRow).toHaveAttribute("data-mine", "true");
        await expect(ownRow).toContainText("Verein");
        const days = page.getByTestId("team-league-matchday");
        await expect(days).toHaveCount(3);
        await expect(days.nth(0)).toHaveAttribute("data-outcome", "win");
        await expect(days.nth(1)).toHaveAttribute("data-outcome", "draw");
        await expect(days.nth(1)).toContainText("Auswärts");
        await expect(days.nth(0).getByTestId("team-league-maps")).toContainText("Karte Süd");
        const lineup = page.getByTestId("team-league-lineup");
        await expect(lineup.getByRole("link", { name: memberName })).toBeVisible();
        await expect(lineup.getByTestId("team-league-guests")).toContainText(guestName);
        await expect(lineup.getByRole("link", { name: guestName })).toHaveCount(0);
        const memberRow = lineup.getByTestId("team-league-player").filter({ hasText: memberName });
        await expect(memberRow).toContainText("23");
        const seasons = page.getByTestId("team-league-season");
        await expect(seasons).toHaveCount(2);
        await expect(seasons.nth(0)).toContainText("Platz 1 von 3");
        await expect(seasons.nth(0).getByRole("link")).toHaveAttribute("href", `/references/series/${lineage.slug}/${before.season_slug}`);
        await expect(seasons.nth(1)).toHaveAttribute("data-current", "true");
        // Am Handy schiebt sich nichts seitlich aus der Seite.
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await page.waitForTimeout(900); // Einblenden fertig, bevor das Bild entsteht
        await shot(page.locator("article"), `serien-seite-teamliga-${name}`);
        expect(problems).toEqual([]);
        await page.close();
      }
    } finally {
      if (admin && profileId) await send(admin, "PATCH", `/api/membership/profiles/admin/${profileId}`, { is_active: false }).catch(() => {});
      await adminContext.close();
      await wideContext.close();
      await phoneContext.close();
    }
  });
});
