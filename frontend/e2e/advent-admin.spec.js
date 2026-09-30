const { test, expect } = require("@playwright/test");

// Adventkalender pflegen (#641): die Seite /admin/advent im Browser - 24 Tage ohne Überlauf, ein Türchen anlegen
// (das Formular sagt in eigenen Worten, was fehlt), die Vorschau zeigt den Kalender zu einem gewählten Tag, die
// Ziehung fragt vorher nach. Server und Konto sind Attrappen im Browser.

const ADMIN = { id: "admin-1", email: "admin@example.test", display_name: "Vorstand", username: "vorstand", role: "superadmin", is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true };
const KINDS = [["text", "Text"], ["image", "Bild"], ["video", "Video"], ["clip", "Twitch-Clip"], ["news", "News-Beitrag"], ["event", "Event"], ["member_spotlight", "Mitglied der Woche"], ["sticker", "Sticker"], ["quiz", "Quiz"], ["prize", "Gewinn"]].map(([key, label]) => ({ key, label }));
const ORDER = [8, 22, 9, 14, 5, 13, 17, 12, 2, 18, 6, 16, 19, 7, 10, 3, 24, 23, 11, 15, 21, 4, 1, 20];
const RAFFLE = { id: "r12", label: "TLS-Hoodie", value: "Größe nach Wahl", winners: 2, audience: "all", staff_may_enter: false, closes_at: "2026-12-13T20:00:00+01:00", status: "open", entries: 37, can_draw: true, needs_close_early: true, terms: [], protocol: [] };

function adminView(state) {
  const doors = [];
  for (let day = 1; day <= 24; day += 1) {
    const door = state.doors[day] ? { id: `d${day}`, year: 2026, day, copied_from: null, ...state.doors[day] } : null;
    doors.push({ day, opens_at: `2026-12-${String(day).padStart(2, "0")}T06:00:00+01:00`, is_open: day <= 12, seed: day * 97 + 3, door, problem: door ? null : "Noch nichts eingetragen – an diesem Tag grüßt nur der Löwe.", stats: { opened: 0, same_day: 0, later: 0, views: 0, quiz_done: 0 }, raffle: door?.kind === "prize" ? (state.drawn ? { ...RAFFLE, status: "drawn", can_draw: false, needs_close_early: false, protocol: [{ id: "z1", kind: "draw", drawn_at: "2026-12-12T09:05:00+00:00", drawn_by: "Vorstand", entries: 37, eligible: 37, method: "Zufallsziehung, jede Person ein Los", closed_early: true, replaces: null, winners: [{ user_id: "u1", name: "Anna Beispiel", pickup_id: "k1", pickup_status: "pending", replaced: false, can_redraw: false }] }] } : RAFFLE) : null });
  }
  return { year: 2026, kinds: KINDS, door_hour: 6, order: ORDER, doors, filled: Object.keys(state.doors).length, total: 24, years: [2026], people: 12, running: true };
}

function previewView(state, at) {
  const today = Number(String(at).slice(5, 7)) === 12 ? Math.min(30, Number(String(at).slice(8, 10))) : 24;
  const doors = [];
  for (let day = 1; day <= 24; day += 1) {
    const open = day <= today;
    const stored = state.doors[day];
    doors.push({ day, opens_at: `2026-12-${String(day).padStart(2, "0")}T06:00:00+01:00`, seed: day * 97 + 3, state: open ? "opened" : "locked", ...(open ? { content: { kind: "text", title: stored?.title || `Türchen ${day}`, body: stored?.body || "Der Löwe wünscht dir einen schönen Adventtag.", media_url: null, link: null } } : {}) });
  }
  return { active: true, year: 2026, order: ORDER, doors, catch_up: today > 24, newest_door: Math.min(24, today), door_hour: 6, signed_in: false, opened: Math.min(24, today), total: 24, preview: true };
}

async function mockAdmin(page, state) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.clock.install({ time: new Date("2026-12-12T10:00:00+01:00") });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const door = pathname.match(/\/seasonal\/advent\/admin\/2026\/(\d+)$/);
    if (door && request.method() === "PUT") {
      const body = request.postDataJSON();
      state.saved.push({ day: Number(door[1]), body });
      state.doors[Number(door[1])] = { ...body, prize: body.prize ? { prize_label: body.prize.label, prize_value: body.prize.value, winners: body.prize.winners, audience: body.prize.audience, closes_at: "2026-12-13T20:00:00+01:00", staff_may_enter: false } : null, raffle_id: body.prize ? "r12" : null };
      return json({ id: `d${door[1]}`, ...state.doors[Number(door[1])] });
    }
    if (/\/seasonal\/advent\/admin\/2026\/\d+\/draw$/.test(pathname) && request.method() === "POST") {
      state.draws.push(request.postDataJSON());
      state.drawn = true;
      return json({ ...RAFFLE, status: "drawn", protocol: [{ id: "z1", entries: 37, eligible: 37, winners: [{}], closed_early: true }] });
    }
    if (request.method() !== "GET") return json({}, 405);
    if (pathname.endsWith("/api/auth/me")) return json(ADMIN);
    if (pathname.endsWith("/seasonal/advent/admin/options")) return json({ news: [], events: [], members: [], stickers: [], audiences: [{ key: "all", label: "alle mit Konto" }, { key: "members", label: "nur Vereinsmitglieder" }], max_winners: 20 });
    if (/\/seasonal\/advent\/admin\/\d+\/preview$/.test(pathname)) return json(previewView(state, url.searchParams.get("at")));
    if (/\/seasonal\/advent\/admin\/\d+$/.test(pathname)) return json(adminView(state));
    if (pathname.includes("/seasonal/active")) return json({ now: "2026-12-12T10:00:00+01:00", enabled: true, preview: false, weather: null, seasons: [] });
    if (pathname.includes("/settings/public")) return json({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at" });
    const list = /notifications|games$|achievements\/(groups|tiers)|teams|platform-links|sponsors|partners|site-banners|nav$|media/.test(pathname);
    return json(list ? [] : {});
  });
}

