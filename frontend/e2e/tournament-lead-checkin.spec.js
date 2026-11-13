const { test, expect } = require("@playwright/test");

// Check-in vor Ort durch die Turnierleitung (#1161): bei 390 px mit einem Tipp abhaken - der Zähler stimmt sofort, noch
// bevor der Server antwortet; „Rückgängig“ und „Nicht erschienen“ ebenso. Bei 1440 px ein Team-Turnier mit zehn
// Mitgliedern. Die API ist nachgestellt, die Namen sind erfunden. Bilder: E2E_SHOTS=<Ordner> legt sie dort ab.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const shotDir = process.env.E2E_SHOTS || "";

const solo = (id, name, extra = {}) => ({ id, name, ingame_name: "", team_tag: "", member_count: 0, seed: null, status: "approved", checked_in: false, kind: "solo", fee: null, onsite: false, ...extra });
const SOLO = {
  applies: true, team_mode: false,
  tournament: { id: "t1", slug: "lan-cup", title: "LAN-Cup", event_mode: "local", team_mode: "solo", self_checkin: false },
  rows: [
    solo("r1", "Anton Aigner", { status: "checked_in", checked_in: true, checked_in_at: "2026-11-14T17:02:00+00:00" }),
    solo("r2", "Berta Brunner", { ingame_name: "B3rta", fee: "open" }),
    solo("r3", "Aleksandra Wiśniewska-Kowalczyk von der Löwen-eSports-Akademie", { fee: "open", onsite: true }),
    solo("r4", "Carl Czerny", { status: "checked_in", checked_in: true, checked_in_at: "2026-11-14T17:06:00+00:00" }),
    solo("r5", "Dora Dimitrova"),
    solo("r6", "Emil Ebner", { status: "pending" }),
  ],
};

const member = (index, extra = {}) => ({ id: `u${index}`, name: `Spieler ${index + 1}`, role: "member", leader: index === 0, present: false, ...extra });
const TEAM = {
  applies: true, team_mode: true,
  tournament: { id: "t2", slug: "team-cup", title: "Team-Cup Winter", event_mode: "hybrid", team_mode: "team", self_checkin: true },
  rows: [
    {
      id: "lsw", name: "Löwen eSports Akademie Wien-Floridsdorf", team_tag: "LSW", kind: "team", status: "approved", checked_in: false,
      fee: "open", lineup_set: false, members_present: 3, seed: null, ingame_name: "",
      members: Array.from({ length: 10 }, (_, index) => member(index, { name: index === 6 ? "Maximilian-Alexander von Hohenzollern" : `Spieler ${index + 1}`, present: [0, 2, 5].includes(index) })),
    },
    {
      id: "flk", name: "Falken", team_tag: "FLK", kind: "team", status: "checked_in", checked_in: true, checked_in_at: "2026-11-14T16:58:00+00:00",
      fee: "paid", lineup_set: true, members_present: 2, seed: null, ingame_name: "",
      members: [
        { id: "a", name: "Ada", role: "starter", leader: true, present: true },
        { id: "b", name: "Bo", role: "starter", leader: false, present: true },
        { id: "c", name: "Cy", role: "substitute", leader: false, present: false },
      ],
    },
    {
      id: "wlf", name: "Wölfe", team_tag: "WLF", kind: "team", status: "approved", checked_in: false, fee: null, lineup_set: false, members_present: 0, seed: null, ingame_name: "",
      members: [member(20, { name: "Wanda" }), member(21, { name: "Willi" }), member(22, { name: "Wolfgang" })],
    },
  ],
};

async function serve(page, slug, board, posts, hold) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill(json({ id: "s1", username: "einlass", display_name: "Einlass", role: "user" }));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === `/api/tournaments/${slug}/lead`) {
      return route.fulfill(json({ tournament: { ...board.tournament, status: "check_in", can_check_in: true }, matches: [], recent: [], attention: [], stations: [], counts: {} }));
    }
    if (path === `/api/tournaments/${slug}/lead/checkin`) return route.fulfill(json(board));
    if (path === `/api/tournaments/${slug}/live-queue`) return route.fulfill(json({ applies: false }));
    if (request.method() === "POST" && path.endsWith("/checkin")) {
      const body = request.postDataJSON();
      posts.push({ path, body });
      if (hold) await hold.promise;
      // Wie der Server: der neue Stand gilt auch für das nächste Nachladen der Liste.
      const row = board.rows.find((item) => item.id === path.split("/").at(-2));
      if (row) Object.assign(row, { status: body.status, checked_in: body.status === "checked_in", checked_in_at: body.status === "checked_in" ? "2026-11-14T17:12:00+00:00" : null });
      return route.fulfill(json({ id: path.split("/").at(-2), status: body.status, checked_in_at: body.status === "checked_in" ? "2026-11-14T17:12:00+00:00" : null, waitlist_moved_up: [], placement: null }));
    }
    return route.fulfill(json([]));
  });
}

