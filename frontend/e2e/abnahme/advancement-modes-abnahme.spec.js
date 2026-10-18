const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Abnahme gegen den echten, lokal laufenden Server (docs/entwicklung/abnahme-lokal.md): Weiterkommen in vier Modi
// (#1590). Admin stellt den Modus ein (Turnier und Phase, Erklärtexte, Minutenfeld nur bei der Show); Turnierleitung
// macht bei der Show-Auslosung die Runde fertig, sieht die Karte „Auslosung bereit · N Namen“ mit Restzeit und lost;
// bei „sofort zufällig“ besetzt jedes Ergebnis sofort einen Platz in Runde 2 (der Baum des Spielers bewegt sich),
// Neu auslosen trifft nur nicht begonnene Spiele, ein Austritt danach räumt den richtigen Platz; der Matchplan sagt
// „wartet auf Auslosung“ bzw. „Prognose“. Desktop 1440 und Handy 375, keine Konsolenfehler, keine Antwort 4xx/5xx.
// Läuft nur mit ABNAHME=1; Konten und Kennungen schreibt scripts/seed_abnahme.py nach .local-testing/abnahme/state.json.

const ENABLED = process.env.ABNAHME === "1";
const STATE_FILE = process.env.ABNAHME_STATE || path.join(__dirname, "..", "..", "..", ".local-testing", "abnahme", "state.json");
const SHOTS = process.env.ABNAHME_SHOTS || "";
const state = ENABLED && fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : null;
const SIZES = { desktop: { width: 1440, height: 900 }, handy: { width: 375, height: 812 } };
// Ein Ergebnis aus dem Ergebnis-Fenster liegt 10 Sekunden mit „Rückgängig“ bereit, dann gilt es.
const HOLD_MS = 12_000;

function base32(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const digest = crypto.createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
}

async function login(page, account) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const started = await page.request.post("/api/auth/login", { data: { email: account.email, password: account.password, remember: true } });
    expect(started.status(), await started.text()).toBe(200);
    const body = await started.json();
    if (!body.mfa_required) return;
    const done = await page.request.post("/api/auth/mfa/complete", { data: { ticket: body.mfa_ticket, code: totp(account.totp), client: "web" } });
    if (done.status() === 200) return;
    // Jeder Code zählt einmal (#1032): im selben 30-Sekunden-Fenster auf den nächsten warten. Nach vielen Anmeldungen
    // (Seed, vorige Tests) bremst der Server (429) und nennt die Sekunden - so lange warten.
    const text = await done.text();
    const seconds = done.status() === 429 ? Number((text.match(/(\d+) Sekunden/) || [0, 60])[1]) + 2 : 31;
    await page.waitForTimeout(seconds * 1000);
  }
  throw new Error(`Anmeldung ${account.email} mit Zwei-Faktor nicht möglich`);
}