test.describe("Adventkalender pflegen", () => {
  test("anlegen, Vorschau und Ziehung", async ({ page, isMobile }, testInfo) => {
    const state = { doors: { 1: { kind: "text", title: "Willkommen im Advent", body: "Schön, dass du da bist." } }, saved: [], draws: [], drawn: false };
    await mockAdmin(page, state);
    await page.goto("/admin/advent");
    await expect(page.getByTestId("advent-admin-days")).toBeVisible({ timeout: 25000 });
    await expect(page.locator("[data-testid^='advent-admin-day-']")).toHaveCount(24);
    await expect(page.getByTestId("advent-admin-filled")).toContainText("1 von 24");
    const overflow = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
    expect(await overflow(), "kein horizontales Scrollen in der Liste").toBeLessThanOrEqual(2);

    // Anlegen: das Formular sagt in eigenen Worten, was fehlt - und schickt danach genau die Felder des Gewinns.
    await page.getByTestId("advent-admin-edit-12").click();
    await expect(page.getByRole("dialog", { name: "Türchen 12" })).toBeVisible();
    await page.getByTestId("advent-editor-kind-prize").click();
    await page.getByTestId("advent-editor-save").click();
    await expect(page.getByTestId("advent-editor-problem")).toHaveText("Das Türchen braucht einen Titel.");
    await page.getByTestId("advent-editor-title").fill("Heute gibt es etwas zu gewinnen");
    await page.getByTestId("advent-editor-body").fill("Mach mit!");
    await page.getByTestId("advent-editor-save").click();
    await expect(page.getByTestId("advent-editor-problem")).toHaveText("Der Gewinn braucht einen Namen.");
    await page.getByTestId("advent-editor-prize-label").fill("TLS-Hoodie");
    await page.getByTestId("advent-editor-prize-winners").fill("2");
    await expect(page.getByTestId("advent-editor-preview").getByTestId("advent-prize")).toContainText("TLS-Hoodie");
    expect(await overflow(), "kein horizontales Scrollen im Formular").toBeLessThanOrEqual(2);
    await testInfo.attach(`advent-pflege-formular-${isMobile ? "handy" : "pc"}`, { body: await page.screenshot(), contentType: "image/png" });
    await page.getByTestId("advent-editor-save").click();
    await expect(page.getByTestId("advent-editor")).toHaveCount(0);
    expect(state.saved).toEqual([{ day: 12, body: { kind: "prize", title: "Heute gibt es etwas zu gewinnen", body: "Mach mit!", prize: { label: "TLS-Hoodie", value: "", winners: 2, audience: "all", staff_may_enter: false } } }]);
    await expect(page.getByTestId("advent-admin-title-12")).toHaveText("Heute gibt es etwas zu gewinnen");
    await expect(page.getByTestId("advent-admin-filled")).toContainText("2 von 24");

    // Vorschau: heute ist der 12. - zwölf Türchen offen, zwölf verschlossen; ein anderer Tag lädt neu.
    await page.getByTestId("advent-admin-preview").click();
    await expect(page.getByTestId("advent-board")).toBeVisible();
    await expect(page.getByTestId("advent-preview-moment")).toHaveValue("2026-12-12T09:00:00");
    await expect(page.locator("[data-testid='advent-preview'] [data-state='opened']")).toHaveCount(12);
    await expect(page.getByTestId("advent-board")).toHaveAttribute("data-columns", isMobile ? "3" : "6");
    await page.getByTestId("advent-preview-moment").selectOption("2026-12-24T09:00:00");
    await expect(page.locator("[data-testid='advent-preview'] [data-state='opened']")).toHaveCount(24);
    await page.getByTestId("advent-door-button-12").click();
    await expect(page.getByRole("dialog", { name: "Heute gibt es etwas zu gewinnen" })).toBeVisible();
    await page.getByTestId("advent-dialog-close").click();
    expect(await overflow(), "kein horizontales Scrollen in der Vorschau").toBeLessThanOrEqual(2);
    await testInfo.attach(`advent-pflege-vorschau-${isMobile ? "handy" : "pc"}`, { body: await page.screenshot(), contentType: "image/png" });
    await page.getByTestId("advent-preview-close").click();
    await expect(page.getByTestId("advent-preview")).toHaveCount(0);

    // Ziehung: erst die Rückfrage, dann das Protokoll.
    await page.getByTestId("advent-raffle-draw-12").click();
    const question = page.getByRole("alertdialog").or(page.getByRole("dialog")).filter({ hasText: "Verlosung zu Türchen 12 ziehen?" });
    await expect(question).toBeVisible();
    await expect(question).toContainText("Unter 37 Teilnahmen werden 2 Gewinne gezogen.");
    expect(state.draws, "ohne Ja keine Ziehung").toEqual([]);
    await question.getByRole("button", { name: "Jetzt ziehen" }).click();
    await expect(page.getByTestId("advent-raffle-status-12")).toHaveText("Gezogen");
    expect(state.draws).toEqual([{ close_early: true }]);
    await expect(page.getByTestId("advent-raffle-record-z1")).toContainText("Anna Beispiel");
    await expect(page.getByTestId("advent-raffle-draw-12")).toHaveCount(0);
  });
});
