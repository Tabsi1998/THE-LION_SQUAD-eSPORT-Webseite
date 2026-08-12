const { test, expect } = require("@playwright/test");

async function acceptCookies(page) {
  const button = page.getByRole("button", { name: /alle akzeptieren/i });
  if (await button.count()) await button.click();
}

async function mockPublicChrome(page) {
  await page.route("**/api/settings/public", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ club_name: "THE LION SQUAD", tagline: "eSports" }),
  }));
  await page.route("**/api/sponsors**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([]),
  }));
}

async function mockUser(page, user) {
  await page.route("**/api/auth/me", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(user),
  }));
}

async function dispatchDoubleSubmit(page, submitTestId) {
  await page.evaluate((testId) => {
    const submitter = document.querySelector(`[data-testid="${testId}"]`);
    const form = submitter?.closest("form");
    if (!form) throw new Error(`Form for ${testId} not found`);
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }, submitTestId);
}

const user = {
  id: "user-1",
  username: "testplayer",
  display_name: "Test Player",
  role: "player",
  user_type: "community_user",
};

test("event registration accepts only one simultaneous submission", async ({ page }) => {
  await mockPublicChrome(page);
  await mockUser(page, user);
  let submissions = 0;
  let ownRegistration = null;
  await page.route("**/api/events/test-event", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      id: "event-1",
      slug: "test-event",
      name: "Testevent",
      status: "registration_open",
      public_phase: { state: "registration_open", label: "Anmeldung" },
      has_registration: true,
      allow_companions: false,
      registration_summary: { registered_count: ownRegistration ? 1 : 0, reserved_seats: ownRegistration ? 1 : 0, companion_count: 0 },
      own_registration: ownRegistration,
      registrations: ownRegistration ? [ownRegistration] : [],
      tournaments: [],
      f1_challenges: [],
    }),
  }));
  await page.route("**/api/events/event-1/registrations", async (route) => {
    submissions += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    ownRegistration = { id: "event-registration-1", user_id: user.id, display_name: user.display_name, status: "registered", seat_count: 1 };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(ownRegistration) });
  });

  await page.goto("/events/test-event");
  await acceptCookies(page);
  await expect(page.getByTestId("event-register-submit")).toBeVisible();
  await dispatchDoubleSubmit(page, "event-register-submit");

  await expect(page.getByText("Angemeldet", { exact: true }).first()).toBeVisible();
  expect(submissions).toBe(1);
});

test("team join accepts only one request and exposes the resulting state", async ({ page }) => {
  await mockPublicChrome(page);
  await mockUser(page, user);
  let submissions = 0;
  let joined = false;
  await page.route("**/api/teams/team-1", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      id: "team-1",
      name: "Guardians",
      tag: "GRD",
      description: "Testteam",
      leader_id: "leader-1",
      co_leader_ids: [],
      member_ids: joined ? [user.id] : [],
      members: [],
      member_count: joined ? 1 : 0,
      is_member: joined,
      can_manage: false,
    }),
  }));
  await page.route("**/api/teams/team-1/join", async (route) => {
    submissions += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    joined = true;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/teams/team-1");
  await acceptCookies(page);
  await page.getByTestId("team-join-code").fill("JOIN123");
  await dispatchDoubleSubmit(page, "team-join-submit");

  await expect(page.getByTestId("team-leave")).toBeVisible();
  expect(submissions).toBe(1);
});

test("tournament registration accepts only one simultaneous request", async ({ page }) => {
  await mockPublicChrome(page);
  await mockUser(page, user);
  let submissions = 0;
  let registrations = [];
  const tournament = {
    id: "tournament-1",
    slug: "test-cup",
    title: "Test Cup",
    status: "registration_open",
    registration_enabled: true,
    participant_count: 0,
    max_participants: 16,
    team_mode: "solo",
    event_mode: "online",
    game: { id: "game-1", slug: "test-game", name: "Test Game", player_id_fields: [] },
    public_phase: { state: "registration_open", label: "Anmeldung" },
  };
  await page.route("**/api/tournaments/test-cup", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ...tournament, participant_count: registrations.length }),
  }));
  await page.route("**/api/tournaments/tournament-1/registrations", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(registrations),
  }));
  await page.route("**/api/teams/my", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/tournaments/tournament-1/register", async (route) => {
    submissions += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    registrations = [{ id: "registration-1", user_id: user.id, display_name: user.display_name, status: "approved" }];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(registrations[0]) });
  });

  await page.goto("/tournaments/test-cup");
  await acceptCookies(page);
  await expect(page.getByTestId("tournament-register-btn")).toBeVisible();
  await page.evaluate(() => {
    const button = document.querySelector('[data-testid="tournament-register-btn"]');
    button.click();
    button.click();
  });

  await expect(page.getByTestId("tournament-register-btn")).toHaveCount(0);
  expect(submissions).toBe(1);
});