function watch(page, { role = "staff" } = {}) {
  const problems = [];
  page.on("pageerror", (error) => problems.push(`Seitenfehler: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !(role === "anon" && /401/.test(message.text()))) problems.push(`Konsole: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("/api/")) problems.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  return problems;
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

/** Die Spiele eines Turniers, wie der Server sie sieht (als angemeldete Turnierleitung). */
async function matchesOf(page, tid) {
  const response = await page.request.get(`/api/tournaments/${tid}/matches-v2`);
  expect(response.status(), await response.text()).toBe(200);
  const rows = (await response.json()).filter((row) => !row.is_preview);
  return Object.fromEntries(rows.map((row) => [row.match_key, row]));
}

async function tournamentOf(page, tid) {
  const response = await page.request.get(`/api/tournaments/${tid}?include_draft=true`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

function seated(match) {
  return (match.slots || []).filter((slot) => slot.registration_id).map((slot) => slot.registration_id);
}

/** Ein Ergebnis über das Ergebnis-Fenster der Turnierleitung: Duell nach Stand, Lauf nach Reihenfolge der Tipps. */
async function enterResult(page, match) {
  await page.getByTestId(`lead-enter-${match.id}`).click();
  const sheet = page.getByTestId("result-window");
  await expect(sheet).toBeVisible();
  const players = seated(match);
  if (players.length === 2) {
    await page.getByTestId(`result-score-${players[0]}-plus`).click();
    await page.getByTestId(`result-score-${players[0]}-plus`).click();
    await page.getByTestId(`result-score-${players[1]}-plus`).click();
  } else {
    for (const registrationId of players) await page.getByTestId(`result-order-${registrationId}`).click();
  }
  await expect(page.getByTestId("result-sentence")).not.toHaveText("");
  await page.getByTestId("result-save").click();
  await expect(page.getByTestId("result-undo-bar")).toBeVisible();
  await page.waitForTimeout(HOLD_MS);
  await expect(page.getByTestId("result-undo-bar")).toHaveCount(0);
  // Veröffentlicht der Server die Ablage (Zeitgeber nach 12 s; der Sammler im Scheduler ist im Abnahme-Stack aus)?
  // Erst dann stehen Baum, Auslosung und Folgespiele - also hier darauf warten, nicht nur auf das Verschwinden des
  // „Rückgängig“ in der Oberfläche.
  await expect.poll(async () => {
    const row = (await matchesOf(page, match.tournament_id))[match.match_key];
    return row?.pending_result ? "hält noch" : row?.status;
  }, { message: `Ergebnis für ${match.match_key} wurde nicht veröffentlicht - die Ablage hängt`, timeout: 30_000 })
    .toMatch(/^(completed|forfeit)$/);
}

test.describe("Abnahme: Weiterkommen in vier Modi gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.tournaments?.mode_instant, `Kein Seed-Stand mit den Modus-Turnieren: ${STATE_FILE} - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 300_000 });

  test("Admin: Modus im Turnier, Erklärtexte, Minutenfeld nur bei der Show", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Größe stellt der Test selbst ein");
    await page.setViewportSize(SIZES.desktop);
    await login(page, state.accounts.admin);
    const problems = watch(page);
    const tid = state.tournaments.mode_fixed;
    await page.goto(`/admin/tournaments/${tid}?tab=edit`);
    // Die Spieloptionen sind eingeklappt (<details>) - erst aufklappen, dann wählen.
    const openOptions = () => page.getByText("Erweiterte Spieloptionen", { exact: true }).click();
    await openOptions();
    const select = page.getByTestId("tr-edit-advancement");
    await expect(select).toHaveValue("fixed");
    await expect(page.getByTestId("tr-edit-advancement-hint")).toContainText("Sieger aus A trifft Sieger aus B");
    await expect(page.getByTestId("tr-edit-draw-show-minutes")).toHaveCount(0);
    for (const [mode, text] of [["draw_round", "alle Weiterkommer in einen Topf"], ["instant", "sofort auf einen zufälligen freien Platz"], ["draw_show", "Jetzt auslosen"]]) {
      await select.selectOption(mode);
      await expect(page.getByTestId("tr-edit-advancement-hint")).toContainText(text);
      await expect(page.getByTestId("tr-edit-draw-show-minutes")).toHaveCount(mode === "draw_show" ? 1 : 0);
    }
    await page.getByTestId("tr-edit-draw-show-minutes").fill("7");
    await shot(page, "admin-modus-turnier-show-1440.png");
    await page.getByTestId("tr-edit-save").click();
    await expect.poll(async () => (await tournamentOf(page, tid)).advancement_mode).toBe("draw_show");
    expect((await tournamentOf(page, tid)).draw_show_minutes).toBe(7);
    // Zurück auf den festen Baum - das Turnier bleibt, wie der Seed es angelegt hat.
    await page.reload();
    await openOptions();
    await page.getByTestId("tr-edit-advancement").selectOption("fixed");
    await page.getByTestId("tr-edit-save").click();
    await expect.poll(async () => (await tournamentOf(page, tid)).advancement_mode).toBe("fixed");

    // Je Phase: das Feld gibt es (StagesPanel im Einstellungsmodus, API `settings.advancement_mode`), doch diesen
    // Modus zeigt die Verwaltung seit der Matchplan-Seite (#1557) nirgends mehr - deshalb hier nur das Turnier.
    expect(problems).toEqual([]);
  });

  test("Show-Auslosung: Runde fertig, Karte „Auslosung bereit · N Namen“, Restzeit, Jetzt auslosen, Baum vorher und nachher", async ({ browser, page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Größe stellt der Test selbst ein");
    const tid = state.tournaments.mode_draw_show;
    const slug = state.slugs.mode_draw_show;
    await page.setViewportSize(SIZES.handy);
    await login(page, state.accounts.lead);
    const problems = watch(page);
    const before = await matchesOf(page, tid);
    const open = Object.values(before).find((row) => row.round === 1 && row.section === "WB" && !["completed", "forfeit"].includes(row.status));
    expect(open, "ein Lauf der Runde 1 ist noch offen").toBeTruthy();

    // Spieler-Sicht vorher: Runde 2 wartet auf die Auslosung.
    const playerContext = await browser.newContext({ viewport: SIZES.desktop });
    const playerPage = await playerContext.newPage();
    await login(playerPage, state.accounts.player);
    const playerProblems = watch(playerPage);
    await playerPage.goto(`/tournaments/${slug}/bracket`);
    await expect(playerPage.getByText("Weiter aus Runde 1").first()).toBeVisible();
    await shot(playerPage, "show-spieler-baum-vorher-1440.png");

    await page.goto(`/tournaments/${slug}/leitung`);
    await expect(page.getByTestId("lead-page")).toBeVisible();
    await page.getByTestId("lead-tab-results").click();
    await enterResult(page, open);
    await page.reload();
    const card = page.getByTestId("lead-draw-WB:2");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Auslosung bereit · 8 Namen");
    await expect(page.getByTestId("lead-draw-pot-WB:2").locator("li")).toHaveCount(8);
    await expect(page.getByTestId("lead-draw-countdown-WB:2")).toContainText(/automatisch in [1-6] Min\./);
    await shot(page, "show-leitung-auslosung-bereit-375.png");

    // Spieler sieht „Auslosung bereit“, solange die Leitung nicht gelost hat.
    await playerPage.reload();
    await expect(playerPage.getByText("Auslosung bereit").first()).toBeVisible();
    await shot(playerPage, "show-spieler-baum-bereit-1440.png");

    await page.getByTestId("lead-draw-now-WB:2").click();
    await expect(page.getByTestId("lead-draw-WB:2")).toHaveCount(0);
    const after = await matchesOf(page, tid);
    const second = Object.values(after).filter((row) => row.round === 2 && row.section === "WB");
    expect(second.every((row) => seated(row).length === 4 && row.status === "ready")).toBe(true);
    expect(second.every((row) => row.draw && row.draw.trigger === "show")).toBe(true);

    await playerPage.reload();
    await expect(playerPage.getByText("Auslosung bereit")).toHaveCount(0);
    for (const row of second) await expect(playerPage.getByTestId(`bracket-heat-${row.id}`)).toContainText(/\d/);
    await shot(playerPage, "show-spieler-baum-nachher-1440.png");
    expect(problems).toEqual([]);
    expect(playerProblems).toEqual([]);
    await playerContext.close();
  });

  test("Sofort zufällig: Ergebnis besetzt sofort einen Platz (Baum bewegt sich), zweites Ergebnis, Neu auslosen, Austritt danach", async ({ browser, page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Größe stellt der Test selbst ein");
    const tid = state.tournaments.mode_instant;
    const slug = state.slugs.mode_instant;
    await page.setViewportSize(SIZES.handy);
    await login(page, state.accounts.lead);
    const problems = watch(page);
    const start = await matchesOf(page, tid);
    const first = ["A", "B", "C", "D"].map((key) => start[key]);
    // Nach dem Planer tragen die Spiele einen Termin („scheduled“), sonst sind sie „ready“.
    expect(first.every((row) => row && ["ready", "scheduled"].includes(row.status))).toBe(true);

    // Der Spieler hat den Baum offen - er bekommt die Bewegung mit dem nächsten Nachladen.
    const playerContext = await browser.newContext({ viewport: SIZES.desktop });
    const playerPage = await playerContext.newPage();
    await login(playerPage, state.accounts.player);
    const playerProblems = watch(playerPage);
    await playerPage.goto(`/tournaments/${slug}/bracket`);
    await expect(playerPage.getByText("Sieger aus Viertelfinale")).toHaveCount(4);
    await shot(playerPage, "sofort-spieler-baum-vorher-1440.png");

    await page.goto(`/tournaments/${slug}/leitung`);
    await page.getByTestId("lead-tab-results").click();
    await enterResult(page, first[0]);
    let rows = await matchesOf(page, tid);
    const winnerA = rows.A.results.find((row) => row.rank === 1).registration_id;
    const landed = Object.values(rows).find((row) => row.round === 2 && seated(row).includes(winnerA));
    expect(landed, "der Sieger aus A sitzt sofort in Runde 2").toBeTruthy();
    expect(landed.status).toBe("pending");
    expect(landed.draw).toBeFalsy();
    // Der Baum des Spielers zieht nach (Live-Neuladen): drei Plätze warten noch, der Name steht in E oder F.
    await expect(playerPage.getByText("Sieger aus Viertelfinale")).toHaveCount(3, { timeout: 40_000 });
    const names = Object.fromEntries((await (await page.request.get(`/api/tournaments/${tid}/registrations`)).json()).map((reg) => [reg.id, reg.display_name]));
    await expect(playerPage.getByTestId(`bracket-match-v2-${landed.id}`)).toContainText(names[winnerA]);
    await shot(playerPage, "sofort-spieler-baum-ein-platz-1440.png");

    await enterResult(page, first[1]);
    rows = await matchesOf(page, tid);
    const winnerB = rows.B.results.find((row) => row.rank === 1).registration_id;
    expect(Object.values(rows).some((row) => row.round === 2 && seated(row).includes(winnerB))).toBe(true);
    await expect(playerPage.getByText("Sieger aus Viertelfinale")).toHaveCount(2, { timeout: 40_000 });
    await shot(playerPage, "sofort-spieler-baum-zwei-plaetze-1440.png");
    await shot(page, "sofort-leitung-375.png");

    // Neu auslosen (Admin, Reiter Spiele): nur Spiele, die noch nicht begonnen haben - hier beide der Runde 2.
    const adminContext = await browser.newContext({ viewport: SIZES.desktop });
    const adminPage = await adminContext.newPage();
    await login(adminPage, state.accounts.admin);
    const adminProblems = watch(adminPage);
    await adminPage.goto(`/admin/tournaments/${tid}?tab=stages`);
    const group = adminPage.getByTestId("draw-group-WB:2");
    await expect(group).toContainText("2 von 4 Plätzen gezogen");
    await shot(adminPage, "sofort-admin-auslosung-1440.png");
    // Matchplan: die Zielspiele sind nur Prognose, das Los füllt sie einzeln. Nach dem Austritt unten hat ein Spiel der
    // Runde 2 nur noch einen möglichen Spieler (Freilos) - der Planer löst dann seinen alten Termin (#1608).
    await adminPage.goto(`/admin/tournaments/${tid}?tab=matchplan`);
    await expect(adminPage.getByTestId("mp-settings")).toBeVisible();
    await expect(adminPage.getByTestId("mp-order")).toContainText("das Los entscheidet");
    await shot(adminPage, "matchplan-sofort-1440.png");
    await adminPage.goto(`/admin/tournaments/${tid}?tab=stages`);
    await expect(group).toContainText("2 von 4 Plätzen gezogen");
    await adminPage.getByTestId("redraw-WB:2").click();
    await adminPage.getByTestId("confirm-dialog-confirm").click();
    await expect(adminPage.getByText(/neu ausgelost\./)).toBeVisible();
    rows = await matchesOf(page, tid);
    const second = Object.values(rows).filter((row) => row.round === 2);
    expect(second.flatMap(seated).sort()).toEqual([winnerA, winnerB].sort());
    // Neu gemischt werden nur die schon gezogenen Plätze untereinander: sitzen beide Sieger im selben Spiel, bleibt es
    // voll (spielbereit) - begonnen hat aber keines.
    expect(second.every((row) => !row.started_at && ["pending", "ready", "scheduled"].includes(row.status))).toBe(true);
    await expect(group).toContainText("2 von 4 Plätzen gezogen");

    // Austritt des Siegers aus A: sein Platz in Runde 2 wird frei, der Verlierer aus A kommt nicht zurück (K.-o.).
    await adminPage.goto(`/admin/tournaments/${tid}`);
    // Die Teilnehmerliste hat je Zeile eine Handy- und eine Desktop-Fassung - die sichtbare zählt.
    await adminPage.getByTestId(`admin-reg-withdraw-${winnerA}`).locator("visible=true").first().click();
    await expect(adminPage.getByTestId("admin-reg-removal-dialog")).toBeVisible();
    await expect(adminPage.getByTestId("admin-reg-removal-ops")).toContainText(/Platz|frei|kampflos|Freilos/);
    await adminPage.getByTestId("admin-reg-removal-confirm").click();
    await expect(adminPage.getByTestId("admin-reg-removal-dialog")).toHaveCount(0);
    rows = await matchesOf(page, tid);
    const loserA = rows.A.results.find((row) => row.rank === 2).registration_id;
    const roundTwo = Object.values(rows).filter((row) => row.round === 2);
    expect(roundTwo.flatMap(seated)).not.toContain(winnerA);
    expect(roundTwo.flatMap(seated)).not.toContain(loserA);
    expect(roundTwo.flatMap(seated)).toContain(winnerB);
    const freedMatch = roundTwo.find((row) => row.slots.some((slot) => slot.source_result?.removed_registration_id === winnerA));
    const freed = freedMatch?.slots.find((slot) => slot.source_result?.removed_registration_id === winnerA);
    expect(freed?.status).toBe("bye");
    // #1608: Das Spiel mit dem Freilos hat keinen Planer-Termin und keine Station mehr, und kein anderes Spiel meldet
    // im Matchplan eine Überschneidung damit.
    expect(freedMatch.scheduled_at ?? null).toBeNull();
    expect(freedMatch.station_id ?? null).toBeNull();
    await adminPage.goto(`/admin/tournaments/${tid}?tab=matchplan`);
    await expect(adminPage.getByTestId("mp-order")).toBeVisible();
    await expect(adminPage.getByTestId("mp-order")).not.toContainText(new RegExp(`Überschneidet sich an .* mit ${freedMatch.match_key}\\.`));
    await shot(adminPage, "matchplan-sofort-nach-austritt-1440.png");
    // Der Spieler sieht den frei gewordenen Platz als Freilos und den Namen nur noch in Runde 1 - erst dann das Bild
    // („Sieger aus Viertelfinale“ zählt vorher wie nachher zwei, das reicht nicht als Warten auf das Nachladen).
    const freedCard = playerPage.getByTestId(`bracket-match-v2-${freedMatch.id}`);
    await expect(freedCard).toContainText("Freilos", { timeout: 40_000 });
    await expect(freedCard).not.toContainText(names[winnerA]);
    await expect(playerPage.getByText("Sieger aus Viertelfinale")).toHaveCount(2);
    await shot(playerPage, "sofort-spieler-baum-nach-austritt-1440.png");
    expect(problems).toEqual([]);
    expect(playerProblems).toEqual([]);
    expect(adminProblems).toEqual([]);
    await playerContext.close();
    await adminContext.close();
  });

  // Die Prognose bei „sofort zufällig“ prüft der Sofort-Test oben, vor dem Austritt.
  test("Matchplan: „wartet auf Auslosung“ nach der Runde", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Größe stellt der Test selbst ein");
    await page.setViewportSize(SIZES.desktop);
    await login(page, state.accounts.admin);
    const problems = watch(page);
    await page.goto(`/admin/tournaments/${state.tournaments.mode_draw_round}?tab=matchplan`);
    await expect(page.getByTestId("mp-settings")).toBeVisible();
    await expect(page.getByTestId("mp-order")).toContainText("wartet auf Auslosung");
    await shot(page, "matchplan-nach-der-runde-1440.png");
    expect(problems).toEqual([]);
  });
});
