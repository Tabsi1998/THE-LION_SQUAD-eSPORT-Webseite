const { test, expect } = require("@playwright/test");

// Keine Sackgassen für Nutzer (#2113): eigene Turnier- und Event-Anmeldung ändern, abgelehnte Anmeldung entfernen, offene
// Team-Einladungen zurückziehen, Konto löschen mit Rollen in Teams - bei 390 und 1440 px ohne seitliches Scrollen.
// API nachgestellt, erfundene Daten.

const user = { id: "u-1", username: "testperson", display_name: "Testperson", role: "player", user_type: "community_user" };
const SIZES = [{ width: 390, height: 844 }, { width: 1440, height: 900 }];

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockChrome(page) {
  await page.route("**/api/settings/public", (route) => json(route, { club_name: "THE LION SQUAD", tagline: "eSports" }));
  await page.route("**/api/sponsors**", (route) => json(route, []));
  await page.route("**/api/auth/me", (route) => json(route, user));
}

async function closeCookies(page) {
  const button = page.getByRole("button", { name: /alle erlauben/i });
  if (await button.count()) await button.click();
}

async function expectNoSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const TOURNAMENT = {
  id: "t-1", slug: "herbst-cup", title: "Herbst-Cup", status: "registration_open", registration_enabled: true, participant_count: 1, max_participants: 16,
  team_mode: "solo", team_size: 1, event_mode: "online", public_phase: { state: "registration_open", label: "Anmeldung" },
};

async function mockTournament(page, registrations, details) {
  await page.route("**/api/tournaments/herbst-cup", (route) => json(route, TOURNAMENT));
  await page.route("**/api/tournaments/t-1/registrations**", (route) => {
    if (route.request().method() === "DELETE") {
      registrations.length = 0;
      return json(route, { ok: true });
    }
    return json(route, registrations);
  });
  await page.route("**/api/tournaments/t-1/my-registration", (route) => {
    if (route.request().method() === "PATCH") {
      Object.assign(details, route.request().postDataJSON());
      return json(route, details);
    }
    return json(route, details);
  });
  await page.route("**/api/teams/my", (route) => json(route, []));
}

