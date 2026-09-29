const { test, expect } = require("@playwright/test");
const { activePayload, mockSeason } = require("./seasonQa");

// Adventkalender (#641, #732): die Seite /advent mit 24 Türchen. Geprüft wird im Browser, was kein Unit-Test sieht:
// 6, 4 oder 3 Spalten ohne Überlauf, kein Flügel schlägt über den Rahmen, das Bild geht über die Türchen weiter,
// ein Klick öffnet und zeigt danach den Inhalt, Gäste merken sich ihre Türchen, „Bewegung reduzieren“ bleibt still.
// Server und Konto sind Attrappen im Browser.

const STORAGE = "tls-advent-opened";
const USER = { id: "u-anna", email: "anna@example.test", display_name: "Anna", username: "anna", role: "user", seasonal_decorations: "on" };
const ORDER = [8, 22, 9, 14, 5, 13, 17, 12, 2, 18, 6, 16, 19, 7, 10, 3, 24, 23, 11, 15, 21, 4, 1, 20];
const SEASON = { key: "advent_calendar", label: "Adventkalender", phase: "tuerchen", intensity: "normal", channels: ["web", "app"], texts: {}, data: { today_door: 12, catch_up: false, door_hour: 6, ready: true }, starts_at: "2026-12-01T00:00:00+01:00", ends_at: "2027-01-06T23:59:59+01:00", forced: false };
const TERMS = ["Mitmachen kann, wer ein Konto hat. Vorstand und Verwaltung machen nicht mit.", "Gezogen wird per Zufall; jede Person hat ein Los. Es gewinnen 2 Personen."];
const PRIZE = { label: "TLS-Hoodie", value: "Größe nach Wahl", winners: 2, audience: "all", closes_at: "2026-12-13T20:00:00+01:00", status: "open", entries: 37, entered: false, can_enter: true, can_withdraw: false, won: false, hint: null, terms: TERMS };
const CONTENT = {
  1: { kind: "text", title: "Willkommen im Advent", body: "Schön, dass du da bist.", media_url: null, link: { url: "/news", label: "Zu den News" } },
  2: { kind: "quiz", title: "Kranz-Quiz", body: "", media_url: null, link: null, quiz: { question: "Wie viele Kerzen hat der Adventkranz?", answers: ["Drei", "Vier", "Fünf"], done: false } },
  12: { kind: "prize", title: "Heute gibt es etwas zu gewinnen", body: "Mach mit!", media_url: null, link: null, prize: PRIZE },
};

