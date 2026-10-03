const { test, expect } = require("@playwright/test");

// Erfolge im Admin (E10, #620): Einzel- und Massenvergabe im Browser, Desktop und Handy. Admin-Konto und API
// sind Attrappen im Browser - geprüft wird, was die Oberfläche an den Server schickt (Grund, Datum, still,
// Benachrichtigung, Namen aus der Liste) und dass die Massenvergabe erst nach der Vorschau vergibt.

const GROUPS = [
  { code: "matches_played", name: "Spielmacher", category: "match", description: "Spiel Matches.", public: true, icon: "swords", art: "crossed-swords" },
];
const TIERS = [
  { code: "matches_played_1", group_code: "matches_played", name: "Spielmacher I", material: "wood", rank: 1, points: 5, condition_key: "matches_played", progress_target: 1 },
  { code: "matches_played_2", group_code: "matches_played", name: "Spielmacher II", material: "iron", rank: 2, points: 10, condition_key: "matches_played", progress_target: 5 },
];
const PAULA = { id: "u1", username: "paula", display_name: "Paula", email: "paula@example.test", is_club_member: false };
const PEOPLE = [
  { id: "u1", username: "paula", display_name: "Paula", state: "new" },
  { id: "u2", username: "max", display_name: "Max", state: "already" },
];

async function mockAdmin(page, calls) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/auth/me") {
      return json({ id: "admin-1", email: "admin@example.test", display_name: "Chef", username: "chef", role: "superadmin", is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true });
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      calls.push({ path, body });
      if (path === "/admin/achievements/award") return json({ ok: true, newly_awarded: true, silent: body.silent, notify: body.notify });
      if (path === "/admin/achievements/award/bulk") {
        return json(body.dry_run
          ? { recipients: 2, would_award: 1, already: 1, skipped: 0, awarded: 0, unknown: ["niemand"], dry_run: true, people: PEOPLE }
          : { recipients: 2, would_award: 1, already: 1, skipped: 0, awarded: 1, unknown: ["niemand"], dry_run: false });
      }
      return json({}, 405);
    }
    if (request.method() !== "GET") return json({}, 405);
    const table = {
      "/admin/achievements/me": { board: true },
      "/admin/achievements/groups": GROUPS,
      "/admin/achievements/tiers": TIERS,
      "/admin/achievements/users/search": [PAULA],
      "/admin/achievements/users/u1/awards": [],
      "/admin/achievements/events": [],
      "/tournaments": [{ id: "t1", name: "Herbst-Cup" }],
      "/events": [],
      "/teams": [],
    };
    if (path in table) return json(table[path]);
    const list = path.includes("/notifications") || path.endsWith("/games");
    return json(list ? [] : {});
  });
}

test.describe("Erfolge im Admin", () => {
  test("Einzelvergabe schickt Grund, Datum, still und ohne Benachrichtigung", async ({ page }, testInfo) => {
    const calls = [];
    await mockAdmin(page, calls);
    await page.goto("/admin/achievements?tab=award");
    await expect(page.getByTestId("ach-tab-award")).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("award-person-search").fill("pau");
    await page.getByTestId("award-person-option-u1").click();
    await expect(page.getByTestId("award-person-selected")).toContainText("Paula");
    await page.getByTestId("award-tier-select").selectOption("matches_played_2");
    await page.getByTestId("award-note").fill("LAN-Abend");
    await page.getByTestId("award-date").fill("2026-09-01T18:00");
    await page.getByTestId("award-silent").check();
    await page.getByTestId("award-notify").uncheck();
    await testInfo.attach("einzelvergabe.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.getByTestId("award-submit").click();
    await expect.poll(() => calls.find((c) => c.path === "/admin/achievements/award")?.body).toEqual(expect.objectContaining({
      user_id: "u1", tier_code: "matches_played_2", note: "LAN-Abend", silent: true, notify: false,
    }));
    const sent = calls.find((c) => c.path === "/admin/achievements/award").body;
    expect(sent.earned_at.startsWith("2026-09-01")).toBe(true);
  });

  test("Massenvergabe vergibt erst nach der Vorschau – mit den Namen aus der Liste", async ({ page }, testInfo) => {
    const calls = [];
    await mockAdmin(page, calls);
    await page.goto("/admin/achievements?tab=award");
    await page.getByTestId("bulk-tier-select").selectOption("matches_played_1");
    await page.getByTestId("bulk-names").fill("Benutzername\npaula\nmax;Max\nniemand");
    await expect(page.getByTestId("bulk-name-count")).toHaveText("3 Namen");
    await expect(page.getByTestId("bulk-tournament").locator("option", { hasText: "Herbst-Cup" })).toHaveCount(1);
    await page.getByTestId("bulk-tournament").selectOption("t1");
    await expect(page.getByTestId("bulk-submit")).toHaveCount(0);
    await page.getByTestId("bulk-preview").click();
    await expect(page.getByTestId("bulk-would")).toHaveText("1 bekommen es");
    await expect(page.getByTestId("bulk-unknown")).toContainText("1 nicht gefunden");
    await expect(page.getByTestId("bulk-result")).toContainText("hat es schon");
    expect(calls.filter((c) => c.path === "/admin/achievements/award/bulk")).toHaveLength(1);
    expect(calls[0].body).toEqual(expect.objectContaining({ dry_run: true, names: ["paula", "max", "niemand"], tournament_id: "t1", tier_code: "matches_played_1" }));
    await testInfo.attach("massenvergabe-vorschau.png", { body: await page.getByTestId("award-bulk").screenshot(), contentType: "image/png" });
    await page.getByTestId("bulk-submit").click();
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect.poll(() => calls.filter((c) => c.path === "/admin/achievements/award/bulk").length).toBe(2);
    expect(calls[calls.length - 1].body).toEqual(expect.objectContaining({ dry_run: false, names: ["paula", "max", "niemand"], tournament_id: "t1" }));
    await expect(page.getByTestId("bulk-result")).toHaveCount(0);
  });
});