for (const size of SIZES) {
  test.describe(`${size.width} px`, () => {
    test.use({ viewport: size });

    test("Angaben der Turnieranmeldung ändern: Tippen behält den Fokus, gespeichert wird im Blatt", async ({ page }) => {
      await mockChrome(page);
      const details = {
        id: "r-1", status: "approved", is_team: false, ingame_name: "AlterName", discord: "alt#1", player_ids: { riot: "Alt#EUW" },
        fields: [{ key: "riot", label: "Riot-ID", required: true, help_text: "Name#TAG" }], can_edit: true, reason: null, ids_locked: false, ids_locked_reason: null,
      };
      await mockTournament(page, [{ id: "r-1", tournament_id: "t-1", user_id: user.id, status: "approved", display_name: "Testperson" }], details);
      await page.goto("/tournaments/herbst-cup");
      await closeCookies(page);
      await page.getByTestId("my-registration-edit").click();
      const name = page.getByTestId("my-registration-name");
      await name.click();
      await name.pressSequentially("X");
      await expect(name).toHaveValue(/X/);
      await expect(name).toBeFocused();
      await page.getByTestId("my-registration-discord").fill("neu#2");
      await expectNoSideScroll(page);
      await page.getByTestId("my-registration-save").click();
      await expect(page.getByTestId("my-registration-sheet")).toHaveCount(0);
      expect(details.discord).toBe("neu#2");
    });

    test("abgelehnte Anmeldung: Hinweis, entfernen, danach wieder anmelden", async ({ page }) => {
      await mockChrome(page);
      await mockTournament(page, [{ id: "r-1", tournament_id: "t-1", user_id: user.id, status: "rejected", display_name: "Testperson" }], { can_edit: false, reason: "Diese Anmeldung lässt sich nicht mehr ändern." });
      await page.goto("/tournaments/herbst-cup");
      await closeCookies(page);
      await expect(page.getByTestId("tournament-rejected-note")).toContainText("abgelehnt");
      await expect(page.getByTestId("my-registration-edit")).toHaveCount(0);
      await expectNoSideScroll(page);
      await page.getByTestId("tournament-remove-rejected").click();
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect(page.getByTestId("tournament-register-btn")).toBeVisible();
    });

    test("Team: Kapitän sieht den Weg, offene Einladung lässt sich zurückziehen", async ({ page }) => {
      await mockChrome(page);
      let invites = [{ id: "inv-1", created_at: "2026-10-20T10:00:00Z", user: { id: "u-5", username: "nachtfuchs", display_name: "Nachtfuchs mit einem sehr langen Anzeigenamen" }, inviter: { id: user.id, username: "testperson", display_name: "Testperson" } }];
      await page.route("**/api/teams/team-1", (route) => json(route, {
        id: "team-1", name: "Rudel", tag: "RDL", leader_id: user.id, co_leader_ids: [], member_ids: [user.id],
        members: [{ id: user.id, username: "testperson", display_name: "Testperson" }], is_member: true, can_manage: true, join_code: "Kx7pQ2", awards: [],
      }));
      await page.route("**/api/teams/team-1/invite-link", (route) => json(route, { url: "http://127.0.0.1/teams/team-1?einladung=abc", token: "abc" }));
      await page.route("**/api/teams/team-1/invites", (route) => json(route, invites));
      await page.route("**/api/teams/team-1/invites/inv-1", (route) => {
        invites = [];
        return json(route, { ok: true });
      });
      await page.goto("/teams/team-1");
      await closeCookies(page);
      await expect(page.getByTestId("team-leave-leader-hint")).toContainText("Übergib zuerst die Leitung");
      await expect(page.getByTestId("team-leave")).toHaveCount(0);
      await page.getByTestId("team-invite-open").click();
      await expect(page.getByTestId("team-pending-invite-inv-1")).toContainText("Nachtfuchs");
      await expectNoSideScroll(page);
      await page.getByTestId("team-pending-invite-withdraw-inv-1").click();
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect(page.getByTestId("team-pending-invites")).toHaveCount(0);
    });

    test("Konto löschen mit Rolle im Team: Weg je Rolle, Knopf gesperrt", async ({ page }) => {
      await mockChrome(page);
      await page.route("**/api/moderation/blocks", (route) => json(route, []));
      await page.route("**/api/dsgvo/anonymize-me/check", (route) => json(route, {
        can_erase: false,
        blockers: [
          { team_id: "team-1", team: "[RDL] Rudel", squad_id: null, squad: null, role: "leader", role_label: "Kapitän", way: "Übergib die Leitung auf der Teamseite oder löse das Team auf.", link: "/teams/team-1" },
          { team_id: "team-1", team: "[RDL] Rudel", squad_id: "s-1", squad: "Erste", role: "captain", role_label: "Captain", way: "Gib die Rolle in deinem Profil ab.", link: "/profile?tab=teams" },
        ],
      }));
      await page.goto("/privacy-account");
      await closeCookies(page);
      await expect(page.getByTestId("dsgvo-erasure-blockers")).toContainText("Erst deine Rollen in Teams abgeben");
      await expect(page.getByTestId("dsgvo-erasure-blocker-captain")).toContainText("im Co-Team Erste");
      await expect(page.getByTestId("dsgvo-anonymize-btn")).toBeDisabled();
      await expectNoSideScroll(page);
    });

    test("Event-Anmeldung ändern: Begleitpersonen und Hinweis im Kasten", async ({ page }) => {
      await mockChrome(page);
      let own = { id: "er-1", user_id: user.id, display_name: "Testperson", status: "registered", companion_count: 0, seat_count: 1, note: "komme mit dem Zug", can_cancel: true, can_edit: true };
      await page.route("**/api/events/herbst-lan", (route) => json(route, {
        id: "e-1", slug: "herbst-lan", name: "Herbst-LAN", status: "registration_open", public_phase: { state: "registration_open", label: "Anmeldung" },
        has_registration: true, allow_companions: true, max_companions_per_registration: 3,
        registration_summary: { registered_count: 1, reserved_seats: own.seat_count, companion_count: own.companion_count },
        own_registration: own, registrations: [], tournaments: [], f1_challenges: [],
      }));
      await page.route("**/api/events/e-1/registrations/me", (route) => {
        const body = route.request().postDataJSON();
        own = { ...own, ...body, seat_count: 1 + Number(body.companion_count ?? own.companion_count) };
        return json(route, own);
      });
      await page.goto("/events/herbst-lan");
      await closeCookies(page);
      await expect(page.getByTestId("event-own-note")).toContainText("komme mit dem Zug");
      await page.getByTestId("event-edit-link").click();
      await page.getByTestId("event-edit-companions").fill("2");
      await expectNoSideScroll(page);
      await page.getByTestId("event-edit-save").click();
      await expect(page.getByTestId("event-edit-form")).toHaveCount(0);
      await expect(page.getByTestId("event-own-seats")).toContainText("3");
    });
  });
}
