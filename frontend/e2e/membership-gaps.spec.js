const { test, expect } = require("@playwright/test");

// Mitgliedschaft, Rechte und Vorstand (#2125): die neuen Flächen bei 390 und 1440 px - Rückfrage beim Status, Export,
// Nummer und Austritt beim Mitglied, Zurückziehen und Reiter „Fehlgeschlagen“, Rechte-Verlauf, Posten mit Rückfrage,
// Strafen auf Deutsch, Vereinsdaten für den Vorstand.

const WIDTHS = [["handy", 390, 844], ["pc", 1440, 900]];
const CHAIR = { id: "u-board", username: "vera", display_name: "Vera Vorstand", role: "player", areas: ["club"], mfa_enabled: true, auth_mfa_verified: true, is_club_member: true };
const ROOT = { id: "u-root", username: "root", display_name: "Sam Superadmin", role: "superadmin", areas: ["tournaments", "content", "club", "finance", "system", "moderation"], mfa_enabled: true, auth_mfa_verified: true };
const MEMBER = { id: "u-1", username: "erika", display_name: "Erika Beispiel", role: "player", areas: [], is_club_member: true };
const ERIKA = { id: "u-1", username: "erika", display_name: "Erika Beispiel", email: "erika@example.test", role: "player", areas: [], is_club_member: true,
  membership: { member_status: "active", member_number: "TLS-2026-0001", membership_type: "ordinary", show_member_number_publicly: false, exit_request: { declared_at: "2026-10-20T10:00:00+00:00", wished_last_day: "2026-12-31" } } };
const MAX = { id: "u-2", username: "max", display_name: "Max Muster", email: "max@example.test", role: "player", areas: [], is_club_member: false, membership: { member_status: "pending" } };

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
    if (url.pathname === "/api/auth/me") return json(me);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    calls.push({ method: "GET", path: url.pathname, search: url.search });
    const answer = routes[url.pathname];
    if (answer !== undefined) return json(typeof answer === "function" ? answer(url) : answer);
    return json(/notifications|games$|nav$|site-banners|sponsors|partners/.test(url.pathname) ? [] : {});
  });
}