function seed(day) {
  let hash = 2166136261;
  for (const ch of `advent:2026:${day}`) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function contentFor(day) {
  return CONTENT[day] || { kind: "text", title: `Türchen ${day}`, body: "Der Löwe wünscht dir einen schönen Adventtag.", media_url: null, link: null, fallback: true };
}

function calendar(opened, today = 12) {
  const doors = [];
  for (let day = 1; day <= 24; day += 1) {
    const state = day > today ? "locked" : opened.includes(day) ? "opened" : "available";
    doors.push({ day, opens_at: `2026-12-${String(day).padStart(2, "0")}T06:00:00+01:00`, seed: seed(day), state, ...(state === "opened" ? { content: contentFor(day) } : {}) });
  }
  return { active: true, year: 2026, now: "2026-12-12T10:00:00+01:00", ends_at: "2027-01-06T23:59:59+01:00", catch_up: today > 24, newest_door: Math.min(24, today), door_hour: 6, order: ORDER, doors, total: 24 };
}

/** Der Kalender als Attrappe: `state` hält, was der „Server“ weiß, und schreibt mit, was gefragt wurde. */
async function mockCalendar(page, state) {
  await mockSeason(page, activePayload({ season: SEASON, now: "2026-12-12T10:00:00+01:00" }));
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/auth/me", (route) => json(route, state.user));
  await page.route("**/api/seasonal/me", (route) => json(route, { scares_allowed: false }));
  await page.route("**/api/achievements/me", (route) => json(route, { groups: [], pinned: [], pinned_codes: [], awards: [], level: { level: 1, title: "Neuling", xp: 0, next_xp: 100 } }));
  await page.route(/\/api\/seasonal\/advent(\?.*)?$/, (route) => {
    const asked = new URL(route.request().url()).searchParams.get("opened");
    state.asked.push(asked);
    if (state.closed) return json(route, state.closed);
    const guest = (asked || "").split(",").map(Number).filter((day) => day >= 1 && day <= 12);
    const opened = state.user ? state.account : guest;
    return json(route, { ...calendar(opened), signed_in: Boolean(state.user), opened: opened.length });
  });
  await page.route(/\/api\/seasonal\/advent\/\d+\/open$/, async (route) => {
    const day = Number(route.request().url().match(/advent\/(\d+)\/open/)[1]);
    state.opens.push(day);
    if (day > 12) return json(route, { detail: `Dieses Türchen öffnet sich am ${day}. Dezember um 6 Uhr.` }, 409);
    const first = Boolean(state.user) && !state.account.includes(day);
    if (first) state.account.push(day);
    return json(route, { day, year: 2026, state: "opened", seed: seed(day), content: contentFor(day), counted: Boolean(state.user), first, opened: state.user ? state.account.length : null, total: 24, newly_awarded: 0, opened_at: "2026-12-12T09:00:00+00:00" });
  });
  await page.route(/\/api\/seasonal\/advent\/\d+\/quiz$/, (route) => {
    const answer = route.request().postDataJSON().answer;
    state.answers.push(answer);
    return json(route, { day: 2, correct: answer === 1, correct_index: 1, correct_answer: "Vier", explanation: "Eine je Adventsonntag.", done: true });
  });
  await page.route(/\/api\/seasonal\/advent\/\d+\/enter$/, (route) => {
    const join = route.request().method() === "POST";
    state.raffle.push(route.request().method());
    return json(route, { day: 12, prize: { ...PRIZE, entered: join, entries: join ? 38 : 37, can_enter: !join, can_withdraw: join, hint: join ? "Du bist dabei. Viel Glück!" : null } });
  });
}

function fresh(overrides = {}) {
  return { user: null, account: [], asked: [], opens: [], answers: [], raffle: [], closed: null, ...overrides };
}

async function openPage(page) {
  await page.goto("/advent");
  await expect(page.getByTestId("advent-board")).toBeVisible({ timeout: 20000 });
  await page.waitForLoadState("networkidle");
}

/** Wie weit ein Teil über den Rahmen des Kalenders hinausragt (in px) - 0 heißt: alles innen. */
async function outside(page, selector) {
  return page.evaluate((query) => {
    const frame = document.querySelector("[data-testid='advent-frame']").getBoundingClientRect();
    return [...document.querySelectorAll(query)].map((node) => {
      const rect = node.getBoundingClientRect();
      const over = Math.max(frame.left - rect.left, rect.right - frame.right, frame.top - rect.top, rect.bottom - frame.bottom, 0);
      return { day: node.closest("[data-day]")?.dataset.day, over: Math.round(over * 10) / 10 };
    }).filter((entry) => entry.over > 1);
  }, selector);
}

test.describe("Adventkalender", () => {
  test("Gast: 24 Türchen ohne Überlauf, das heutige öffnet sich, der Browser merkt es sich", async ({ page, isMobile }, testInfo) => {
    const state = fresh();
    await mockCalendar(page, state);
    await openPage(page);

    const board = page.getByTestId("advent-board");
    await expect(board.locator("[data-day]")).toHaveCount(24);
    await expect(board).toHaveAttribute("data-columns", isMobile ? "3" : "6");
    expect(await board.locator("[data-day]").evaluateAll((cells) => cells.map((cell) => Number(cell.dataset.day)))).toEqual(ORDER);
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
    expect(overflow, "kein horizontales Scrollen").toBeLessThanOrEqual(2);
    expect(await outside(page, ".tls-adv__cell"), "jedes Türchen liegt im Rahmen").toEqual([]);

    // Das Bild geht über die Türchen weiter: der Flügel zeigt dieselbe Grafik, verschoben um seine Lage im Brett.
    const picture = await page.evaluate(() => {
      const boardNode = document.querySelector("[data-testid='advent-board']");
      const boardBox = boardNode.getBoundingClientRect();
      const boardStyle = getComputedStyle(boardNode);
      const cell = document.querySelector("[data-testid='advent-door-10']");
      const face = cell.querySelector(".tls-adv__face--front");
      const faceBox = face.getBoundingClientRect();
      const style = getComputedStyle(face);
      const [x, y] = style.backgroundPosition.split(" ").map(parseFloat);
      return { same: style.backgroundImage === boardStyle.backgroundImage, size: style.backgroundSize === boardStyle.backgroundSize, dx: Math.abs(-x - (faceBox.left - boardBox.left)), dy: Math.abs(-y - (faceBox.top - boardBox.top)), image: style.backgroundImage.slice(0, 24) };
    });
    expect(picture.image).toBe('url("data:image/svg+xml,');
    expect(picture.same && picture.size, "Flügel und Brett tragen dasselbe Bild in derselben Größe").toBe(true);
    expect(picture.dx, "das Bild sitzt waagrecht auf den Pixel").toBeLessThanOrEqual(1);
    expect(picture.dy, "das Bild sitzt senkrecht auf den Pixel").toBeLessThanOrEqual(1);

    await expect(page.getByTestId("advent-progress")).toContainText("0 von 24");
    await expect(page.getByTestId("advent-guest")).toBeVisible();
    await expect(page.getByTestId("advent-door-12")).toHaveAttribute("data-today", "1");
    await testInfo.attach(`adventkalender-${isMobile ? "handy" : "pc"}`, { body: await page.getByTestId("advent-frame").screenshot(), contentType: "image/png" });

    // Verschlossen: es rüttelt, die Seite sagt, wann es so weit ist - gefragt wird der Server nicht.
    await page.getByTestId("advent-door-button-20").click();
    await expect(page.getByTestId("advent-note")).toHaveText("Türchen 20 öffnet sich am 20. Dezember, 6 Uhr.");
    expect(state.opens).toEqual([]);

    // Das heutige Türchen: öffnen, der Flügel schwingt auf, danach erscheint der Inhalt.
    await page.getByTestId("advent-door-button-12").click();
    await expect(page.getByTestId("advent-door-12")).toHaveAttribute("data-state", "opened");
    await expect(page.getByRole("dialog", { name: "Heute gibt es etwas zu gewinnen" })).toBeVisible();
    await expect(page.getByTestId("advent-prize-login")).toBeVisible();
    await expect(page.getByTestId("advent-prize-enter")).toHaveCount(1);
    // Auch während es erscheint, bleibt das Fenster in der Seite.
    const dialog = await page.getByTestId("advent-dialog").boundingBox();
    const viewport = page.viewportSize();
    expect(dialog.x).toBeGreaterThanOrEqual(0);
    expect(dialog.x + dialog.width, "das Fenster passt in die Breite").toBeLessThanOrEqual(viewport.width + 1);
    expect(dialog.height, "das Fenster passt in die Höhe").toBeLessThanOrEqual(viewport.height);
    await page.getByTestId("advent-dialog-close").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("advent-progress")).toContainText("1 von 24");
    expect(state.opens).toEqual([12]);
    expect(await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key)), STORAGE)).toEqual({ year: 2026, days: [12] });
    expect(await outside(page, "[data-state='opened'] .tls-adv__leaf"), "kein offener Flügel ragt über den Rahmen").toEqual([]);

    // Nach dem Neuladen nennt der Browser dem Server, was er geöffnet hat - und bekommt den Inhalt wieder.
    await page.reload();
    await expect(page.getByTestId("advent-door-12")).toHaveAttribute("data-state", "opened", { timeout: 20000 });
    expect(state.asked[state.asked.length - 1]).toBe("12");
    await expect(page.getByTestId("advent-door-12")).toContainText("Heute gibt es etwas zu gewinnen");
    expect(state.opens, "das Neuladen öffnet nichts noch einmal").toEqual([12]);
  });

  test("angemeldet: Quiz mit Auflösung, Verlosung mit eigenem Klick", async ({ page, isMobile }, testInfo) => {
    const state = fresh({ user: USER, account: [1, 2, 12] });
    await mockCalendar(page, state);
    await openPage(page);
    await expect(page.getByTestId("advent-progress")).toContainText("Gesammelt");
    await expect(page.getByTestId("advent-progress")).toContainText("3 von 24");
    await expect(page.getByTestId("advent-guest")).toHaveCount(0);

    await page.getByTestId("advent-door-button-2").click();
    const quiz = page.getByTestId("advent-quiz");
    await expect(quiz).toContainText("Wie viele Kerzen hat der Adventkranz?");
    await expect(page.getByTestId("advent-quiz-result")).toHaveCount(0);
    await page.getByTestId("advent-quiz-answer-0").click();
    await expect(page.getByTestId("advent-quiz-result")).toHaveText("Leider nein – richtig ist „Vier“. Eine je Adventsonntag.");
    await expect(page.getByTestId("advent-quiz-answer-1")).toHaveAttribute("data-result", "right");
    await expect(page.getByTestId("advent-quiz-answer-0")).toBeDisabled();
    expect(state.answers).toEqual([0]);
    await page.getByTestId("advent-dialog-close").click();

    await page.getByTestId("advent-door-button-12").click();
    await expect(page.getByTestId("advent-prize")).toContainText("TLS-Hoodie");
    await expect(page.getByTestId("advent-prize-entries")).toHaveText("37 Personen machen mit");
    expect(state.raffle, "öffnen allein ist keine Teilnahme").toEqual([]);
    await page.getByTestId("advent-prize-enter").click();
    await expect(page.getByTestId("advent-prize-hint")).toHaveText("Du bist dabei. Viel Glück!");
    await expect(page.getByTestId("advent-prize-entries")).toHaveText("38 Personen machen mit");
    await page.getByTestId("advent-prize-terms").locator("summary").click();
    await expect(page.getByTestId("advent-prize-terms").locator("li")).toHaveText(TERMS);
    await testInfo.attach(`adventkalender-gewinn-${isMobile ? "handy" : "pc"}`, { body: await page.getByTestId("advent-dialog").screenshot(), contentType: "image/png" });
    await page.getByTestId("advent-prize-withdraw").click();
    await expect(page.getByTestId("advent-prize-enter")).toBeVisible();
    expect(state.raffle).toEqual(["POST", "DELETE"]);
    expect(state.opens, "geöffnete Türchen fragen den Server nicht noch einmal").toEqual([]);
  });

  test("nach dem Anmelden werden die Türchen des Gastes für das Konto nachgeholt", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "PC");
    const state = fresh({ user: USER, account: [2] });
    await mockCalendar(page, state);
    await page.addInitScript(([key, value]) => {
      if (!window.sessionStorage.getItem("advent-probe")) {
        window.localStorage.setItem(key, value);
        window.sessionStorage.setItem("advent-probe", "1");
      }
    }, [STORAGE, JSON.stringify({ year: 2026, days: [1, 2, 5] })]);
    await openPage(page);
    await expect.poll(() => state.opens, { timeout: 15000 }).toEqual([1, 5]);
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), STORAGE)).toBeNull();
    await expect(page.getByTestId("advent-progress")).toContainText("3 von 24");
    expect(state.asked.every((asked) => asked === null), "angemeldet nennt der Browser keine gemerkten Türchen").toBe(true);
  });

  test("„Bewegung reduzieren“: nichts schwingt, der Inhalt erscheint sofort", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "PC");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const state = fresh({ user: USER, account: [1] });
    await mockCalendar(page, state);
    await openPage(page);
    const still = await page.evaluate(() => {
      const leaf = getComputedStyle(document.querySelector("[data-testid='advent-door-11'] .tls-adv__leaf"));
      const glow = getComputedStyle(document.querySelector("[data-testid='advent-door-11'] .tls-adv__door"), "::before");
      return { transition: parseFloat(leaf.transitionDuration), animation: glow.animationName };
    });
    expect(still.transition, "der Flügel schwingt nicht (höchstens ein Wimpernschlag)").toBeLessThan(0.01);
    expect(still.animation, "das Licht atmet nicht").toBe("none");
    const before = Date.now();
    await page.getByTestId("advent-door-button-11").click();
    await expect(page.getByRole("dialog", { name: "Türchen 11" })).toBeVisible();
    expect(Date.now() - before, "ohne Warten auf den Flügel").toBeLessThan(700);
  });

  test("der Einstieg neben dem Logo führt zum Kalender", async ({ page }) => {
    const state = fresh();
    await mockCalendar(page, state);
    await page.goto("/");
    const widget = page.getByTestId("advent-calendar-widget");
    await expect(widget).toBeVisible({ timeout: 20000 });
    await expect(widget).toHaveAttribute("aria-label", "Adventkalender – Türchen 12 ist offen");
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
    expect(overflow, "die Kopfzeile bleibt in der Breite").toBeLessThanOrEqual(2);
    await widget.click();
    await expect(page).toHaveURL(/\/advent$/);
    await expect(page.getByTestId("advent-board")).toBeVisible({ timeout: 20000 });
  });

  test("vor dem Advent ist der Kalender zu", async ({ page }, testInfo) => {
    const state = fresh({ closed: { active: false, next_start: "2026-12-01T00:00:00+01:00" } });
    await mockCalendar(page, state);
    await page.goto("/advent");
    await expect(page.getByTestId("advent-closed")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("advent-closed-text")).toContainText("Das erste Türchen geht am 1. Dezember, 6 Uhr auf.");
    await expect(page.getByTestId("advent-board")).toHaveCount(0);
    await expect(page.getByTestId("advent-progress")).toHaveCount(0);
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
    await testInfo.attach("adventkalender-zu", { body: await page.getByTestId("advent-closed").screenshot(), contentType: "image/png" });
  });
});