// Für das Bild: Meldungen abwarten, keinen Fokus-Rahmen, oben am Reiter beginnen - nur der sichtbare Ausschnitt.
async function calm(page) {
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => document.activeElement?.blur());
  await page.getByTestId("lead-page").evaluate((node) => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 70));
  await page.waitForTimeout(700);
  return {};
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test.describe("Check-in der Turnierleitung", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  test("am Handy mit einem Tipp abhaken - der Zähler stimmt sofort", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const posts = [];
    const hold = deferred();
    await serve(page, "lan-cup", structuredClone(SOLO), posts, hold);
    await page.goto("/tournaments/lan-cup/leitung");

    // Im Status „Check-in“ öffnet die Seite gleich im Reiter.
    await expect(page.getByTestId("lead-tab-checkin")).toHaveAttribute("aria-selected", "true");
    const counter = page.getByTestId("lead-checkin-counter");
    await expect(counter).toContainText("2 von 6 da");
    await expect(page.getByTestId("lead-checkin-fee-r2")).toHaveText("Startgeld offen");

    // Große Tippflächen: „Da“ mindestens 48 px hoch.
    const here = page.getByTestId("lead-checkin-here-r5");
    expect((await here.boundingBox()).height).toBeGreaterThanOrEqual(48);
    await here.click();
    // Der Server hat noch nicht geantwortet - der Zähler steht trotzdem schon.
    await expect(counter).toContainText("3 von 6 da");
    await expect(page.getByTestId("lead-checkin-row-r5")).toHaveAttribute("data-status", "checked_in");
    await expect(page.locator("[data-testid='lead-checkin-mark-r5'] path.tls-lead-check-draw")).toHaveCount(1);
    hold.resolve();
    await expect(page.getByTestId("lead-checkin-row-r5")).toContainText("Da · 18:12");
    expect(posts[0]).toEqual({ path: "/api/tournaments/t1/registrations/r5/checkin", body: { status: "checked_in" } });

    await page.getByTestId("lead-checkin-search").fill("wisniewska");
    await expect(page.locator("[data-testid^='lead-checkin-row-']")).toHaveCount(1);
    await page.getByTestId("lead-checkin-search").fill("");

    await page.getByTestId("lead-checkin-here-r2").click();
    await expect(counter).toContainText("4 von 6 da");
    await page.getByTestId("lead-checkin-undo-r2").click();
    await expect(counter).toContainText("3 von 6 da");
    await page.getByTestId("lead-checkin-noshow-r6").click();
    await expect(page.getByTestId("lead-checkin-summary")).toContainText("1 nicht erschienen");
    expect(posts.map((post) => post.body.status)).toEqual(["checked_in", "checked_in", "approved", "no_show"]);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.getByTestId("lead-checkin-here-r3").click();
    await expect(counter).toContainText("4 von 6 da");
    if (shotDir) await page.screenshot({ ...(await calm(page)), path: `${shotDir}/1161-checkin-390.png` });
  });

  test("am PC: Team-Turnier mit zehn Mitgliedern, Aufstellung und Startgeld", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const posts = [];
    await serve(page, "team-cup", structuredClone(TEAM), posts, null);
    await page.goto("/tournaments/team-cup/leitung");
    await expect(page.getByTestId("lead-checkin-counter")).toContainText("1 von 3 da");
    const lions = page.getByTestId("lead-checkin-members-lsw");
    await expect(lions).toContainText("Keine Aufstellung – ganzes Team · 3 von 10 sagen „Ich bin da“");
    await expect(lions).toContainText("Maximilian-Alexander von Hohenzollern");
    await expect(page.getByTestId("lead-checkin-members-flk")).toContainText("Spielt");
    await expect(page.getByTestId("lead-checkin-members-flk")).toContainText("Ersatz");
    await page.getByTestId("lead-checkin-search").fill("wolfgang");
    await expect(page.locator("[data-testid^='lead-checkin-row-']")).toHaveCount(1);
    await page.getByTestId("lead-checkin-search").fill("");
    await page.getByTestId("lead-checkin-here-lsw").click();
    await expect(page.getByTestId("lead-checkin-counter")).toContainText("2 von 3 da");
    expect(posts[0]).toEqual({ path: "/api/tournaments/t2/registrations/lsw/checkin", body: { status: "checked_in" } });
    if (shotDir) await page.screenshot({ ...(await calm(page)), path: `${shotDir}/1161-checkin-1440.png` });
  });
});
