const { test, expect } = require("@playwright/test");
const { ENABLED, state, signIn, watch } = require("./abnahmeSession");
const { HANDY, PC, bild, bilder } = require("./anleitungBilder");

// Die Helfer-Anleitung (docs/handbuch/helfer.md, #1686) gegen den echten Server (docs/entwicklung/abnahme-lokal.md):
// jeder Schritt aus „A. Station“, „C. Einlass“ und „Wenn etwas nicht passt“ einmal wirklich durchgespielt - als Helfer
// bzw. Turnierleitung, so wie die Anleitung es sagt. Stimmt ein Knopf oder ein Wort der Anleitung nicht mehr, wird
// diese Abnahme rot. Mit ABNAHME_SHOTS entstehen dabei die Bilder der Anleitung (PC 1440 px und Handy 390 px,
// zugeschnitten); sie liegen danach in docs/assets/helfer/. „B. Simulator“ steht in helfer-anleitung-fastlap-abnahme
// (eigener Seed). Läuft nur mit ABNAHME=1; Stand aus scripts/seed_abnahme.py (local_live, local_draft, onsite_members).

const live = state?.tournaments?.local_live;
const liveSlug = state?.slugs?.local_live || live;
const members = state?.tournaments?.onsite_members;
const membersSlug = state?.slugs?.onsite_members;

test.use({ deviceScaleFactor: 2, viewport: PC });
test.describe.configure({ mode: "serial" });

async function csrfHeaders(page) {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "csrf_token");
  return csrf ? { "X-CSRF-Token": decodeURIComponent(csrf.value) } : {};
}

async function send(page, method, url, data) {
  return page.request.fetch(url, { method, data, headers: await csrfHeaders(page) });
}

