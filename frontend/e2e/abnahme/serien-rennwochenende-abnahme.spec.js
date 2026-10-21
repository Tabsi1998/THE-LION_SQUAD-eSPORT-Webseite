const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Rennwochenende mit Läufen (#1930). Eine F2 mit
// „Läufe je Runde“ (R1–R4 Blitz-Qualifying, Sprint mit eigenem Schema, Hauptrennen; ab R5 Sprint und Hauptrennen aus der
// umgekehrten WM-Reihenfolge) bekommt 8 Zeilen als Terminliste - 20 Läufe, im Kalender 8 Runden. Zwei Runden werden
// gewertet: Qualifying mit Zeiten (Pole von selbst), Sprint, Hauptrennen ohne Startplatz (kommt aus dem Qualifying). Eine
// F1 mit Qualifying und Rennen zählt die Pole. Ohne Anmeldung zeigen Kalender, Rennraster, Fahrer-Detail, „Läuft gerade“
// und „Heute im Einsatz“ je Runde eine Zeile mit Lauf-Chips - bei 1440 und 390 px, ohne Konsolenfehler und ohne seitliches
// Scrollen. `ABNAHME_RW_PHASE=vorher` legt dieselbe Liste auf dem alten Stand an (Bilder „vorher“). Nur erfundene Namen.

const SERIES = "/api/reference-series/admin";
const SHOTS = process.env.ABNAHME_SHOTS || "";
const PHASE = process.env.ABNAHME_RW_PHASE || "nachher";
const VENUES = ["Australien", "Bahrain", "Imola", "Monaco", "Spanien (Barcelona)", "Österreich", "Silverstone", "Ungarn"];

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

async function send(page, method, url, data) {
  const cookies = await page.context().cookies();
  const csrf = decodeURIComponent(cookies.find((cookie) => cookie.name === "csrf_token")?.value || "");
  return page.request.fetch(url, { method, data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
}

async function ok(response) {
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

/** Tag relativ zu heute (Wien) als JJJJ-MM-TT und TT.MM.JJJJ. */
function day(offset) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Vienna" }));
  now.setDate(now.getDate() + offset);
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return { iso, dotted: `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` };
}

const OFFSETS = [-14, -7, 0, 7, 14, 21, 28, 35];

async function noOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("Abnahme #1930: Rennwochenende mit Läufen", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.accounts?.admin, `Kein Seed-Stand: ${STATE_FILE} - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 300_000 });

  test("vorher: Lauf-Kürzel landen im Ort, das Qualifying ist eine eigene Runde", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium" || PHASE !== "vorher", "nur für die Bilder „vorher“ (ABNAHME_RW_PHASE=vorher)");
    const stamp = Date.now().toString(36).slice(-5);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const admin = await context.newPage();
    await signIn(admin, "admin");
    const lineage = await ok(await send(admin, "POST", `${SERIES}/lineages`, { title: `Probe Rennliga ${stamp}`, kind: "racing", label: "F2" }));
    const series = await ok(await send(admin, "POST", `${SERIES}/series`, {
      lineage_id: lineage.id, season: String(new Date().getFullYear()), tier: "F2", status: "active", points_scheme_id: "formula_1", default_time: "20:00",
    }));
    const lines = OFFSETS.slice(0, 3).flatMap((offset, index) => [
      `R${index + 1} Q · ${day(offset).dotted} 20:00 · ${VENUES[index]}`,
      `R${index + 1}S · ${day(offset).dotted} 20:30 · ${VENUES[index]}`,
      `R${index + 1} · ${day(offset).dotted} 21:15 · ${VENUES[index]}`,
    ]).join("\n");
    await admin.goto(`/admin/reference-series/${series.id}`);
    await admin.getByTestId("calendar-paste").click();
    await admin.getByTestId("paste-text").fill(lines);
    await admin.getByTestId("paste-submit").click();
    await expect(admin.getByTestId("paste-preview")).toBeVisible();
    await shot(admin.getByTestId("paste-sheet"), "vorher-terminliste-1440");
    await admin.getByTestId("paste-submit").click();
    await expect(admin.getByTestId("calendar-round")).toHaveCount(9);
    await shot(admin.getByTestId("series-calendar"), "vorher-kalender-verwaltung-1440");
    const anon = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await anon.goto(`/references/series/${lineage.slug}/${series.season_slug}`);
    await expect(anon.getByTestId("racing-calendar").getByTestId("racing-round")).toHaveCount(9);
    await shot(anon.getByTestId("racing-calendar"), "vorher-rennkalender-1440");
    await shot(anon, "vorher-seite-1440", { fullPage: true });
    await anon.setViewportSize({ width: 390, height: 844 });
    await anon.reload();
    await shot(anon.getByTestId("racing-calendar"), "vorher-rennkalender-390");
    await shot(anon, "vorher-seite-390", { fullPage: true });
    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.reload();
    await expect(admin.getByTestId("calendar-round")).toHaveCount(9);
    await shot(admin.getByTestId("series-calendar"), "vorher-kalender-verwaltung-390");
    await ok(await send(admin, "POST", `${SERIES}/series/${series.id}/archive`));
    await ok(await send(admin, "POST", `${SERIES}/lineages/${lineage.id}/archive`));
    await context.close();
  });

  test("nachher: 8 Zeilen werden 8 Runden mit ihren Läufen, Pole und Startplatz aus dem Qualifying", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium" || PHASE !== "nachher", "ein Durchgang genügt");
    const stamp = Date.now().toString(36).slice(-5);
    const year = new Date().getFullYear();
    const person = (name) => `${name} ${stamp}`;
    const [lena, max] = [person("Probe Lena"), person("Probe Max")];
    const [alpha, beta, gamma, delta] = [person("Fremd Alpha"), person("Fremd Beta"), person("Fremd Gamma"), person("Fremd Delta")];
    const lions = "Probe Löwen";
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const anonContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const profiles = [];
    const archive = [];
    let admin = null;
    try {
      admin = await adminContext.newPage();
      await signIn(admin, "admin");
      for (const name of [lena, max]) {
        profiles.push((await ok(await send(admin, "POST", "/api/membership/profiles/admin", { display_name: name }))).id);
      }
      const lineage = await ok(await send(admin, "POST", `${SERIES}/lineages`, {
        title: `Probe Rennliga ${stamp}`, kind: "racing", label: "F2", organizer: "Probe Liga", game_name: "Probe Rennspiel",
      }));
      archive.push(["lineages", lineage.id]);
      const series = await ok(await send(admin, "POST", `${SERIES}/series`, {
        lineage_id: lineage.id, season: String(year), tier: "F2", status: "active", default_time: "20:00", own_teams: [{ name: lions }],
        rules: { points_mode: "scheme", points_by_place: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], bonuses: { pole: { points: 2 } } },
      }));
      archive.unshift(["series", series.id]);

      // Läufe je Runde über die Verwaltung: Format 1 (R1–R4), ab R5 ohne Qualifying in umgekehrter WM-Reihenfolge.
      await admin.goto(`/admin/reference-series/${series.id}`);
      await admin.getByTestId("series-detail-edit").click();
      await admin.getByTestId("weekend-add").click();
      const first = admin.getByTestId("weekend-format").first();
      await first.getByTestId("weekend-session-label").first().fill("Blitz-Qualifying");
      await first.getByTestId("weekend-session-label").nth(1).fill("Hauptrennen");
      await first.getByTestId("weekend-session-offset").nth(1).fill("75");
      await first.getByTestId("weekend-session-add").click();
      const sprint = first.getByTestId("weekend-session").nth(2);
      await sprint.getByTestId("weekend-session-offset").fill("30");
      await sprint.getByTestId("weekend-session-points-mode").selectOption("own");
      await sprint.getByTestId("weekend-session-points").fill("12-9-7-6-5-4-3-2-1");
      await admin.getByTestId("weekend-phase-add").click();
      const second = admin.getByTestId("weekend-format").nth(1);
      await second.getByTestId("weekend-format-from").fill("5");
      await second.getByTestId("weekend-session-remove").first().click();
      await second.getByTestId("weekend-session-offset").first().fill("45");
      await second.getByTestId("weekend-session-offset").nth(1).fill("0");
      for (const select of await second.getByTestId("weekend-session-grid").all()) await select.selectOption("reverse_standings");
      await shot(admin.getByTestId("series-weekend"), "nachher-laeufe-je-runde-1440");
      await admin.getByTestId("series-save").click();
      await expect(admin.getByTestId("series-sheet")).toBeHidden();
      const saved = await ok(await send(admin, "GET", `${SERIES}/series/${series.id}`));
      expect(saved.weekend.formats.map((format) => [format.from_round, format.sessions.map((item) => item.label)])).toEqual([
        [1, ["Blitz-Qualifying", "Hauptrennen", "Sprint"]], [5, ["Hauptrennen", "Sprint"]],
      ]);

      // 8 Zeilen, eine je Runde: R1–R4 je drei Läufe, R5–R8 je zwei - im Kalender 8 Runden.
      const lines = OFFSETS.map((offset, index) => `R${index + 1} · ${day(offset).dotted} · ${VENUES[index]}`).join("\n");
      await admin.getByTestId("calendar-paste").click();
      await admin.getByTestId("paste-text").fill(lines);
      await admin.getByTestId("paste-submit").click();
      await expect(admin.getByTestId("paste-preview")).toBeVisible();
      await expect(admin.getByTestId("paste-submit")).toHaveText("20 Termine übernehmen");
      await shot(admin.getByTestId("paste-sheet"), "nachher-terminliste-1440");
      await admin.getByTestId("paste-submit").click();
      await expect(admin.getByTestId("calendar-weekend")).toHaveCount(8);
      await expect(admin.getByTestId("calendar-round")).toHaveCount(20);
      const calendar = await ok(await send(admin, "GET", `${SERIES}/series/${series.id}/calendar`));
      const rounds = calendar.rounds;
      const find = (code, kind) => rounds.find((item) => item.code === code && item.session_kind === kind);

      // Runde 1 und 2: Qualifying mit Zeiten (eine ohne), Sprint mit eigenem Startplatz, Hauptrennen ohne Startplatz.
      const results = (round) => `${SERIES}/series/${series.id}/rounds/${round.id}/results`;
      const publish = (round, rows) => send(admin, "PUT", results(round), { status: "published", expected_version: 0, rows });
      const quali1 = await ok(await publish(find("R1", "qualifying"), [
        { place: 1, name: lena, start_number: "7", team: lions, time: "1:21.004" },
        { place: 2, name: alpha, start_number: "3", team: "Fremd Rot", time: "1:21.363", gap: "+0.359" },
        { place: 3, name: max, start_number: "8", team: lions, time: "1:21.700", gap: "+0.696" },
        { place: 4, name: beta, start_number: "11", team: "Fremd Blau", time: "1:22.010", gap: "+1.006" },
        { place: 5, name: gamma, start_number: "20", team: "Fremd Rot", time: "1:22.400", gap: "+1.396" },
        { place: 6, name: delta, start_number: "21", team: "Fremd Blau", time: "--:--.---" },
      ]));
      expect(quali1.sheet.rows[0].marks).toEqual(["pole"]);
      const ids = Object.fromEntries(quali1.created_participants.map((item) => [item.name, item.id]));
      const assign = (name, body) => send(admin, "POST", `${SERIES}/series/${series.id}/participants/${ids[name]}/assign`, body);
      await ok(await assign(lena, { link: "member", profile_id: profiles[0] }));
      await ok(await assign(max, { link: "member", profile_id: profiles[1] }));
      for (const name of [alpha, beta, gamma, delta]) await ok(await assign(name, { link: "external" }));
      await ok(await publish(find("R1", "sprint"), [
        { place: 1, name: max, team: lions, grid: 2 }, { place: 2, name: beta, grid: 1 }, { place: 3, name: lena, team: lions, grid: 6 },
        { place: 4, name: alpha, grid: 5 }, { place: 5, name: gamma, grid: 4 }, { place: 6, name: delta, grid: 3 },
      ]));
      await ok(await publish(find("R1", "race"), [
        { place: 1, name: lena, team: lions }, { place: 2, name: alpha }, { place: 3, name: max, team: lions },
        { place: 4, name: gamma }, { place: 5, name: beta }, { place: 6, name: delta, grid: 2 },
      ]));
      await ok(await publish(find("R2", "qualifying"), [
        { place: 1, name: max, team: lions, time: "1:30.512" }, { place: 2, name: lena, team: lions, time: "1:30.640", gap: "+0.128" },
        { place: 3, name: beta, time: "1:31.001", gap: "+0.489" }, { place: 4, name: alpha, time: "1:31.200", gap: "+0.688" },
        { place: 5, name: delta, time: "1:31.900", gap: "+1.388" }, { place: 6, name: gamma, time: "1:32.300", gap: "+1.788" },
      ]));
      await ok(await publish(find("R2", "sprint"), [
        { place: 1, name: alpha, grid: 3 }, { place: 2, name: lena, team: lions, grid: 1 }, { place: 3, name: gamma, grid: 4 },
        { place: 4, name: max, team: lions, grid: 2 }, { place: 5, name: delta, grid: 6 }, { place: 6, name: beta, grid: 5 },
      ]));
      await ok(await publish(find("R2", "race"), [
        { place: 1, name: max, team: lions }, { place: 2, name: beta }, { place: 3, name: lena, team: lions },
        { place: 4, name: alpha }, { place: 5, name: delta }, { place: 6, name: gamma, marks: ["dnf"] },
      ]));

      // Verwaltung: Kalender mit einem Kopf je Runde, Ergebnisse je Lauf als Chips, Blatt eines Qualifyings.
      await admin.reload();
      await expect(admin.getByTestId("calendar-weekend")).toHaveCount(8);
      await expect(admin.getByTestId("calendar-weekend").first()).toHaveAttribute("data-state", "scored");
      await shot(admin.getByTestId("series-calendar"), "nachher-kalender-verwaltung-1440");
      const resultsSection = admin.getByTestId("series-results");
      await expect(resultsSection.getByTestId("results-weekend")).toHaveCount(8);
      await shot(resultsSection, "nachher-ergebnisse-verwaltung-1440");
      await resultsSection.getByTestId("results-weekend").nth(2).getByTestId("session-chip").first().click();
      await expect(admin.getByTestId("result-mode")).toContainText("Qualifying · ohne Punkte · Pole von selbst");
      await expect(admin.getByTestId("result-race")).toHaveCount(0);
      await shot(admin.getByTestId("result-sheet"), "nachher-quali-blatt-1440");
      await admin.keyboard.press("Escape");

      // Öffentlich: 8 Runden, Fortschritt in Runden, der nächste Lauf heute, Kopf je Runde im Raster.
      const anon = await anonContext.newPage();
      await signIn(anon, "anon");
      const problems = watch(anon);
      const url = `/references/series/${lineage.slug}/${series.season_slug}`;
      const body = await ok(await anon.request.get(`/api/reference-series/public/${lineage.slug}/${series.season_slug}`));
      expect(body.progress).toMatchObject({ total: 8, scored: 2 });
      expect(body.progress.next).toMatchObject({ code: "R3", session: "Blitz-Qualifying", state: "today" });
      const rows = Object.fromEntries(body.standings.rows.map((row) => [row.name, row]));
      const feature1 = (name) => rows[name].results.find((item) => item.round_id === find("R1", "race").id);
      // Startplatz aus dem Qualifying, eine Strafe (Delta von 2) bleibt; die Pole zählt am Hauptrennen mit 2 Punkten.
      expect([lena, alpha, max, beta, gamma, delta].map((name) => feature1(name).grid)).toEqual([1, 2, 3, 4, 5, 2]);
      expect(feature1(lena)).toMatchObject({ marks: ["pole"], points: 27 });
      // Der Sprint zählt mit seinem eigenen Schema (12-9-7 …).
      expect(rows[max].results.find((item) => item.round_id === find("R1", "sprint").id).points).toBe(12);
      expect(body.racing.qualifying).toHaveLength(2);

      await anon.goto(url);
      await expect(anon.getByTestId("series-progress")).toContainText("2 von 8 Rennen gewertet");
      await expect(anon.getByTestId("series-next")).toContainText("R3 · Blitz-Qualifying");
      await expect(anon.getByTestId("racing-session-points")).toContainText("Sprint: 12 · 9 · 7 · 6 · 5 · 4 · 3 · 2 · 1");
      const cal = anon.getByTestId("racing-calendar");
      await expect(cal.getByTestId("racing-round")).toHaveCount(8);
      await expect(cal.getByTestId("racing-round").nth(0).getByTestId("session-chip")).toHaveCount(3);
      await expect(cal.getByTestId("racing-round").nth(4).getByTestId("session-chip")).toHaveCount(2);
      await expect(cal.getByTestId("racing-round").nth(2)).toHaveAttribute("data-state", "today");
      const table = anon.getByTestId("racing-drivers").getByTestId("series-table");
      await expect(table.getByTestId("series-weekend-head")).toHaveCount(8);
      await expect(table.getByTestId("series-session-head").first()).toHaveText("S");
      const detail = anon.getByTestId("racing-driver");
      await expect(detail.getByRole("heading", { level: 3 })).toHaveText(lena);
      await expect(detail.getByTestId("racing-driver-stats")).toContainText("1 Pole");
      await expect(detail.getByTestId("racing-driver-stats")).toContainText("Ø Start");
      await expect(detail.getByTestId("racing-driver-stats")).toContainText(`Quali-Duell 1:1 gegen ${max}`);
      await shot(anon, "nachher-seite-1440", { fullPage: true });
      await shot(anon.getByTestId("racing-drivers"), "nachher-rennraster-1440");
      await shot(cal, "nachher-rennkalender-1440");
      await shot(anon.getByTestId("racing-garage"), "nachher-fahrer-detail-1440");

      // „Läuft gerade“ und „Heute im Einsatz“: der heutige Lauf und die Chips der Runde.
      await anon.goto("/references");
      const card = anon.getByTestId(`running-card-${lineage.slug}-${series.season_slug}`);
      await expect(card.getByTestId("running-next")).toContainText("R3 · Blitz-Qualifying · 20:00");
      await expect(card.getByTestId("running-sessions").getByTestId("session-chip")).toHaveCount(3);
      await shot(card, "nachher-laeuft-gerade-1440");
      await anon.goto("/");
      const today = anon.getByTestId(`home-today-item-${lineage.slug}-${series.season_slug}`);
      await expect(today.getByTestId("home-today-facts")).toContainText("R3 · Blitz-Qualifying");
      await expect(today.getByTestId("home-today-sessions").getByTestId("session-chip")).toHaveCount(3);
      await shot(anon.getByTestId("home-today"), "nachher-heute-im-einsatz-1440");

      // Handy (390 und 360 px): Chips lesbar, nichts ragt seitlich hinaus.
      for (const width of [390, 360]) {
        await anon.setViewportSize({ width, height: 844 });
        await anon.goto(url);
        await expect(anon.getByTestId("racing-calendar").getByTestId("racing-round")).toHaveCount(8);
        await noOverflow(anon);
        const chip = anon.getByTestId("racing-calendar").getByTestId("session-chip").first();
        const size = await chip.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
        expect(size).toBeGreaterThanOrEqual(11);
        await shot(anon.getByTestId("racing-calendar"), `nachher-rennkalender-${width}`);
        if (width === 390) {
          await shot(anon, "nachher-seite-390", { fullPage: true });
          await anon.goto("/references");
          await noOverflow(anon);
          await shot(anon.getByTestId(`running-card-${lineage.slug}-${series.season_slug}`), "nachher-laeuft-gerade-390");
          await anon.goto("/");
          await shot(anon.getByTestId("home-today"), "nachher-heute-im-einsatz-390");
        }
      }
      await admin.setViewportSize({ width: 390, height: 844 });
      await admin.goto(`/admin/reference-series/${series.id}`);
      await expect(admin.getByTestId("calendar-weekend")).toHaveCount(8);
      await noOverflow(admin);
      await shot(admin.getByTestId("series-calendar"), "nachher-kalender-verwaltung-390");
      await shot(admin.getByTestId("series-results"), "nachher-ergebnisse-verwaltung-390");
      expect(problems).toEqual([]);

      // F1: Qualifying und Rennen - der Startplatz kommt aus dem Qualifying, die Pole wird gezählt.
      const f1 = await ok(await send(admin, "POST", `${SERIES}/series`, {
        lineage_id: lineage.id, season: String(year), tier: "F1", status: "active", default_time: "20:30", points_scheme_id: "formula_1",
        weekend: { formats: [{ sessions: [{ label: "Qualifying" }, { label: "Rennen", offset: 30 }] }] },
      }));
      archive.unshift(["series", f1.id]);
      const f1Paste = await ok(await send(admin, "POST", `${SERIES}/series/${f1.id}/rounds/paste`, {
        text: `R1 · ${day(-3).dotted} · Monza`, apply: true,
      }));
      expect(f1Paste.created).toBe(2);
      const [f1Quali, f1Race] = f1Paste.rounds;
      expect([f1Quali.session, f1Quali.counts, f1Race.session, f1Race.time]).toEqual(["Qualifying", false, "Rennen", "21:00"]);
      const f1Results = (round, rows) => send(admin, "PUT", `${SERIES}/series/${f1.id}/rounds/${round.id}/results`, { status: "published", expected_version: 0, rows });
      await ok(await f1Results(f1Quali, [{ place: 1, name: max, time: "1:20.100" }, { place: 2, name: lena, time: "1:20.300", gap: "+0.200" }]));
      await ok(await f1Results(f1Race, [{ place: 1, name: lena }, { place: 2, name: max }]));
      const f1Page = await ok(await anon.request.get(`/api/reference-series/public/${lineage.slug}/${f1.season_slug}`));
      const f1Rows = Object.fromEntries(f1Page.standings.rows.map((row) => [row.name, row.results[0]]));
      expect([f1Rows[max].grid, f1Rows[lena].grid, f1Rows[max].marks]).toEqual([1, 2, ["pole"]]);
    } finally {
      if (admin) {
        for (const [kind, id] of archive) await send(admin, "POST", `${SERIES}/${kind}/${id}/archive`).catch(() => {});
        for (const id of profiles) await send(admin, "PATCH", `/api/membership/profiles/admin/${id}`, { is_active: false }).catch(() => {});
      }
      await adminContext.close();
      await anonContext.close();
    }
  });
});
