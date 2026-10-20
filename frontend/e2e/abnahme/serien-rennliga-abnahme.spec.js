const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Seite einer Rennliga (#1746). Der Vorstand legt
// über die echten Routen eine Spur „Rennliga“ mit zwei Saisons an, trägt zwei Rennen ein (Teams je Rennen, schnellste
// Runde, Ausfall, Nichtstart, offizieller Gesamtstand mit Abweichung), sagt ein Rennen ab, ordnet Mitglieder, einen Gast
// und Fremde zu und blendet einen fremden Namen aus. Ohne Anmeldung zeigt die Seite dann Umschalter, Rennraster,
// Teamwertung, Vereins-Garage mit Teamduell, Fahrer-Detail (auch per Adresse) und Rennkalender - bei 1440 und 360 px,
// ohne Konsolenfehler und ohne seitliches Scrollen. Fremde Namen nur in den Tabellen (Garage und Duell sagen
// „Gastfahrer“, der Kalender nennt nur Vereinsfahrer), ausgeblendete gar nicht, die Seite ist noindex. Ein Mitglied, dessen
// Profil nicht mehr aktiv ist, bekommt kein Detail mehr - auch nicht über ?fahrer=. `ABNAHME_SHOTS` legt Bilder ab
// (optional). Nur erfundene Namen. Läuft nur mit ABNAHME=1.

const SERIES = "/api/reference-series/admin";
const SHOTS = process.env.ABNAHME_SHOTS || "";

/** Bilder erst, wenn Zeilen und Balken fertig eingeblendet sind (endlose Animationen der Seite zählen nicht). */
async function settle(page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => null))));
}

async function shot(target, name, options = {}) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await settle(typeof target.page === "function" ? target.page() : target);
  await target.screenshot({ path: path.join(SHOTS, `${name}.png`), ...options });
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