test("match action validation and API errors remain visible without duplicate requests", async ({ page }) => {
  await mockPublicChrome(page);
  await mockUser(page, user);
  let submissions = 0;
  const matchPage = {
    collection: "matches",
    matchday_label: "Runde 1",
    match: { id: "match-1", match_key: "A1", status: "ready", schedule_status: "proposed", score_a: 0, score_b: 0 },
    tournament: { id: "tournament-1", slug: "test-cup", title: "Test Cup" },
    participants: [
      { registration_id: "registration-1", display_name: "Alpha" },
      { registration_id: "registration-2", display_name: "Bravo" },
    ],
    schedule_proposals: [],
    can_act: true,
    can_dispute: true,
    can_forfeit: false,
    can_propose_schedule: false,
    can_manage_schedule: false,
    can_player_report_result: false,
    can_staff_submit_result: false,
  };
  await page.route("**/api/matches/match-1/page", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(matchPage),
  }));
  await page.route("**/api/matches/match-1/chat", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/matches/match-1/dispute", async (route) => {
    submissions += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: "Klärfall bereits vorhanden" }) });
  });

  await page.goto("/matches/match-1");
  await acceptCookies(page);
  await dispatchDoubleSubmit(page, "match-dispute-btn");
  await expect(page.locator("#match-action-error")).toContainText("Bitte Grund angeben");
  expect(submissions).toBe(0);

  await page.getByTestId("match-dispute-input").fill("Das gemeldete Ergebnis ist falsch.");
  await dispatchDoubleSubmit(page, "match-dispute-btn");
  await expect(page.locator("#match-action-error")).toContainText("Klärfall bereits vorhanden");
  expect(submissions).toBe(1);
});

test("fast-lap entry validates input and keeps one failed request visible", async ({ page }) => {
  await mockPublicChrome(page);
  await mockUser(page, { ...user, role: "tournament_admin" });
  let submissions = 0;
  const challenge = {
    id: "challenge-1",
    slug: "test-fastlap",
    title: "Test Fast Lap",
    status: "live",
    can_manage_times: true,
    tracks: [{ id: "track-1", name: "Teststrecke", country: "AT" }],
    public_phase: { state: "live", label: "Live" },
  };
  await page.route("**/api/f1/challenges/test-fastlap", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(challenge),
  }));
  await page.route("**/api/f1/challenges/challenge-1/leaderboard**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ track: challenge.tracks[0], entries: [] }),
  }));
  await page.route("**/api/f1/challenges/challenge-1/assignable-users", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([user]),
  }));
  await page.route("**/api/f1/challenges/challenge-1/times**", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ contentType: "application/json", body: "[]" });
    }
    submissions += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: "Zeit bereits erfasst" }) });
  });

  await page.goto("/fastlap/test-fastlap");
  await acceptCookies(page);
  await page.getByTestId("fastlap-user").selectOption(user.id);
  await page.getByTestId("fastlap-time").fill("ungueltig");
  await page.getByTestId("fastlap-submit").click();
  await expect(page.locator("#fastlap-action-error")).toContainText("Ungültiges Zeitformat");
  expect(submissions).toBe(0);

  await page.getByTestId("fastlap-time").fill("1:24.587");
  await dispatchDoubleSubmit(page, "fastlap-submit");
  await expect(page.locator("#fastlap-action-error")).toContainText("Zeit bereits erfasst");
  expect(submissions).toBe(1);
});
