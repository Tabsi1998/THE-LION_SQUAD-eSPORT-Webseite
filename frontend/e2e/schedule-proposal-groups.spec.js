const { test, expect } = require("@playwright/test");

// Mehrere Termine auf einmal (#2325) bei 390 und 1440 px: drei Termine mit einer Notiz vorschlagen, die Gegenseite sieht sie als
// Liste und nimmt mit einem Klick einen an. Kein seitlicher Überlauf. Die API ist nachgestellt, die Namen sind erfunden.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const me = { id: "u1", username: "mila", display_name: "Mila Mustermann", role: "player" };
const SHOTS = process.env.SHOT_DIR || "";

function at(days, hour, minute = 0) {
  const moment = new Date();
  moment.setDate(moment.getDate() + days);
  moment.setHours(hour, minute, 0, 0);
  return moment;
}

function localInput(moment) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}T${pad(moment.getHours())}:${pad(moment.getMinutes())}`;
}

const TIMES = [at(3, 20), at(4, 19, 30), at(6, 18)];
const BASE = {
  tournament: { id: "t1", slug: "herbst-cup", title: "Herbst-Cup 2026 · Call of Duty 4v4" },
  participants: [
    { slot: 1, status: "filled", registration_id: "a", display_name: "Loewen Langername · Rudel Alpha" },
    { slot: 2, status: "filled", registration_id: "b", display_name: "Falken mit sehr langem Namen · Horst" },
  ],
  matchday_label: "Runde 2", collection: "matches_v2", can_act: true, can_report_score: false, can_player_report_result: false,
  can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: true, can_manage_schedule: true, can_dispute: false,
  can_forfeit: false, allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal",
  acting_registration_id: "a", report_state: null,
  match: { id: "m1", match_key: "R2-1", status: "ready", slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
  schedule_proposals: [],
};
const THEIRS = {
  ...BASE,
  match: { ...BASE.match, schedule_status: "proposed" },
  schedule_proposals: TIMES.map((moment, index) => ({
    id: `f${index + 1}`, status: "pending", kind: "proposal", group_id: "g-falken", actor_registration_id: "b", actor_user_id: "f1",
    scheduled_at: moment.toISOString(), note: "Unter der Woche erst ab 19 Uhr, am Wochenende flexibel.",
    created_at: new Date().toISOString(), actor: { display_name: "Falke mit Langem Namen" },
  })),
};

async function setup(page, payload, posts) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path.startsWith("/api/matches/m1/schedule-proposals")) {
      posts.push({ path, body: request.postDataJSON() });
      return route.fulfill(json({ ok: true }));
    }
    if (path === "/api/auth/me") return route.fulfill(json(me));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/matches/m1/page") return route.fulfill(json(payload));
    if (path === "/api/matches/m1/chat") return route.fulfill(json([]));
    if (path === "/api/prizes/me/open-count") return route.fulfill(json({ count: 0 }));
    return route.fulfill(json([]));
  });
}

async function expectNoSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(page, testInfo, name) {
  const box = page.getByTestId("match-scheduling");
  await box.scrollIntoViewIfNeeded();
  const body = await box.screenshot();
  await testInfo.attach(name, { body, contentType: "image/png" });
  if (SHOTS) await box.screenshot({ path: `${SHOTS}/${name}` });
}

test.describe("Terminabstimmung: mehrere Termine", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const width of [390, 1440]) {
    test(`drei Termine vorschlagen bei ${width} px`, async ({ page }, testInfo) => {
      const posts = [];
      await page.setViewportSize({ width, height: 900 });
      await setup(page, BASE, posts);
      await page.goto("/matches/m1");
      await page.getByTestId("match-proposal-at").fill(localInput(TIMES[0]));
      await page.getByTestId("match-proposal-at-weiter").click();
      await page.getByTestId("match-proposal-at-2").fill(localInput(TIMES[1]));
      await page.getByTestId("match-proposal-at-weiter").click();
      await page.getByTestId("match-proposal-at-3").fill(localInput(TIMES[2]));
      await expect(page.getByTestId("match-proposal-at-weiter")).toHaveCount(0);
      await page.getByPlaceholder("z.B. nach 20:00 Uhr möglich").fill("Unter der Woche erst ab 19 Uhr");
      await expect(page.getByRole("button", { name: "3 Termine vorschlagen" })).toBeVisible();
      await expectNoSideScroll(page);
      await shot(page, testInfo, `vorschlagen-3-termine-${width}.png`);

      await page.getByRole("button", { name: "3 Termine vorschlagen" }).click();
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0].path).toBe("/api/matches/m1/schedule-proposals/group");
      expect(posts[0].body.scheduled_ats).toEqual(TIMES.map((moment) => moment.toISOString()));
      expect(posts[0].body.note).toBe("Unter der Woche erst ab 19 Uhr");
    });

    test(`Gegenseite nimmt einen Termin an bei ${width} px`, async ({ page }, testInfo) => {
      const posts = [];
      await page.setViewportSize({ width, height: 900 });
      await setup(page, { ...THEIRS, can_propose_schedule: true }, posts);
      await page.goto("/matches/m1");
      const card = page.getByTestId("match-proposal-group-g-falken");
      await expect(card).toContainText("3 Termine zur Auswahl");
      await expect(card.getByRole("button", { name: /annehmen$/ })).toHaveCount(3);
      await expect(page.getByTestId("match-proposal-group-decline-g-falken")).toBeVisible();
      await expectNoSideScroll(page);
      await shot(page, testInfo, `gegenseite-auswahl-${width}.png`);

      await page.getByTestId("match-proposal-accept-f2").click();
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0]).toEqual({ path: "/api/matches/m1/schedule-proposals/f2/decision", body: { action: "accept", note: null } });
    });
  }
});