test.describe("Abnahme #1746: Seite Rennliga - Rennraster, Teamwertung, Garage, Fahrer-Detail, Kalender", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.accounts?.admin, `Kein Seed-Stand: ${STATE_FILE} - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test("eingetragene Rennen erscheinen als Rennliga-Seite, am Rechner und am Handy", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "ein Durchgang genügt");
    const stamp = Date.now().toString(36).slice(-5);
    const year = new Date().getFullYear();
    const person = (name) => `${name} ${stamp}`;
    const [lena, max, toni] = [person("Probe Lena"), person("Probe Max"), person("Probe Toni")];
    const guest = person("Gast Probe");
    const [alpha, beta, gamma, delta] = [person("Fremd Alpha"), person("Fremd Beta"), person("Fremd Gamma"), person("Fremd Delta")];
    const lions = "Probe Löwen";
    const juniors = "Probe Junioren";
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const anonContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const profiles = [];
    let admin = null;
    let ids = null;
    try {
      admin = await adminContext.newPage();
      await signIn(admin, "admin");

      // Drei Vereinsprofile, eine Spur mit zwei Saisons (Formel-1-Vorlage, Bonus für die schnellste Runde, Teamwertung
      // mit den besten zwei Fahrern), vier Termine - einer wird abgesagt, einer liegt in der Zukunft.
      for (const name of [lena, max, toni]) {
        profiles.push((await ok(await send(admin, "POST", "/api/membership/profiles/admin", { display_name: name }))).id);
      }
      const lineage = await ok(await send(admin, "POST", `${SERIES}/lineages`, {
        title: `Probe Rennliga ${stamp}`, kind: "racing", label: "F1", organizer: "Probe Liga", game_name: "Probe Rennspiel",
      }));
      const series = await ok(await send(admin, "POST", `${SERIES}/series`, {
        lineage_id: lineage.id, season: String(year), tier: "F1", status: "active", points_scheme_id: "formula_1",
        default_time: "20:30",
        rules: {
          bonuses: { fastest_lap: { points: 1, max_place: 10 } },
          team_scoring: { enabled: true, counting_drivers: 2, guests_count: true },
        },
      }));
      const before = await ok(await send(admin, "POST", `${SERIES}/series`, {
        lineage_id: lineage.id, season: String(year - 1), tier: "F1", status: "completed", points_scheme_id: "formula_1",
      }));
      const round = async (code, day, venue) => ok(await send(admin, "POST", `${SERIES}/series/${series.id}/rounds`, { code, day, venue }));
      const r1 = await round("R1", `${year}-01-08`, "Probering");
      const r2 = await round("R2", `${year}-01-15`, "Testkurs");
      const r3 = await round("R3", `${year}-01-22`, "Übungsstrecke");
      await round("R4", `${year + 1}-03-04`, "Zielgerade");
      await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/rounds/${r3.id}/cancel`, {}));

      // Rennen 1: neue Namen werden offene Teilnehmer; Teams je Rennen, schnellste Runde, Ausfall.
      const results = (item) => `${SERIES}/series/${series.id}/rounds/${item.id}/results`;
      const first = await ok(await send(admin, "PUT", results(r1), {
        status: "published", expected_version: 0,
        rows: [
          { name: alpha, place: 1, team: "Fremd Rot", marks: ["fastest_lap"] }, { name: lena, place: 2, team: lions },
          { name: beta, place: 3, team: "Fremd Blau" }, { name: max, place: 4, team: lions },
          { name: guest, place: 5, team: juniors }, { name: toni, place: 6, team: juniors },
          { name: gamma, place: 7, team: "Fremd Rot" }, { name: delta, place: 8, team: "Fremd Blau", marks: ["dnf"] },
        ],
      }));
      ids = Object.fromEntries(first.created_participants.map((item) => [item.name, item.id]));
      const assign = (name, body) => send(admin, "POST", `${SERIES}/series/${series.id}/participants/${ids[name]}/assign`, body);
      for (const [index, name] of [lena, max, toni].entries()) await ok(await assign(name, { link: "member", profile_id: profiles[index] }));
      await ok(await assign(guest, { link: "guest" }));
      for (const name of [alpha, beta, gamma, delta]) await ok(await assign(name, { link: "external" }));
      await ok(await send(admin, "PATCH", `${SERIES}/series/${series.id}/participants/${ids[gamma]}`, { name_hidden: true }));

      // Rennen 2: Sieg für den Verein, offizieller Gesamtstand 40 statt 43 (Strafe), Nichtstart.
      await ok(await send(admin, "PUT", results(r2), {
        status: "published", expected_version: 0,
        rows: [
          { name: lena, place: 1, team: lions, marks: ["pole"], official_total: 40 }, { name: alpha, place: 2, team: "Fremd Rot" },
          { name: toni, place: 3, team: juniors, marks: ["fastest_lap"] }, { name: guest, place: 4, team: juniors },
          { name: beta, place: 5, team: "Fremd Blau" }, { name: gamma, place: 6, team: "Fremd Rot", marks: ["dnf"] },
          { name: delta, place: 7, team: "Fremd Blau" }, { name: max, team: lions, marks: ["dns"] },
        ],
      }));

      // Ohne Anmeldung: die öffentliche Antwort trägt keinen ausgeblendeten Namen und keine Verknüpfungen.
      const anon = await anonContext.newPage();
      await signIn(anon, "anon");
      const problems = watch(anon);
      const url = `/references/series/${lineage.slug}/${series.season_slug}`;
      const api = await anon.request.get(`/api/reference-series/public/${lineage.slug}/${series.season_slug}`);
      const body = await ok(api);
      expect(JSON.stringify(body)).not.toContain(gamma);
      expect(body.racing.club_teams).toEqual([lions, juniors]);
      expect(Object.values(body.racing.drivers).every((item) => Object.keys(item).sort().join() === "guest,round_teams,team")).toBe(true);
      // Detail nur für öffentliche Vereinsfahrer (Tabellen-Reihenfolge), Teampunkte je Fahrer vom Server.
      expect(body.racing.club_drivers).toEqual([ids[lena], ids[toni], ids[max]]);
      for (const row of body.racing.teams.rows) {
        expect(Object.values(row.driver_points).reduce((total, value) => total + value, 0)).toBe(row.computed_points);
      }

      await anon.goto(url);
      await expect(anon.getByRole("heading", { level: 1 })).toContainText(`${year} · F1`);
      await expect(anon.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      const switcher = anon.getByRole("navigation", { name: "Saisons und Ligen" });
      await expect(switcher.getByRole("link")).toHaveCount(2);
      await expect(switcher.getByRole("link", { name: new RegExp(`^${year} · F1`) })).toHaveAttribute("aria-current", "page");
      await expect(anon.getByTestId("series-progress")).toContainText("2 von 3 Rennen gewertet · 1 abgesagt");
      await expect(anon.getByTestId("series-next")).toContainText("Nächstes Rennen: R4");

      // Rennraster: Podium in den Farben der Pokale, schnellste Runde, Ausfall, Abstand, Abweichung zum offiziellen Wert.
      const drivers = anon.getByTestId("racing-drivers");
      const table = drivers.getByTestId("series-table");
      await expect(table.getByTestId("series-row")).toHaveCount(8);
      const alphaRow = table.getByTestId("series-row").filter({ hasText: alpha });
      await expect(alphaRow.getByTestId("race-cell").first()).toHaveAttribute("data-medal", "gold");
      await expect(alphaRow.getByTestId("race-fastest")).toHaveCount(1);
      await expect(alphaRow.getByRole("button")).toHaveCount(0);
      await expect(alphaRow.getByRole("link")).toHaveCount(0);
      const lenaRow = table.getByTestId("series-row").filter({ hasText: lena });
      await expect(lenaRow.getByTestId("racing-deviation")).toContainText("−3");
      await expect(lenaRow.getByTestId("racing-gap")).toHaveText("−4");
      await expect(table.getByTestId("series-row").filter({ hasText: "Name ausgeblendet" }).getByTestId("race-cell").last()).toHaveText("DNF");
      await expect(table.getByTestId("series-row").filter({ hasText: max }).getByTestId("race-cell").last()).toHaveText("DNS");

      // Teamwertung und Garage: Vereinsteams hervorgehoben, Gast markiert, Teamduell.
      const teams = anon.getByTestId("racing-teams").getByTestId("series-table").getByTestId("series-row");
      await expect(teams).toHaveCount(4);
      await expect(teams.filter({ hasText: lions })).toHaveAttribute("data-club", "true");
      await expect(teams.filter({ hasText: juniors }).getByText("Gast", { exact: true })).toBeVisible();
      const garage = anon.getByTestId("racing-garage");
      await expect(garage.getByTestId("racing-garage-team")).toHaveCount(2);
      const juniorsCard = garage.getByTestId("racing-garage-team").filter({ hasText: juniors });
      await expect(juniorsCard.getByTestId("racing-duel")).toContainText("1:1");
      await expect(juniorsCard.getByTestId("racing-duel")).toContainText("24 Pkt fürs Team");
      // Garage und Duell sind keine Tabelle: der Gast heißt dort „Gastfahrer“, Marke und Punkte bleiben.
      await expect(garage).not.toContainText(guest);
      await expect(juniorsCard.getByText("Gastfahrer")).toHaveCount(2);
      await expect(juniorsCard.getByText("Gast", { exact: true })).toBeVisible();
      const detail = anon.getByTestId("racing-driver");
      await expect(detail.getByRole("heading", { level: 3 })).toHaveText(lena);
      await expect(detail.getByTestId("racing-driver-stats")).toHaveText("1 Sieg · 2 Podien · 0 schnellste Runden · 0 Ausfälle · 1 Pole");

      // Rennkalender: Sieger und bester Vereinsfahrer, abgesagtes Rennen ohne Sieger.
      const calendar = anon.getByTestId("racing-calendar").getByTestId("racing-round");
      // Ein fremder Sieger steht nur in der Tabelle - im Kalender dann nur der beste Vereinsfahrer mit Platz.
      await expect(calendar.nth(0).getByTestId("racing-round-winner")).toHaveCount(0);
      await expect(calendar.nth(0)).not.toContainText(alpha);
      await expect(calendar.nth(0).getByTestId("racing-round-club")).toContainText(`${lena} · P2`);
      await expect(calendar.nth(1).getByTestId("racing-round-winner")).toContainText(lena);
      await expect(calendar.nth(2)).toHaveAttribute("data-state", "cancelled");
      await expect(anon.locator("main")).not.toContainText(gamma);
      await shot(anon, "rennliga-1440", { fullPage: true });
      await shot(garage, "rennliga-garage-1440");
      await shot(drivers, "rennliga-fahrerwertung-1440");
      await shot(anon.getByTestId("racing-teams"), "rennliga-teamwertung-1440");

      // Aus der Tabelle ins Detail: die Adresse merkt sich den Fahrer, das Detail leuchtet einmal auf.
      await table.getByRole("button", { name: toni }).click();
      await expect(anon).toHaveURL(new RegExp(`fahrer=${ids[toni]}`));
      await expect(detail.getByRole("heading", { level: 3 })).toHaveText(toni);
      await expect(detail).toBeFocused();
      await anon.reload();
      await expect(anon.getByTestId("racing-driver").getByRole("heading", { level: 3 })).toHaveText(toni);

      // Am Handy (360 px): Karten statt der breiten Tabelle, nichts ragt seitlich hinaus.
      await anon.setViewportSize({ width: 360, height: 780 });
      await anon.goto(url);
      await expect(anon.getByTestId("racing-drivers").getByTestId("series-cards")).toBeVisible();
      await expect(anon.getByTestId("racing-drivers").getByTestId("series-table")).toBeHidden();
      await expect(anon.getByTestId("racing-driver")).toBeVisible();
      const overflow = await anon.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await shot(anon, "rennliga-360", { fullPage: true });
      // Fürs Handbuch: vom Titel bis zum Ende der Garage, ohne Kopf- und Fußleiste dazwischen.
      const clip = await anon.evaluate(() => {
        const top = document.querySelector("h1").getBoundingClientRect().top + window.scrollY - 16;
        const bottom = document.querySelector("[data-testid='racing-garage']").getBoundingClientRect().bottom + window.scrollY + 16;
        return { x: 0, y: Math.max(0, top), width: window.innerWidth, height: bottom - Math.max(0, top) };
      });
      await shot(anon, "rennliga-handy-360", { fullPage: true, clip });
      await shot(anon.getByTestId("racing-calendar"), "rennliga-kalender-360");

      // Profil nicht mehr aktiv: kein Detail, kein Knopf - auch eine Adresse mit ?fahrer= öffnet nichts.
      await ok(await send(admin, "PATCH", `/api/membership/profiles/admin/${profiles[1]}`, { is_active: false }));
      const after = await ok(await anon.request.get(`/api/reference-series/public/${lineage.slug}/${series.season_slug}`));
      expect(after.racing.club_drivers).toEqual([ids[lena], ids[toni]]);
      await anon.goto(`${url}?fahrer=${ids[max]}`);
      await expect(anon.getByTestId("racing-driver").getByRole("heading", { level: 3 })).toHaveText(lena);
      await expect(anon.getByTestId("racing-driver")).not.toContainText(max);
      const maxCard = anon.getByTestId("racing-drivers").getByTestId("series-card").filter({ hasText: max });
      await expect(maxCard.getByRole("button")).toHaveCount(0);
      await expect(anon.getByTestId("racing-garage")).not.toContainText(max);

      // Die Vorsaison ist über den Umschalter erreichbar.
      await anon.getByRole("navigation", { name: "Saisons und Ligen" }).getByRole("link", { name: new RegExp(`^${year - 1}`) }).click();
      await expect(anon).toHaveURL(new RegExp(`/references/series/${lineage.slug}/${before.season_slug}$`));
      await expect(anon.getByTestId("racing-drivers").getByTestId("series-no-table")).toBeVisible();
      expect(problems).toEqual([]);

      // Aufräumen: archivieren statt löschen.
      await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/archive`));
      await ok(await send(admin, "POST", `${SERIES}/series/${before.id}/archive`));
      await ok(await send(admin, "POST", `${SERIES}/lineages/${lineage.id}/archive`));
    } finally {
      if (admin) {
        for (const id of profiles) await send(admin, "PATCH", `/api/membership/profiles/admin/${id}`, { is_active: false }).catch(() => {});
      }
      await adminContext.close();
      await anonContext.close();
    }
  });
});
