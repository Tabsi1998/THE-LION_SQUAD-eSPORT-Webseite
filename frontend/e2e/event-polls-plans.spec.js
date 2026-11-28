const { test, expect } = require("@playwright/test");

// Abstimmung im Event (#2612) und Plan A/B/C beim Ort (#2613), bei 390 und 1440 px:
// - Event-Seite: „Plan B aktiv“ oben, alle Pläne unter „Infos“, Abstimmungen mit Frist und Stand; abstimmen, Ergebnis nach der
//   Frist verdeckt, beendete Abstimmung mit Ergebnis.
// - Verwaltung: Abstimmung anlegen, Ort umschalten mit der Frage „Angemeldete informieren?“, Ergebnis als Ort übernehmen.
// Die API ist nachgestellt (nichts wird echt verschickt), die Uhr steht fest; Namen sind erfunden. Mit SHOT_DIR legt der Lauf
// Bildschirmfotos dort ab (nicht im Repo).

test.use({ timezoneId: "Europe/Vienna" });

const NOW = new Date("2026-12-20T09:00:00Z");
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const PLANS = [
  { key: "plan-a", label: "Plan A", letter: "A", index: 0, name: "Rodelbahn Hochegg", address: "Hocheggweg 1", postal_code: "6410", city: "Telfs", country: "Österreich",
    note: "Treffpunkt Parkplatz", address_line: "Hocheggweg 1, 6410 Telfs, Österreich", active: false },
  { key: "plan-b", label: "Plan B", letter: "B", index: 1, name: "Rodelbahn Gaisalm", address: "Gaisweg 5", postal_code: "6410", city: "Telfs", country: "Österreich",
    note: "Bei wenig Schnee – Treffpunkt Talstation", address_line: "Gaisweg 5, 6410 Telfs, Österreich", active: true },
  { key: "plan-c", label: "Plan C", letter: "C", index: 2, name: "Vereinsheim", address: "", postal_code: "6410", city: "Telfs", country: "Österreich",
    note: "Kein Schnee: wir feiern gleich drinnen", address_line: "6410 Telfs, Österreich", active: false },
];
const OPTIONS = [{ code: "o1", label: "Garage" }, { code: "o2", label: "Garten" }];
const OWN_RIGHT = { right_id: "user:u1", for: "self", name: "", state: "open", choices: [], option: "", option_label: "", can_use: true };
const PLACE_POLL = {
  id: "p-ort", question: "Welche Rodelbahn?", max_choices: 1, multiple: false, status: "open", status_label: "offen",
  options: PLANS.map((plan) => ({ code: plan.key, label: `${plan.label}: ${plan.name}` })),
  closes_at: "2026-12-28T17:00:00+00:00", closed_at: null, results_visibility: "live", voters: "registered",
  rights: [OWN_RIGHT], can_vote: true, reason: null, reason_text: "", result_hidden: false,
  result: { outcome: "winner", outcome_label: "Mehrheit", valid: 7, winner: "plan-b", winner_label: "Plan B: Rodelbahn Gaisalm",
    counts: [{ code: "plan-a", label: "Plan A: Rodelbahn Hochegg", count: 2 }, { code: "plan-b", label: "Plan B: Rodelbahn Gaisalm", count: 4 }, { code: "plan-c", label: "Plan C: Vereinsheim", count: 1 }] },
};
const PARTY_POLL = {
  id: "p-feier", question: "Danach Garage oder Garten?", max_choices: 1, multiple: false, status: "open", status_label: "offen", options: OPTIONS,
  closes_at: "2026-12-30T17:00:00+00:00", closed_at: null, results_visibility: "after_close", voters: "registered",
  rights: [OWN_RIGHT], can_vote: true, reason: null, reason_text: "", result: null, result_hidden: true,
};
const DONE_POLL = {
  id: "p-essen", question: "Gulasch oder Würstel?", max_choices: 2, multiple: true, status: "closed", status_label: "beendet",
  options: [{ code: "o1", label: "Gulasch" }, { code: "o2", label: "Würstel" }], closes_at: "2026-12-18T17:00:00+00:00", closed_at: null,
  results_visibility: "after_close", voters: "registered", rights: [{ ...OWN_RIGHT, state: "used", choices: ["o1"], option: "o1", option_label: "Gulasch", can_use: false }],
  can_vote: false, reason: null, reason_text: "", result_hidden: false,
  result: { outcome: "winner", outcome_label: "Mehrheit", valid: 9, winner: "o1", winner_label: "Gulasch",
    counts: [{ code: "o1", label: "Gulasch", count: 7 }, { code: "o2", label: "Würstel", count: 4 }] },
};
const EVENT = {
  id: "e-silvester", slug: "silvesterparty", name: "Silvesterparty 2026", status: "registration_open", visibility: "public", event_type: "general",
  start_date: "2026-12-31T16:00:00+00:00", end_date: "2027-01-01T01:00:00+00:00", show_map: false,
  location: "Rodelbahn Gaisalm", address: "Gaisweg 5", postal_code: "6410", city: "Telfs", country: "Österreich",
  locations: [{ key: "ort-1", name: "Rodelbahn Gaisalm", address_line: "Gaisweg 5, 6410 Telfs, Österreich", map_query: "Gaisweg 5, 6410 Telfs, Österreich" }],
  has_registration: true, max_participants: 30, public_phase: { state: "registration_open", label: "Anmeldung offen" },
  registration_summary: { registered_count: 12, waitlist_count: 1, reserved_seats: 12, companion_count: 0, spots_left: 18 },
  registrations: [], sponsors: [], albums: [], news: [], f1_challenges: [], partners: [], tournaments: [],
  active_place_plan: "plan-b", place_plan: { ...PLANS[1], total: 3, alternative: true }, place_plans: PLANS,
  polls: [PLACE_POLL, PARTY_POLL, DONE_POLL],
};
const OWN = { id: "r1", status: "registered", seat_count: 1, companion_count: 0, can_cancel: true };
const USER = { id: "u1", username: "testperson", display_name: "Testperson", role: "player", roles: ["player"], areas: [] };
const ADMIN = { id: "admin-1", email: "admin@example.test", display_name: "Leitung", username: "leitung", role: "tournament_admin",
  is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true };

