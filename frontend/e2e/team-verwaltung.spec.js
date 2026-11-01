const { test, expect } = require("@playwright/test");

// Teams (#2128): Teamverwaltung im Admin, „Alle Beitrittscodes erneuern“, Wiederherstellen, Suche auf der öffentlichen Liste,
// Co-Team-Formular mit Spiel, Schalter öffentlich/privat und „Beitrittscode erneuern“ - bei 390 und 1440 px ohne seitliches
// Scrollen. API nachgestellt, erfundene Daten.

const WIDTHS = [["handy", 390, 844], ["pc", 1440, 900]];
const ROOT = { id: "u-root", username: "root", display_name: "Sam Superadmin", role: "superadmin", areas: ["tournaments", "content", "club", "finance", "system", "moderation"], mfa_enabled: true, auth_mfa_verified: true };
const LEAD = { id: "u-1", username: "testperson", display_name: "Testperson", role: "player", areas: [] };
const LONG_NAME = "Ein Team mit einem wirklich sehr langen Namen für die Probe";
const TEAM_ROW = { id: "t-1", name: "Rudel", tag: "RDL", member_count: 5, squad_count: 2, is_public: true, leader: { id: "u-1", username: "testperson", display_name: "Testperson" }, leader_gone: false, created_at: "2026-01-10T10:00:00+00:00" };
const ORPHAN_ROW = { id: "t-2", name: LONG_NAME, tag: "LANG", member_count: 2, squad_count: 0, is_public: false, leader: null, leader_gone: true };
const DISSOLVED_ROW = { id: "t-3", name: "Altes Rudel", tag: "ALT", member_count: 4, squad_count: 1, days_left: 12 };
const TEAM = {
  id: "t-1", name: "Rudel", tag: "RDL", leader_id: LEAD.id, co_leader_ids: [], member_ids: [LEAD.id], is_public: true, is_member: true, my_role: "leader",
  members: [{ id: LEAD.id, username: LEAD.username, display_name: LEAD.display_name }], can_manage: true, can_remove_members: true, can_dissolve: true, can_change_roles: true,
  join_code: "Pr0beCode", awards: [],
};

async function mockApi(page, me, routes, calls) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() !== "GET") {
      let body = null;
      try { body = request.postDataJSON(); } catch { body = null; }
      calls.push({ method: request.method(), path: url.pathname, body });
      const answer = routes[`${request.method()} ${url.pathname}`];
      return json(typeof answer === "function" ? answer(body) : answer || { ok: true });
    }
    if (url.pathname === "/api/auth/me") return me ? json(me) : json({ detail: "nicht angemeldet" }, 401);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    calls.push({ method: "GET", path: url.pathname, search: url.search });
    const answer = routes[url.pathname];
    if (answer !== undefined) return json(typeof answer === "function" ? answer(url) : answer);
    return json(/notifications|games$|nav$|site-banners|sponsors|partners|invites|chat|squads|my$|mine$/.test(url.pathname) ? [] : {});
  });
}