async function queueOf(page) {
  const response = await page.request.get(`/api/tournaments/${live}/live-queue`);
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe("Abnahme: Helfer-Anleitung (Station, Einlass, Wenn etwas nicht passt)", () => {
  test.skip(!ENABLED || !live || !members, "nur mit ABNAHME=1 und einem befüllten Abnahme-Stand (scripts/seed_abnahme.py)");
  test.skip(({ isMobile }) => Boolean(isMobile), "Breiten stellt der Test selbst ein");

  test("A. Station: als Helfer aufrufen, starten, Ergebnis eintragen, Rückgängig", async ({ page, browser }) => {
    test.setTimeout(240_000);
    // „Die Turnierleitung trägt dich ein“: der Helfer (im Seed nur am Vorschau-Cup) kommt als Schiedsrichter dazu.
    const leadContext = await browser.newContext();
    try {
      const lead = await leadContext.newPage();
      await signIn(lead, "lead");
      const staff = await (await lead.request.get(`/api/tournaments/${state.tournaments.local_draft}/staff`)).json();
      const helper = staff.find((row) => row.role === "referee");
      expect(helper?.user?.id, "Helfer im Seed").toBeTruthy();
      const added = await send(lead, "POST", `/api/tournaments/${live}/staff`, { user_id: helper.user.id, role: "referee" });
      expect(added.status(), await added.text()).toBe(200);
    } finally {
      await leadContext.close();
    }

    await signIn(page, "helper");
    const problems = watch(page, { allow: (response) => response.status() === 409 && /live-queue\/(call|start)/.test(response.url()) });

    // Öffnen: Turnier → Turnierleitung → Reiter „Stationen“.
    await page.goto(`/tournaments/${liveSlug}/leitung`);
    await page.getByTestId("lead-tab-stations").click();
    await expect(page.getByTestId("lead-tab-stations")).toHaveAttribute("aria-selected", "true");
    const board = page.getByTestId("live-board");
    await expect(board).toBeVisible();
    const head = page.getByTestId("lead-page");
    await bilder(page, "a0-oeffnen", [head.getByText("Turnierleitung", { exact: true }), head.locator("h1"), page.getByRole("tablist", { name: "Turnierleitung" })]);

    // 1. „Als Nächstes“ an einer freien Station - „Aufrufen“.
    const call = board.locator("[data-testid^='live-call-']").first();
    await expect(call).toBeVisible();
    const stationId = (await call.getAttribute("data-testid")).replace("live-call-", "");
    const card = page.getByTestId(`live-station-${stationId}`);
    const next = page.getByTestId(`live-next-${stationId}`);
    await expect(next).toContainText("Als Nächstes");
    await expect(call).toHaveText(/Aufrufen/);
    await bilder(page, "a1-aufrufen", card);
    await call.click();
    await expect(next).toHaveAttribute("data-state", "called");
    await expect(next).toContainText("antreten bis");

    // 2. Alle da: „Gestartet“ - die Uhr läuft.
    const start = page.getByTestId(`live-start-${stationId}`);
    await expect(start).toHaveText(/Gestartet/);
    await bilder(page, "a2-gestartet", card);
    await start.click();
    const running = page.getByTestId(`live-running-${stationId}`);
    await expect(running.locator("[role='timer']")).toBeVisible();
    const matchId = (await queueOf(page)).stations.find((station) => station.id === stationId)?.running?.match_id;
    expect(matchId, "laufendes Spiel an der Station").toBeTruthy();

    // 3. Spiel fertig: Reiter „Ergebnisse“ → „Eintragen“ → Plätze setzen → speichern.
    await page.getByTestId("lead-tab-results").click();
    await page.getByTestId(`lead-enter-${matchId}`).click();
    const dialog = page.getByTestId("result-window");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Ergebnis eintragen");
    const order = dialog.locator("[data-testid^='result-order-']");
    if (await page.getByTestId("result-heat-mode-order").count()) await page.getByTestId("result-heat-mode-order").click();
    const sides = await order.count();
    expect(sides).toBeGreaterThan(1);
    for (let index = 0; index < sides; index += 1) await order.nth(index).click();
    await expect(page.getByTestId("result-sentence")).not.toContainText("Noch kein Ergebnis");
    await bilder(page, "a3-ergebnis", dialog, { pad: 0 });
    await page.getByTestId("result-save").click();

    // 4. Vertippt? Sofort „Rückgängig“ (10 Sekunden).
    const undoBar = page.getByTestId("result-undo-bar");
    await expect(undoBar).toBeVisible();
    await expect(page.getByTestId("result-undo")).toHaveText(/Rückgängig \(\d+\)/);
    await bilder(page, "a4-rueckgaengig", undoBar.getByRole("status"));
    await page.getByTestId("result-undo").click();
    await expect(undoBar).toHaveCount(0);
    // Nichts ist passiert: das Spiel steht wieder offen zum Eintragen.
    await expect(page.getByTestId(`lead-enter-${matchId}`)).toBeVisible();
    // Später: „Korrigieren“ an einem schon eingetragenen Spiel.
    await expect(page.locator("[data-testid^='lead-correct-']").first()).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("Wenn etwas nicht passt: Station defekt - die Turnierleitung sieht es und legt um", async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page, "lead");
    const problems = watch(page);
    // Gerät kaputt: die Turnierleitung meldet die Station als defekt, an der gerade gespielt wird.
    const queue = await queueOf(page);
    const station = queue.stations.find((row) => row.running) || queue.stations.find((row) => row.next);
    expect(station, "Station mit Spielen").toBeTruthy();
    const broken = await send(page, "PATCH", `/api/stations/${station.id}`, { status: "broken" });
    expect(broken.status(), await broken.text()).toBe(200);

    await page.goto(`/tournaments/${liveSlug}/leitung`);
    await expect(page.getByTestId("lead-tab-attention")).toHaveAttribute("aria-selected", "true");
    const item = page.getByTestId(`lead-case-st-${station.id}`);
    await expect(item).toContainText("Station defekt");
    await page.getByTestId(`lead-case-move-st-${station.id}`).click();
    await expect(page.getByTestId(`lead-case-stations-st-${station.id}`)).toContainText("Auf welche Station?");
    await bilder(page, "x-aufmerksamkeit", [page.getByTestId("lead-tab-attention"), item]);
    expect(problems).toEqual([]);
  });

  test("C. Einlass: QR-Aushang, Mitspielen, Check-in, neuer Code", async ({ page, browser }) => {
    test.setTimeout(240_000);
    await signIn(page, "lead");
    const problems = watch(page);
    const accessOf = async () => (await page.request.get(`/api/tournaments/${members}/onsite-access`)).json();
    await page.goto(`/admin/tournaments/${members}`);
    await expect(page.getByTestId("onsite-access-panel")).toBeVisible();
    if (!(await accessOf()).enabled) await page.getByTestId("onsite-access-toggle").click();
    await expect(page.getByTestId("onsite-access-state")).toContainText("An");

    // 1. QR-Code am Aushang (PC) - gescannt landet man in der schlanken Turnierseite mit „Mitspielen“ (Handy).
    await page.goto(`/admin/tournaments/${members}/aushang`);
    const sheet = page.getByTestId("onsite-poster-sheet");
    await expect(sheet).toContainText("Scannen");
    await page.setViewportSize(PC);
    await bild(page, "c1-qr-pc", sheet, { pad: 0 });
    const token = (await accessOf()).path.split("#")[1];
    const guestContext = await browser.newContext({ viewport: HANDY, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    try {
      const guest = await guestContext.newPage();
      await signIn(guest, "anon");
      const passkeys = (response) => response.status() === 503 && response.url().includes("/api/auth/passkeys/");
      const guestProblems = watch(guest, {
        allow: (response) => [401, 403].includes(response.status()) || passkeys(response),
        allowConsole: (text) => text.includes("status of 503"),
      });
      await guest.goto(`/vor-ort#${token}`);
      await guest.waitForURL(`**/tournaments/${membersSlug}`);
      const view = guest.getByTestId("onsite-tournament-view");
      await expect(view).toBeVisible();
      await expect(guest.getByTestId("onsite-register-btn")).toBeVisible();
      await bild(guest, "c1-qr-handy", view);
      expect(guestProblems).toEqual([]);
    } finally {
      await guestContext.close();
    }

    // 2. Einchecken macht die Turnierleitung: Reiter „Teilnehmer“, Knopf „Check-in“.
    await page.goto(`/admin/tournaments/${members}`);
    const regs = await (await page.request.get(`/api/tournaments/${members}/registrations`)).json();
    const waiting = regs.find((row) => row.status !== "checked_in" && !["rejected", "waitlist"].includes(row.status));
    expect(waiting, "Anmeldung zum Einchecken").toBeTruthy();
    const table = page.locator("table").filter({ visible: true });
    await expect(table.getByRole("button", { name: "Check-in" }).first()).toBeVisible();
    // Am PC die Knöpfe der ersten Zeile (die Tabelle ist sehr breit, der Name steht weit links), am Handy die erste Karte.
    const firstRow = table.locator("tbody tr").first();
    await bilder(page, "c2-einchecken", (mode) => (mode === "pc"
      ? [firstRow.locator("select"), firstRow.getByRole("button", { name: "Entfernen" })]
      : page.locator("div[class*='md:hidden'][class*='divide-y'] > div").first()));
    await table.getByRole("row").filter({ hasText: waiting.display_name || waiting.user?.display_name || waiting.ingame_name })
      .getByRole("button", { name: "Check-in" }).click();
    await expect.poll(async () => {
      const after = await (await page.request.get(`/api/tournaments/${members}/registrations`)).json();
      return after.find((row) => row.id === waiting.id)?.status;
    }).toBe("checked_in");

    // 3. Foto vom QR-Code geht herum: die Turnierleitung macht einen neuen Code - der alte gilt nicht mehr.
    const panel = page.getByTestId("onsite-access-panel");
    // Am PC ohne die leere rechte Hälfte des Kastens.
    await bilder(page, "c3-neuer-code", (mode) => (mode === "pc"
      ? [panel.locator("h3"), panel.locator("p").first(), page.getByTestId("onsite-access-poster")]
      : panel));
    await page.getByTestId("onsite-access-renew").click();
    await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: "Neuer Code" }).click();
    await expect.poll(async () => (await accessOf()).path.split("#")[1]).not.toBe(token);
    expect(problems).toEqual([]);
  });
});