async function consent(page) {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
}

async function mockPublic(page, votes) {
  await consent(page);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/events/silvesterparty") return route.fulfill(json({ ...EVENT, own_registration: OWN }));
    if (path === "/api/events/e-silvester/polls/p-ort/vote" && request.method() === "PUT") {
      const body = request.postDataJSON();
      votes.push(body);
      const counts = PLACE_POLL.result.counts.map((row) => (body.choices.includes(row.code) ? { ...row, count: row.count + 1 } : row));
      return route.fulfill(json({ ...PLACE_POLL, rights: [{ ...OWN_RIGHT, state: "used", choices: body.choices }], result: { ...PLACE_POLL.result, valid: 8, counts } }));
    }
    if (path === "/api/events/silvesterparty/friends") return route.fulfill(json({ sharing: true, hint: false, friends: [] }));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/auth/me") return route.fulfill(json(USER));
    return route.abort();
  });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function shot(target, name) {
  const dir = process.env.SHOT_DIR;
  if (dir) await target.screenshot({ path: `${dir}/${name}.png` });
}

for (const [label, width, height] of [["handy", 390, 844], ["pc", 1440, 900]]) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(Boolean(isMobile) && width > 768, "das Handy-Projekt prüft die Handy-Breite");
      await page.setViewportSize({ width, height });
    });

    test("Event-Seite: Plan B aktiv, Pläne unter Infos, abstimmen, verdecktes und fertiges Ergebnis", async ({ page }, testInfo) => {
      const votes = [];
      await mockPublic(page, votes);
      await page.goto("/events/silvesterparty");
      const notice = page.getByTestId("event-place-plan-notice");
      await expect(notice).toContainText("Plan B aktiv");
      await expect(notice).toContainText("Rodelbahn Gaisalm · Gaisweg 5, 6410 Telfs, Österreich");
      await expect(page.getByTestId("event-facts-where")).toContainText("Plan B aktiv");
      await expect(page.getByTestId("event-place-plan-plan-b")).toHaveAttribute("data-active", "1");

      const place = page.getByTestId("event-poll-p-ort");
      await expect(place.getByTestId("event-poll-p-ort-deadline")).toHaveText("Abstimmen bis Mo 28. Dezember · 18:00");
      await expect(place.getByTestId("event-poll-p-ort-status")).toContainText("Offen");
      await expect(place.getByTestId("event-poll-p-ort-result-plan-b")).toHaveAttribute("data-winner", "1");
      await expect(page.getByTestId("event-poll-p-feier-hidden")).toHaveText("Das Ergebnis erscheint nach der Frist (Mi 30. Dezember · 18:00).");
      const done = page.getByTestId("event-poll-p-essen");
      await expect(done.getByTestId("event-poll-p-essen-status")).toContainText("Beendet");
      await expect(done.getByTestId("event-poll-p-essen-own")).toContainText("Deine Stimme: Gulasch");
      await expect(done.getByTestId("event-poll-p-essen-submit")).toHaveCount(0);
      await noSideScroll(page);
      await shot(page.getByTestId("event-polls"), `abstimmungen-event-${width}`);
      await shot(notice, `plan-b-hinweis-${width}`);
      await shot(page.getByTestId("event-place-plans"), `ort-plaene-event-${width}`);

      const submit = place.getByTestId("event-poll-p-ort-submit");
      await expect(submit).toBeDisabled();
      await place.getByTestId("ballot-option-user:u1-plan-c").click();
      await expect(place.getByTestId("ballot-option-user:u1-plan-c")).toHaveAttribute("aria-pressed", "true");
      await submit.click();
      await expect.poll(() => votes.length).toBe(1);
      expect(votes[0]).toEqual({ choices: ["plan-c"] });
      await expect(place.getByTestId("event-poll-p-ort-own")).toContainText("Deine Stimme: Plan C: Vereinsheim");
      await expect(place.getByTestId("event-poll-p-ort-status")).toContainText("Abgestimmt");
      await expect(submit).toHaveText(/Stimme ändern/);
      await expect(place.getByTestId("event-poll-p-ort-result-valid")).toContainText("8 Stimmen");
      // sonner-Hinweis am Handy: die Maus weg, damit er nicht stehen bleibt und nichts verdeckt.
      await page.mouse.move(0, 0);
      await noSideScroll(page);
      await shot(place, `abgestimmt-${width}`);
      await testInfo.attach(`event-${width}.png`, { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });
    });

    test("Verwaltung: Abstimmungen mit Zahlen, Ort umschalten mit Nachricht, Ergebnis als Ort übernehmen", async ({ page }) => {
      const switches = [];
      const created = [];
      let active = "plan-b";
      await consent(page);
      const adminEvent = () => ({
        ...EVENT, status: "registration_open", active_registration_count: 13, active_place_plan: active,
        place_plans: PLANS.map((plan) => ({ ...plan, active: plan.key === active })),
        place_plan: { ...PLANS.find((plan) => plan.key === active), total: 3, alternative: active !== "plan-a" },
        place_plan_history: switches.map((entry, index) => ({ at: "2026-12-20T09:00:00Z", from_label: index ? "Plan C" : "Plan B", to_label: `Plan ${entry.key.slice(-1).toUpperCase()}`,
          actor_name: "Leitung", notified: entry.notify ? 13 : 0 })).reverse(),
      });
      const adminPolls = [{ ...PLACE_POLL, status: "closed", voters_count: 7, eligible_count: 12, place_plan_poll: true }];
      await page.route("**/api/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path === "/api/auth/me") return route.fulfill(json(ADMIN));
        if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
        if (path === "/api/events/meta") return route.fulfill(json({ types: [{ k: "general", l: "Allgemein" }], statuses: [{ k: "registration_open", l: "Anmeldung offen" }],
          visibilities: [{ k: "public", l: "Öffentlich", short: "Alle" }] }));
        if (path === "/api/admin/events/e-silvester") return route.fulfill(json(adminEvent()));
        if (path === "/api/admin/events/e-silvester/polls" && request.method() === "GET") return route.fulfill(json(adminPolls));
        if (path === "/api/admin/events/e-silvester/polls" && request.method() === "POST") {
          created.push(request.postDataJSON());
          adminPolls.push({ ...PARTY_POLL, ...request.postDataJSON(), id: "p-neu", voters_count: 0, eligible_count: 12, place_plan_poll: false,
            result: { outcome: "none", outcome_label: "Noch keine Stimmen", valid: 0, winner: "", winner_label: "", counts: OPTIONS.map((option) => ({ ...option, count: 0 })) } });
          return route.fulfill(json({ id: "p-neu", notice: { notified: 12 } }));
        }
        if (path === "/api/admin/events/e-silvester/place-plan") {
          const body = request.postDataJSON();
          switches.push(body);
          active = body.key;
          return route.fulfill(json({ changed: true, notice: body.notify ? { notified: 13 } : null }));
        }
        if (path === "/api/events/e-silvester/program") return route.fulfill(json({ event: { id: "e-silvester" }, tournaments: [], fastlaps: [], candidates: { tournaments: [], fastlaps: [] }, defaults: {}, sponsors: { items: [], own_choice: false } }));
        if (path.startsWith("/api/feedback/")) return route.fulfill(json({ count: 0, items: [] }));
        if (path.startsWith("/api/access-links")) return route.fulfill(json([]));
        if (path === "/api/partners") return route.fulfill(json([]));
        return route.abort();
      });
      await page.goto("/admin/events/e-silvester");
      const plans = page.getByTestId("event-place-plans-admin");
      await expect(plans.getByTestId("event-place-plan-active-1")).toContainText("Gilt jetzt");
      await expect(page.getByTestId("event-location-name")).toHaveCount(0);
      const polls = page.getByTestId("event-polls-admin");
      await expect(polls.getByTestId("event-poll-admin-p-ort-turnout")).toContainText("7 von 12 abgestimmt");
      await noSideScroll(page);
      await shot(plans, `ort-plaene-verwaltung-${width}`);
      await shot(polls, `abstimmungen-verwaltung-${width}`);

      // Umschalten: ein Klick, dann die Frage „Angemeldete informieren?“ - „Informieren“.
      await plans.getByTestId("event-place-plan-switch-2").click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("Angemeldete informieren?");
      await expect(dialog).toContainText("Der Ort wechselt auf Plan C");
      await shot(dialog, `umschalten-frage-${width}`);
      await dialog.getByTestId("confirm-dialog-confirm").click();
      await expect.poll(() => switches.length).toBe(1);
      expect(switches[0]).toEqual({ key: "plan-c", notify: true, expected: "plan-b" });
      await expect(plans.getByTestId("event-place-plan-active-2")).toContainText("Gilt jetzt");
      await expect(plans.getByTestId("event-place-plans-history")).toContainText("Plan B → Plan C · Leitung · 13 informiert");
      await page.mouse.move(0, 0);

      // Das Ergebnis der Ort-Abstimmung (Plan B) zurück als Ort - diesmal ohne Nachricht.
      await polls.getByTestId("event-poll-admin-p-ort-take-over").click();
      await page.getByRole("dialog").getByRole("button", { name: "Ohne Nachricht umschalten" }).click();
      await expect.poll(() => switches.length).toBe(2);
      expect(switches[1]).toEqual({ key: "plan-b", notify: false, expected: "plan-c" });
      await expect(plans.getByTestId("event-place-plan-active-1")).toContainText("Gilt jetzt");

      // Neue Abstimmung mit Ergebnis nach der Frist und Nachricht an die Angemeldeten.
      await polls.getByTestId("event-poll-new").click();
      const form = polls.getByTestId("event-poll-form");
      await form.getByTestId("event-poll-question").fill("Danach Garage oder Garten?");
      await form.getByTestId("event-poll-option-0").fill("Garage");
      await form.getByTestId("event-poll-option-1").fill("Garten");
      await form.getByTestId("event-poll-closes").fill("2026-12-30T18:00");
      await form.getByTestId("event-poll-results").selectOption("after_close");
      await form.getByTestId("event-poll-notify").check();
      await noSideScroll(page);
      await shot(form, `abstimmung-anlegen-${width}`);
      await form.getByTestId("event-poll-save").click();
      await expect.poll(() => created.length).toBe(1);
      expect(created[0]).toMatchObject({ question: "Danach Garage oder Garten?", options: [{ label: "Garage" }, { label: "Garten" }], max_choices: 1,
        results_visibility: "after_close", notify: true });
      expect(new Date(created[0].closes_at).toISOString()).toBe("2026-12-30T17:00:00.000Z");
      await expect(polls.getByTestId("event-poll-admin-p-neu")).toContainText("Danach Garage oder Garten?");
    });
  });
}