async function overflow(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
      await page.setViewportSize({ width, height });
    });

    test("Mitglieder: Bewerbungen, Export und Statuswechsel mit Rückfrage und ohne Mail", async ({ page }) => {
      const calls = [];
      await mockApi(page, CHAIR, {
        "/api/users": [ERIKA, MAX],
        "/api/membership/meta": { statuses: ["none", "active", "former"], types: ["ordinary"], export_available: true },
        "/api/membership/applications": [{ id: "a-1" }, { id: "a-2" }],
        "/api/membership/export.csv": "x",
        "PUT /api/membership/user/u-1": { ...ERIKA, mail: "skipped" },
      }, calls);
      await page.goto("/admin/members");
      await expect(page.getByTestId("members-open-applications")).toHaveText("Offene Bewerbungen (2)");
      await expect(page.getByTestId("members-filter-pending")).toHaveText("Entwurf (Dolibarr)");
      await expect(page.getByTestId("member-exit-erika")).toHaveText("Austritt erklärt");

      const download = page.waitForEvent("download");
      await page.getByTestId("members-export-active").click();
      expect((await download).suggestedFilename()).toMatch(/^mitglieder-\d{4}-\d{2}-\d{2}\.csv$/);
      await expect.poll(() => calls.find((call) => call.path === "/api/membership/export.csv")?.search).toBe("?scope=active");
      expect(await overflow(page)).toBeLessThanOrEqual(2);

      await page.getByTestId("member-edit-erika").click();
      const sheet = page.getByTestId("member-sheet");
      await expect(sheet.getByTestId("edit-exit-request")).toContainText("Austritt erklärt am");
      await expect(sheet.getByTestId("edit-show-number")).toContainText("entscheidet das Mitglied");
      await sheet.getByTestId("edit-status").selectOption("former");
      await sheet.getByTestId("edit-notify").uncheck();
      await page.getByTestId("edit-save").click();
      await expect(page.getByTestId("confirm-dialog")).toContainText("Erika Beispiel bekommt keine Mail und keine Meldung");
      expect(calls.filter((call) => call.method === "PUT")).toEqual([]);
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect.poll(() => calls.find((call) => call.method === "PUT")?.body?.notify).toBe(false);
      await expect(page.getByText("Ohne Mail, wie gewählt.")).toBeVisible();
    });

    test("Mitglieder: ohne Entwürfe kein leerer Filter, mit Dolibarr kein Export", async ({ page }) => {
      await mockApi(page, CHAIR, {
        "/api/users": [ERIKA],
        "/api/membership/meta": { statuses: ["none", "active"], types: [], export_available: false },
        "/api/membership/applications": [],
      }, []);
      await page.goto("/admin/members");
      await expect(page.getByTestId("members-filter-members")).toBeVisible();
      await expect(page.getByTestId("members-filter-pending")).toHaveCount(0);
      await expect(page.getByTestId("members-export-dolibarr")).toBeVisible();
      await expect(page.getByTestId("members-export-active")).toHaveCount(0);
    });

    test("Mitglied: Nummer selbst schalten und den Austritt erklären und zurücknehmen", async ({ page }) => {
      const calls = [];
      const state = { public: false, exit: null };
      await mockApi(page, MEMBER, {
        "/api/membership/me": () => ({ user_id: "u-1", is_active_member: true, user_type: "club_member", dolibarr: null,
          membership: { member_status: "active", member_number: "TLS-2026-0001", show_member_number_publicly: state.public, exit_request: state.exit, history: [] } }),
        "/api/membership/me/directory": { eligible: false },
        "PUT /api/membership/me/number-visibility": (body) => { state.public = body.public; return { show_member_number_publicly: body.public }; },
        "POST /api/membership/me/exit": (body) => { state.exit = { declared_at: "2026-11-01T10:00:00+00:00", wished_last_day: body?.wished_last_day || null }; return { exit_request: state.exit }; },
        "DELETE /api/membership/me/exit": () => { state.exit = null; return { ok: true }; },
      }, calls);
      await page.goto("/members/membership");
      await page.getByTestId("membership-number-switch").click();
      await expect.poll(() => calls.find((call) => call.path === "/api/membership/me/number-visibility")?.body).toEqual({ public: true });

      await page.getByTestId("membership-exit-button").click();
      await expect(page.getByTestId("confirm-dialog")).toContainText("Du bleibst Mitglied");
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect(page.getByTestId("membership-exit-declared")).toContainText("Austritt erklärt am");
      expect(await overflow(page)).toBeLessThanOrEqual(2);

      await page.getByTestId("membership-exit-withdraw").click();
      await expect(page.getByTestId("membership-exit-button")).toBeVisible();
      expect(calls.some((call) => call.method === "DELETE" && call.path === "/api/membership/me/exit")).toBe(true);
    });

    test("Bewerbungen: Zurückziehen, Hinweis zur Mail und Reiter „Fehlgeschlagen“", async ({ page }) => {
      const calls = [];
      await mockApi(page, CHAIR, {
        "/api/membership/applications": (url) => (url.searchParams.get("status") === "failed"
          ? [{ id: "a-f", created_at: "2026-10-05T09:00:00+00:00", user_username: "lea", user_display_name: "Lea", coupled: true, status: "failed", dolibarr: { error_text: "Pflichtfeld fehlt" } }]
          : [{ id: "a-1", created_at: "2026-10-05T09:00:00+00:00", user_username: "max", user_display_name: "Max Muster", coupled: false, status: "pending", contribution_pref: "full", motivation: "Ich spiele gern mit." }]),
        "/api/admin/membership-invitations": [],
        "PATCH /api/membership/applications/a-1": { id: "a-1", status: "approved", mail: "mail_off" },
      }, calls);
      await page.goto("/admin/membership-applications");
      const prefix = width < 1024 ? "app-card" : "app";
      await page.getByTestId(`${prefix}-approve-a-1`).click();
      await expect(page.getByTestId("confirm-dialog")).toContainText("Was du hier schreibst, steht darin");
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect(page.getByText("Der Mailversand ist ausgeschaltet.")).toBeVisible();

      await page.getByTestId(`${prefix}-withdraw-a-1`).click();
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect.poll(() => calls.some((call) => call.method === "POST" && call.path === "/api/membership/applications/a-1/withdraw")).toBe(true);

      await page.getByTestId("apps-tab-failed").click();
      await expect(page.getByText("Pflichtfeld fehlt").filter({ visible: true }).first()).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(2);
    });

    test("Alle Benutzer: Rechte-Verlauf statt Protokoll, eigene Rolle nur lesbar", async ({ page }) => {
      await mockApi(page, ROOT, {
        "/api/users": [{ ...ROOT, email: "root@example.test" }, ERIKA],
        "/api/users/u-1/rights-history": { items: [
          { id: "h-1", action: "user.role_change", from: "player", to: "moderator", at: "2026-10-20T10:00:00+00:00", actor: "Sam Superadmin" },
          { id: "h-2", action: "board.assign", joined: true, title: "Kassier:in", field: "holder", at: "2026-10-19T10:00:00+00:00", actor: "Vera Vorstand" },
        ] },
      }, []);
      await page.goto("/admin/users");
      await expect(page.getByText("Rollen-Protokoll")).toHaveCount(0);
      await page.getByTestId(width < 1024 ? "user-edit-card-root" : "user-edit-root").click();
      const own = page.getByTestId("user-sheet");
      await expect(own.getByTestId("user-sheet-own-role")).toBeVisible();
      await expect(own.getByTestId("user-sheet-role")).toHaveCount(0);
      await expect(page.getByTestId("user-sheet-save")).toHaveCount(0);
      await page.getByTestId("user-sheet-close").click();

      await page.getByTestId(width < 1024 ? "user-edit-card-erika" : "user-edit-erika").click();
      await page.getByTestId("user-sheet-history-toggle").click();
      const history = page.getByTestId("user-sheet-history-list");
      await expect(history).toContainText("Rolle: Spieler → Moderator");
      await expect(history).toContainText("Vorstand: wird Kassier:in");
      await expect(history).toContainText("von Sam Superadmin");
      expect(await overflow(page)).toBeLessThanOrEqual(2);
    });

    test("Vorstand: Deaktivieren nennt die Inhaber und fragt nach", async ({ page }) => {
      const calls = [];
      await mockApi(page, CHAIR, {
        "/api/board": [{ id: "bp-1", slug: "kassier", title_male: "Kassier", title_female: "Kassierin", is_default: true, allow_deputy: true, is_active: true, user_id: "p-1", user: { display_name: "Leo Löwe" } }],
        "/api/board/source": { dolibarr: false, switch_on: false, has_board: false },
        "/api/board/admin/state": { dolibarr_leads: false, rights_from_dolibarr: false },
      }, calls);
      await page.goto("/admin/board");
      await page.getByTestId("board-more-kassier").click();
      await page.getByTestId("board-toggle-kassier").click();
      await expect(page.getByTestId("confirm-dialog")).toContainText("Leo Löwe verliert damit die Vereinsverwaltung");
      expect(calls.filter((call) => call.method === "PATCH")).toEqual([]);
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect.poll(() => calls.find((call) => call.method === "PATCH")?.body).toEqual({ is_active: false });
    });

    test("Strafen: deutsche Wörter, Zähler vom Server auch mit Filter", async ({ page }) => {
      const items = [{ kind: "incident", ref_id: "i-1", label: "Unsportlich", reason: "Beleidigung", context_title: "Verhalten / Vorfall", issued_at: "2026-10-20T10:00:00+00:00", issued_by_name: "Admin", user_username: "erika", user_display_name: "Erika Beispiel" }];
      await mockApi(page, { ...ROOT }, {
        "/api/admin/penalties": { count: 1, counts: { all: 4, incident: 1, lap_invalid: 2, match_forfeit: 1 }, items },
      }, []);
      await page.goto("/admin/penalties");
      await expect(page.getByTestId("pen-filter-lap_invalid")).toContainText("Runde ungültig");
      await expect(page.getByTestId("pen-filter-lap_invalid")).toContainText("2");
      await expect(page.getByTestId("pen-filter-match_forfeit")).toContainText("Kampflos verloren");
      await page.getByTestId("pen-filter-incident").click();
      await expect(page.getByTestId("pen-filter-all")).toContainText("4");
      await expect(page.getByTestId("pen-row-i-1")).toContainText("Beleidigung");
      await expect(page.locator("body")).not.toContainText(/Forfeit|Lap Invalid/);
    });

    test("Vereinsdaten: der Vorstand pflegt Stammdaten, Rechtstexte sind gesperrt", async ({ page }) => {
      const calls = [];
      await mockApi(page, CHAIR, {
        "/api/settings/club-data": { legal_name: "THE LION SQUAD", terms_of_use: "Bedingungen" },
        "/api/admin/dolibarr/public": { has_data: false },
      }, calls);
      await page.goto("/admin/club");
      await expect(page.getByTestId("legal-name")).toHaveValue("THE LION SQUAD");
      await expect(page.getByTestId("terms-of-use")).toBeDisabled();
      await page.getByTestId("legal-phone").fill("0512");
      await page.getByTestId("legal-save").click();
      await expect.poll(() => calls.find((call) => call.method === "PUT")?.path).toBe("/api/settings/club-data");
      expect(await overflow(page)).toBeLessThanOrEqual(2);
    });
  });
}
