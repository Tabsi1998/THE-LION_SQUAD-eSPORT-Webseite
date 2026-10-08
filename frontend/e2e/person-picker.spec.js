const { test, expect } = require("@playwright/test");

// Personensuche (#1354): die Turnierleitung trägt eine Fast-Lap-Zeit ein und fügt einem Turnier ein Team hinzu, der
// Ergebnisdienst wählt im eigenen Turnier einen Teilnehmer - bei 390, 768 und 1440 px, ohne dass die Seite die ganze
// Kontoliste lädt. Server und Konten sind Attrappen im Browser.

const WIDTHS = [["handy", 390, 844], ["tablet", 768, 1024], ["pc", 1440, 900]];
const LEAD = { id: "u-lead", username: "tom.turnier", display_name: "Tom Turnier", role: "tournament_admin", areas: ["moderation", "tournaments"], is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true };
const SCOREKEEPER = { id: "u-score", username: "eva.ergebnis", display_name: "Eva Ergebnis", role: "player", areas: [], is_tournament_staff: true, mfa_enabled: false, auth_mfa_verified: false };
const HITS = [{ id: "u-7", name: "Erika Beispiel", avatar_url: null, context: "Mitglied · Team Lions Rocket", is_club_member: false }];
const TEAMS = [{ id: "team-1", name: "Lions Rocket", tag: "LRK", logo_url: null, member_count: 2 }, { id: "team-2", name: "Die Flipper", tag: "FLP", logo_url: null, member_count: 2 }];

function tournament(id, teamMode) {
  return { id, slug: id, title: teamMode === "solo" ? "Mario Kart Cup" : "Rocket League 2v2", status: "registration_open", format: "single_elim", team_mode: teamMode, max_participants: 16, visibility: "public" };
}

async function mockApi(page, me, posted) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() === "POST") {
      posted.push({ path, body: request.postDataJSON() });
      return json({ id: "neu-1", ok: true });
    }
    if (path === "/api/users") {
      posted.push({ path, fullList: true });
      return json({ detail: "Die ganze Kontoliste ist hier nicht vorgesehen." }, 403);
    }
    if (path === "/api/auth/me") return json(me);
    if (path === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (path === "/api/admin/people/search") return json(url.searchParams.get("q") ? HITS : []);
    if (path === "/api/admin/choices/teams") return json(TEAMS);
    if (path === "/api/f1/challenges/fl-1") return json({ id: "fl-1", slug: "fast-lap-spa", title: "Fast Lap Spa", status: "live", tracks: [{ id: "tr-1", name: "Spa-Francorchamps", country: "Belgien" }], updated_at: "2026-10-08T08:00:00+00:00" });
    if (path === "/api/tournaments/t-team") return json(tournament("t-team", "team"));
    if (path === "/api/tournaments/t-solo") return json(tournament("t-solo", "solo"));
    if (/\/bracket$/.test(path)) return json({});
    const list = /notifications|staff|registrations|stages|matches|stations|groups|times|access-links|games|nav$|sponsors|partners|site-banners/.test(path);
    return json(list ? [] : {});
  });
}

async function overflow(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
}

async function pick(page, testId, query) {
  await page.getByTestId(`${testId}-search`).fill(query);
  await page.getByTestId(`${testId}-option-u-7`).click();
  await expect(page.getByTestId(`${testId}-selected`)).toContainText("Erika Beispiel");
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
      await page.setViewportSize({ width, height });
    });

    test("Turnierleitung: Fast-Lap-Zeit mit gesuchtem Fahrer eintragen", async ({ page }) => {
      const posted = [];
      await mockApi(page, LEAD, posted);
      await page.goto("/admin/f1/fl-1");
      await expect(page.getByTestId("f1-add-time-user-search")).toBeVisible();
      await pick(page, "f1-add-time-user", "eri");
      await page.getByTestId("f1-add-time-value").fill("1:24.587");
      await page.getByTestId("f1-add-time-submit").click();
      await expect.poll(() => posted.find((entry) => entry.path === "/api/f1/challenges/fl-1/times")?.body?.user_id).toBe("u-7");
      expect(await overflow(page)).toBeLessThanOrEqual(2);
      expect(posted.filter((entry) => entry.fullList)).toEqual([]);
    });

    test("Turnierleitung: Team aus der Auswahl hinzufügen", async ({ page }) => {
      const posted = [];
      await mockApi(page, LEAD, posted);
      await page.goto("/admin/tournaments/t-team");
      await page.getByTestId("participant-add-team").selectOption("team-1");
      await page.getByTestId("participant-add-submit").click();
      await expect.poll(() => posted.find((entry) => entry.path === "/api/tournaments/t-team/registrations")?.body?.team_id).toBe("team-1");
      expect(await overflow(page)).toBeLessThanOrEqual(2);
      expect(posted.filter((entry) => entry.fullList)).toEqual([]);
    });

    test("Ergebnisdienst: im eigenen Turnier einen Teilnehmer wählen", async ({ page }) => {
      const posted = [];
      await mockApi(page, SCOREKEEPER, posted);
      await page.goto("/admin/tournaments/t-solo");
      await pick(page, "participant-add-user", "eri");
      await page.getByTestId("participant-add-submit").click();
      await expect.poll(() => posted.find((entry) => entry.path === "/api/tournaments/t-solo/registrations")?.body?.user_id).toBe("u-7");
      expect(await overflow(page)).toBeLessThanOrEqual(2);
      expect(posted.filter((entry) => entry.fullList)).toEqual([]);
    });
  });
}
