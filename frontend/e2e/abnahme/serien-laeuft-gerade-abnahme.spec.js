const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): „Heute im Einsatz“ und „Läuft gerade“ auf der
// Referenzen-Übersicht (#1748). Der Vorstand legt über die echten Routen eine Turnierserie (ein gewerteter Termin, einer
// heute, einer in einer Woche) und eine Team-Liga (nächster Termin später) an, beide laufend. Ohne Anmeldung zeigt die
// Übersicht dann „Läuft gerade“ (seit #1878 eine Kartenreihe): zuerst die Turnierserie mit dem Chip „Heute“
// (Fortschritt, nächster Termin, Platz des Vereins, Link), dann die Liga - ohne fremde Namen, bei 1440 und 360 px ohne
// Überlauf, bei „Bewegung reduzieren“ ohne Puls. `ABNAHME_SHOTS` legt Bilder ab (optional). Nur erfundene Namen. Läuft nur mit ABNAHME=1.

const SERIES = "/api/reference-series/admin";
const SHOTS = process.env.ABNAHME_SHOTS || "";

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

/** Der Wiener Kalendertag, `offset` Tage von heute (JJJJ-MM-TT). */
function viennaDayOffset(offset) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset, 12)).toISOString().slice(0, 10);
}

test.describe("Abnahme #1748: Referenzen - Heute im Einsatz und Läuft gerade", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.accounts?.admin, `Kein Seed-Stand: ${STATE_FILE} - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test("laufende Saisons erscheinen mit Fortschritt, Termin und Platz", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "ein Durchgang genügt");
    const stamp = Date.now().toString(36).slice(-5);
    const memberName = `Probe Fahrer ${stamp}`;
    const foreign = [`Fremd Eins ${stamp}`, `Fremd Zwei ${stamp}`];
    const cupTitle = `Probe Monatscup der Lions Esports Akademie ${stamp}`; // lang: muss umbrechen
    const ownTeam = `Lions Esports Akademie ${stamp}`;
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const wideContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const phoneContext = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    let admin = null;
    let profileId = null;
    try {
      admin = await adminContext.newPage();
      await signIn(admin, "admin");
      profileId = (await ok(await send(admin, "POST", "/api/membership/profiles/admin", { display_name: memberName }))).id;

      const cup = await ok(await send(admin, "POST", `${SERIES}/lineages`, { title: cupTitle, kind: "series", organizer: "Probe Verband" }));
      const cupSeason = await ok(await send(admin, "POST", `${SERIES}/series`, {
        lineage_id: cup.id, season: "2026", status: "active", default_time: "20:00",
        rules: { points_mode: "scheme", points_by_place: [10, 8, 6] },
      }));
      const member = await ok(await send(admin, "POST", `${SERIES}/series/${cupSeason.id}/participants`, { name: memberName }));
      await ok(await send(admin, "POST", `${SERIES}/series/${cupSeason.id}/participants/${member.id}/assign`, { link: "member", profile_id: profileId }));
      const others = [];
      for (const name of foreign) others.push(await ok(await send(admin, "POST", `${SERIES}/series/${cupSeason.id}/participants`, { name })));
      const first = await ok(await send(admin, "POST", `${SERIES}/series/${cupSeason.id}/rounds`, { code: "Q1", day: viennaDayOffset(-7) }));
      await ok(await send(admin, "POST", `${SERIES}/series/${cupSeason.id}/rounds`, { code: "Q2", day: viennaDayOffset(0) }));
      await ok(await send(admin, "POST", `${SERIES}/series/${cupSeason.id}/rounds`, { code: "Q3", day: viennaDayOffset(7) }));
      const url = `${SERIES}/series/${cupSeason.id}/rounds/${first.id}/results`;
      const { version } = await ok(await admin.request.get(url));
      await ok(await send(admin, "PUT", url, {
        rows: [{ participant_id: others[0].id, place: 1 }, { participant_id: member.id, place: 2 }, { participant_id: others[1].id, place: 3 }],
        status: "published", expected_version: version,
      }));

      const league = await ok(await send(admin, "POST", `${SERIES}/lineages`, { title: `Probe Liga ${stamp}`, kind: "team_league", label: "4vs4" }));
      const leagueSeason = await ok(await send(admin, "POST", `${SERIES}/series`, {
        lineage_id: league.id, season: "2026", tier: "Division 1", status: "active", team_name: ownTeam,
        rules: { points_mode: "organizer", match_points: { win: 2, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff", "wins"] },
      }));
      await ok(await send(admin, "POST", `${SERIES}/series/${leagueSeason.id}/rounds`, { code: "ST1", day: viennaDayOffset(5), opponent: "Fremd Füchse" }));

      for (const [context, name] of [[wideContext, "breit"], [phoneContext, "handy"]]) {
        const page = await context.newPage();
        await signIn(page, "anon");
        const problems = watch(page);
        await page.goto("/references");
        const running = page.getByTestId("references-running");
        await expect(running).toBeVisible();
        const card = page.getByTestId(`running-card-${cup.slug}-${cupSeason.season_slug}`);
        await expect(card).toHaveAttribute("data-today", "true");
        await expect(card).toContainText("1 von 3 Turnieren gewertet");
        await expect(card).toContainText("Heute");
        await expect(card.getByTestId("running-place")).toContainText("2.");
        await expect(card.getByTestId("running-place")).toContainText("von 3");
        await expect(card.getByTestId("running-today-badge")).toBeVisible();
        const leagueCard = page.getByTestId("references-running-list").getByTestId(`running-card-${league.slug}-${leagueSeason.season_slug}`);
        await expect(leagueCard).toContainText("0 von 1 Spieltag gespielt");
        await expect(leagueCard.getByTestId("running-place")).toContainText("Noch offen");
        // Fremde Namen kommen nirgends vor.
        const text = await running.innerText();
        for (const person of foreign) expect(text).not.toContain(person);
        expect(text).not.toContain(memberName);
        // Langer Name wird umbrochen, nicht abgeschnitten; nichts schiebt sich seitlich.
        const clipped = await card.getByTestId("running-title").evaluate((node) => node.scrollWidth > node.clientWidth + 1);
        expect(clipped).toBe(false);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        // Vitrine/Übersicht bleiben darunter.
        await expect(page.getByTestId("references-hero")).toBeVisible();
        await page.waitForTimeout(1100); // Einblenden und Balken fertig
        await shot(running, `laeuft-gerade-${name}`);
        // Der Puls läuft - bei „Bewegung reduzieren“ nicht.
        expect(await card.getByTestId("running-today-badge").locator(".tls-run-pulse").evaluate((node) => getComputedStyle(node).animationName)).toBe("tls-run-pulse");
        await page.emulateMedia({ reducedMotion: "reduce" });
        expect(await card.getByTestId("running-today-badge").locator(".tls-run-pulse").evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
        // Link auf die Serienseite.
        await card.click();
        await expect(page).toHaveURL(new RegExp(`/references/series/${cup.slug}/${cupSeason.season_slug}$`));
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