async function overflow(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.use({ viewport: { width, height } });

    test("Admin: Liste mit Suche, verwaiste und private Teams, alle Codes erneuern, wiederherstellen", async ({ page }) => {
      const calls = [];
      await mockApi(page, ROOT, {
        "/api/admin/dashboard": { team_count: 2 },
        "/api/admin/teams": (url) => {
          const rights = { can_restore: true, can_renew_all: true, restore_days: 30, limit: 50, offset: 0 };
          if (url.searchParams.get("state") === "dissolved") return { items: [DISSOLVED_ROW], total: 1, ...rights };
          const needle = (url.searchParams.get("q") || "").toLowerCase();
          const items = [TEAM_ROW, ORPHAN_ROW].filter((row) => row.name.toLowerCase().includes(needle));
          return { items, total: items.length, ...rights };
        },
        "POST /api/admin/teams/join-codes/renew": { ok: true, renewed: 2 },
      }, calls);

      await page.goto("/admin/teams");
      await expect(page.getByTestId("admin-team-t-1")).toContainText("Teamleitung: Testperson");
      await expect(page.getByTestId("admin-team-orphan-t-2")).toBeVisible();
      await expect(page.getByTestId("admin-team-private-t-2")).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);

      await page.getByTestId("admin-teams-search").fill("rudel");
      await expect(page.getByTestId("admin-team-t-2")).toHaveCount(0);
      await page.getByTestId("admin-teams-search").fill("gibtsnicht");
      await expect(page.getByTestId("admin-teams-empty")).toContainText("Kein Team passt");
      await page.getByTestId("admin-teams-search").fill("");
      await expect(page.getByTestId("admin-team-t-1")).toBeVisible();

      await page.getByTestId("admin-teams-renew-all-button").click();
      await expect(page.getByTestId("confirm-dialog")).toContainText("gelten sofort nicht mehr");
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect.poll(() => calls.filter((call) => call.path === "/api/admin/teams/join-codes/renew").length).toBe(1);
      expect(calls.find((call) => call.path === "/api/admin/teams/join-codes/renew").body).toEqual({ confirm: true });

      await page.getByTestId("admin-teams-tab-dissolved").click();
      await expect(page.getByTestId("dissolved-team-t-3")).toContainText("noch 12 Tage");
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await page.getByTestId("dissolved-team-restore-t-3").click();
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect.poll(() => calls.some((call) => call.path === "/api/teams/t-3/restore")).toBe(true);
    });

    test("Dashboard: die Kachel Teams führt zur Teamverwaltung", async ({ page }) => {
      const calls = [];
      await mockApi(page, ROOT, { "/api/admin/dashboard": { team_count: 2 }, "/api/admin/teams": { items: [TEAM_ROW], total: 1, can_restore: true, can_renew_all: true, restore_days: 30 } }, calls);
      await page.goto("/admin");
      await page.getByTestId("kpi-Teams").click();
      await expect(page).toHaveURL(/\/admin\/teams$/);
      await expect(page.getByTestId("admin-team-t-1")).toBeVisible();
    });

    test("Öffentliche Liste: Suchfeld fragt den Server", async ({ page }) => {
      const calls = [];
      await mockApi(page, null, {
        "/api/teams": (url) => (url.searchParams.get("q") ? [] : [{ id: "t-1", name: "Rudel", tag: "RDL", member_count: 3 }]),
        "/api/teams/levels": { levels: {}, crowns: {} },
      }, calls);
      await page.goto("/teams");
      await expect(page.getByTestId("team-card-RDL")).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await page.getByTestId("teams-search").fill("Niemand");
      await expect(page.getByTestId("teams-empty")).toContainText("KEIN TEAM GEFUNDEN");
      expect(calls.some((call) => call.path === "/api/teams" && call.search.includes("q=Niemand"))).toBe(true);
    });

    test("Deine Teams: Co-Team mit Spiel aus der Liste, aufgelöstes Team zurückholen", async ({ page }) => {
      const calls = [];
      await mockApi(page, LEAD, {
        "/api/teams": [],
        "/api/teams/levels": { levels: {}, crowns: {} },
        "/api/teams/my": [TEAM],
        "/api/teams/dissolved/mine": [DISSOLVED_ROW],
        "/api/teams/t-1/squads": [{ id: "s-1", team_id: "t-1", name: "Erste", status: "active", member_ids: [LEAD.id], members: TEAM.members, game_id: "g-1", game: "Probe Rush", tournament_id: "alt", season_id: "alt" }],
        "/api/games": [{ id: "g-1", name: "Probe Rush" }, { id: "g-2", name: "Probe Kart" }],
      }, calls);
      await page.goto("/teams");
      await expect(page.getByTestId("team-squad-game-s-1")).toContainText("Spiel: Probe Rush");
      await expect(page.getByTestId("dissolved-team-t-3")).toContainText("noch 12 Tage");
      expect(await overflow(page)).toBeLessThanOrEqual(0);

      await page.getByRole("button", { name: /^Co-Team$/ }).click();
      await page.getByTestId("team-squad-name").fill("Zweite");
      await expect(page.getByText("Jahreswertung / Circuit")).toHaveCount(0);
      await page.getByTestId("team-squad-game").selectOption("g-2");
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await page.getByRole("button", { name: "Speichern" }).click();
      await expect.poll(() => calls.find((call) => call.method === "POST" && call.path === "/api/teams/t-1/squads")?.body?.game_id).toBe("g-2");
      expect(calls.find((call) => call.method === "POST" && call.path === "/api/teams/t-1/squads").body).not.toHaveProperty("tournament_id");

      await page.getByTestId("dissolved-team-restore-t-3").click();
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect.poll(() => calls.some((call) => call.path === "/api/teams/t-3/restore")).toBe(true);
    });

    test("Teamseite: privat schalten mit Hinweis, Beitrittscode erneuern, aufgelöst statt nicht gefunden", async ({ page }) => {
      const calls = [];
      await mockApi(page, LEAD, {
        "/api/teams/t-1": TEAM,
        "/api/teams/t-1/overview": { upcoming: [], recent: [] },
        "/api/teams/t-1/level": {},
        "/api/teams/t-1/invite-link": { url: "http://127.0.0.1/teams/t-1?einladung=abc", token: "abc" },
        "POST /api/teams/t-1/join-code": { join_code: "N3uCode" },
      }, calls);
      await page.goto("/teams/t-1");
      await page.getByTestId("team-edit-open").click();
      await page.getByTestId("team-public-toggle").uncheck();
      await expect(page.getByTestId("team-public-hint")).toContainText("nicht in der Teamliste");
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await page.getByTestId("team-save").click();
      await expect.poll(() => calls.find((call) => call.method === "PATCH" && call.path === "/api/teams/t-1")?.body?.is_public).toBe(false);

      await page.getByTestId("team-invite-open").click();
      await expect(page.getByTestId("team-join-code-value")).toHaveText("Pr0beCode");
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await page.getByTestId("team-join-code-renew").click();
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect(page.getByTestId("team-join-code-value")).toHaveText("N3uCode");

      await page.route("**/api/teams/t-9", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Altes Rudel wurde aufgelöst." }) }));
      await page.goto("/teams/t-9");
      await expect(page.getByTestId("team-missing")).toContainText("Team aufgelöst");
      await expect(page.getByTestId("team-missing")).toContainText("Altes Rudel wurde aufgelöst.");
    });
  });
}
