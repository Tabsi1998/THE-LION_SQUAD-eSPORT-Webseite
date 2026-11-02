const { test, expect } = require("@playwright/test");

// Fast Lap, Referenzen, Partner und Sponsoren (#2130): die neuen Flächen bei 390 und 1440 px - Meisterschaft und Stream im
// Bearbeiten, Kasten „Bedingungen“, Strafen mit Sprung und Zurücknehmen, Rückfrage, Archivieren und Löschen, Dolibarr-Sperren,
// Suche und Seiten der Referenzliste, Bild-Wartung unter System. Erfundene Daten.

const WIDTHS = [["handy", 390, 844], ["pc", 1440, 900]];
const ROOT = { id: "u-root", username: "root", display_name: "Sam Superadmin", role: "superadmin", areas: ["tournaments", "content", "club", "finance", "system", "moderation"], mfa_enabled: true, auth_mfa_verified: true };
const RACER = { id: "u-1", username: "erika", display_name: "Erika Beispiel", role: "player", areas: [] };
const CHALLENGE = {
  id: "c-1", slug: "monza", title: "Monza Sprint mit einem ziemlich langen Namen für schmale Bildschirme", status: "completed", visibility: "public", participant_count: 3,
  vehicle: "Red Bull RB20", weather: "Trocken, bewölkt", assists_allowed: "ABS an, Traktion aus, Rennlinie nur in Kurven", controller_type: "Lenkrad", platform: "PlayStation 5",
  tracks: [{ id: "t-1", name: "Monza" }, { id: "t-2", name: "Spa" }], unlimited_attempts: true,
};
const BOARD = { track: { id: "t-1", name: "Monza" }, max_attempts: null, entries: [{ rank: 1, participant_id: "u-1", user_id: "u-1", display_name: "Erika Beispiel", time_str: "1:21,000", attempts: 1 }] };
const PENALTIES = [
  { ref_id: "lap-1", kind: "lap_penalty", label: "+5s Strafzeit", reason: "Abkürzung in Kurve 7", issued_by_name: "Leitung", issued_at: "2026-10-01T10:00:00Z", context_title: "Monza Sprint", context_subtitle: "Monza", context_url: "/fastlap/monza", admin_url: "/admin/f1/c-1?track=t-2", results_locked: false, user_username: "erika", user_display_name: "Erika Beispiel" },
  { ref_id: "m-1", kind: "match_forfeit", label: "Kampflos verloren", reason: "Nicht erschienen", issued_by_name: "Leitung", issued_at: "2026-09-01T10:00:00Z", context_title: "Herbst-Cup", context_subtitle: "Match #4", context_url: "/tournaments/cup", admin_url: "/admin/tournaments/t-9", user_username: "erika", user_display_name: "Erika Beispiel" },
];
const SOURCE = { from_dolibarr: true, connected: true, sponsor_category: "Sponsor", partner_category: "Partner", fetched_at: "2026-10-01T10:00:00Z", counts: { sponsors: 1, partners: 1 }, locked: { sponsors: ["name", "tier", "contract_start", "contract_end", "contact_email", "contact_phone"], partners: ["name", "kind", "is_active"] } };
const SPONSORS = [
  { id: "s-1", name: "Aus Dolibarr GmbH", tier: "gold", source: "dolibarr", is_active: true, effective_status: "active", show_on_home: true, show_on_footer: true },
  { id: "s-2", name: "Von Hand AG", tier: "bronze", is_active: true, effective_status: "active" },
  { id: "s-3", name: "Archiv GmbH", tier: "silver", is_active: false, effective_status: "inactive" },
];
const PARTNERS = [
  { id: "p-1", slug: "aus-dolibarr", name: "Aus Dolibarr Verein", kind: "Verein", source: "dolibarr", is_active: true },
  { id: "p-2", slug: "von-hand", name: "Von Hand Verein", kind: "Messe", is_active: true },
];
const REFERENCES = Array.from({ length: 30 }, (_, index) => ({
  id: `r-${index}`, title: `Cup ${index}`, display_title: `Cup ${index}`, status: "completed", visibility: "public", is_active: index !== 1, order_index: 0, mode: "online",
  game_id: index % 2 ? "g-1" : "g-2", game: { display_name: index % 2 ? "Rocket League" : "Call of Duty" }, start_date: index === 29 ? "2024-02-02" : "2026-02-02",
  entries: [{ id: `e-${index}`, kind: "team", team_name: index === 7 ? "Löwen Sieben" : "THE LION SQUAD", member_profile_ids: [], lineup: [], lineup_members: [], placement: 2 }],
}));

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
      if (answer?.httpStatus) return json(answer.body, answer.httpStatus);
      return json(answer || { ok: true });
    }
    if (url.pathname === "/api/auth/me") return json(me);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    const answer = routes[url.pathname];
    if (answer !== undefined) return json(answer);
    if (url.pathname.endsWith("/queue")) return json({ on_track: [], next: [] });
    return json(/notifications|games$|nav$|site-banners|sponsors|partners|staff$|times$|guests$|events$|links$/.test(url.pathname) ? [] : {});
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

    test("Fast Lap bearbeiten: Meisterschaft, Punkte und Stream; Archivieren erst nach dem Veröffentlichen", async ({ page }) => {
      const calls = [];
      await mockApi(page, ROOT, { "/api/f1/challenges/c-1": CHALLENGE, "PATCH /api/f1/challenges/c-1": CHALLENGE }, calls);
      await page.goto("/admin/f1/c-1?track=t-2");
      await expect(page.getByTestId("f1-completed-hint")).toContainText("Saisonpunkte gibt es noch keine");
      await expect(page.locator('[data-testid="f1-status-select"] option[value="archived"]')).toBeDisabled();
      await expect(page.locator('[data-testid="f1-status-select"] option[value="registration_open"]')).toHaveCount(0);
      await expect(page.getByTestId("f1-export-csv")).toBeVisible();
      await expect(page.getByTestId("f1-edit-reg-enabled")).toHaveCount(0);
      await page.getByTestId("f1-edit-championship").check();
      await page.getByTestId("f1-edit-points").fill("10, 5");
      await page.getByTestId("f1-edit-stream-platform").selectOption("twitch");
      await page.getByTestId("f1-edit-stream-url").fill("probe");
      await page.getByTestId("f1-edit-stream-embed").check();
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.getByTestId("f1-edit-save").click();
      await expect.poll(() => calls.find((call) => call.method === "PATCH")?.body).toMatchObject({ is_championship: true, points_per_position: [10, 5], twitch_channel: "probe", has_live_stream: true });
    });

    test("öffentliche Seite: Kasten „Bedingungen“, kein Einreichungs-Versprechen", async ({ page }) => {
      await mockApi(page, null, {
        "/api/f1/challenges/monza": { ...CHALLENGE, is_championship: true, online_registration_enabled: true, registration_enabled: true, registration_open_from: "2026-01-01T10:00:00Z" },
        "/api/f1/challenges/c-1/leaderboard": BOARD,
        "/api/f1/challenges/c-1/championship": { standings: [] },
      }, []);
      await page.goto("/fastlap/monza");
      await expect(page.getByTestId("f1-condition-assists_allowed")).toContainText("Rennlinie");
      await expect(page.getByText("Meisterschaft", { exact: true })).toBeVisible();
      await expect(page.getByText(/Einreichung/)).toHaveCount(0);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
    });

    test("Strafen: Sprung in die Verwaltung und Zurücknehmen", async ({ page }) => {
      const calls = [];
      await mockApi(page, ROOT, { "/api/admin/penalties": { count: 2, counts: { all: 2, lap_penalty: 1, match_forfeit: 1 }, items: PENALTIES }, "PATCH /api/f1/times/lap-1": { id: "lap-1" } }, calls);
      await page.goto("/admin/penalties");
      await expect(page.getByTestId("pen-open-lap-1")).toHaveAttribute("href", "/admin/f1/c-1?track=t-2");
      await expect(page.getByTestId("pen-take-back-m-1")).toHaveCount(0);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.getByTestId("pen-take-back-lap-1").click();
      await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: "Zurücknehmen" }).click();
      await expect.poll(() => calls.find((call) => call.method === "PATCH")?.body).toEqual({ penalty_seconds: 0, is_invalid: false });
    });

    test("Meine Strafen: Rückfrage führt ins Kontaktformular", async ({ page }) => {
      await mockApi(page, RACER, { "/api/penalties/me": { count: 1, items: [PENALTIES[0]] }, "/api/contact/topics": [{ value: "fastlap", label: "Fast Lap" }, { value: "general", label: "Allgemein" }] }, []);
      await page.goto("/my/penalties");
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.getByTestId("penalty-question-lap-1").click();
      await expect(page).toHaveURL(/\/contact\?topic=fastlap/);
      await expect(page.getByTestId("contact-subject")).toHaveValue("Rückfrage zur Strafe: Monza Sprint · Monza");
    });

    test("Sponsoren: Dolibarr gesperrt, Archivieren, Löschen nennt den Grund, keine Bild-Wartung mehr", async ({ page }) => {
      const calls = [];
      await mockApi(page, ROOT, {
        "/api/admin/dolibarr/sponsors": SOURCE, "/api/sponsors/admin": SPONSORS,
        "DELETE /api/sponsors/s-2": { httpStatus: 409, body: { detail: "Dieser Sponsor wird noch verwendet: 1 Event." } },
      }, calls);
      await page.goto("/admin/sponsors");
      await expect(page.getByTestId("sponsor-delete-s-1")).toBeDisabled();
      await expect(page.getByTestId("sponsor-card-s-3")).toContainText("Archiviert");
      await expect(page.getByTestId("sponsor-vs-partner")).toContainText("Partner");
      await expect(page.getByText("Bilder prüfen")).toHaveCount(0);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.getByTestId("sponsor-restore-s-3").click();
      await expect.poll(() => calls.find((call) => call.path === "/api/sponsors/s-3")?.body).toEqual({ is_active: true });
      await page.getByTestId("sponsor-delete-s-2").click();
      await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: "Löschen" }).click();
      await expect(page.getByText("Dieser Sponsor wird noch verwendet: 1 Event.")).toBeVisible();
      await page.getByTestId("sponsor-card-s-2").locator("button").first().click();
      await expect(page.getByTestId("sponsor-contract-status")).toHaveCount(0);
      await expect(page.getByTestId("sponsor-placement-preview")).toContainText("Wird ausgespielt");
      expect(await overflow(page)).toBeLessThanOrEqual(1);
    });

    test("Partner aus Dolibarr: „Öffentlich zeigen“ und Löschen gesperrt, von Hand frei", async ({ page }) => {
      const calls = [];
      await mockApi(page, ROOT, { "/api/admin/dolibarr/sponsors": SOURCE, "/api/partners/admin": PARTNERS }, calls);
      await page.goto("/admin/partners");
      await expect(page.getByTestId("partner-delete-p-1")).toBeDisabled();
      await expect(page.getByTestId("partner-archive-p-1")).toHaveCount(0);
      await expect(page.getByTestId("partner-vs-sponsor")).toContainText("Sponsoren");
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.getByTestId("partner-card-p-1").locator("button").first().click();
      await expect(page.getByTestId("partner-locked-hint")).toContainText("Öffentlich zeigen");
      await expect(page.getByTestId("partner-active")).toBeDisabled();
      await page.getByTestId("partner-sheet-cancel").click();
      await page.getByTestId("partner-archive-p-2").click();
      await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: "Archivieren" }).click();
      await expect.poll(() => calls.find((call) => call.path === "/api/partners/p-2")?.body).toEqual({ is_active: false });
    });

    test("Referenzen: Suche, Filter und Seiten; Texte sagen, was öffentlich ist", async ({ page }) => {
      await mockApi(page, ROOT, {
        "/api/references/admin": { items: REFERENCES, summary: { total: 30 } }, "/api/games": [], "/api/membership/profiles/admin/all": [],
        "/api/references/admin/helpers": { platforms: [], formats: [], leagues: [], seasons: [], organizers: [], game_names: [], team_names: [], placement_labels: [], locations: [], auto: {} },
        "/api/reference-series/admin": { lineages: [] }, "/api/references/admin/checks": { items: [], checked: 0, settings: {} }, "/api/references/admin/showcase": { mode: "auto", reference_id: null },
      }, []);
      await page.goto("/admin/references");
      await expect(page.getByTestId("reference-page-info")).toHaveText("Seite 1 von 2");
      await expect(page.getByTestId("reference-row-r-25")).toHaveCount(0);
      await expect(page.getByTestId("reference-row-r-1")).toContainText("Archiviert");
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.getByTestId("reference-page-next").click();
      await expect(page.getByTestId("reference-row-r-25")).toBeVisible();
      await page.getByTestId("reference-search").fill("löwen sieben");
      await expect(page.getByTestId("reference-filter-count")).toHaveText("1 von 30 Referenzen");
      await expect(page.getByTestId("reference-row-r-7")).toBeVisible();
      await page.getByTestId("reference-search").fill("");
      await page.getByTestId("reference-filter-year").selectOption("2024");
      await expect(page.getByTestId("reference-row-r-29")).toBeVisible();
      await page.getByTestId("reference-edit-r-29").click();
      await page.getByTestId("reference-more").locator("summary, button").first().click();
      await expect(page.getByLabel(/Highlights \(öffentlich\)/)).toBeVisible();
      await expect(page.getByTestId("reference-internal-notes")).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(1);
    });

    test("Bild-Wartung steht unter System → Status", async ({ page }) => {
      await mockApi(page, ROOT, { "/api/uploads/audit-images": { summary: { local_ok: 7, missing_file: 2 } } }, []);
      await page.goto("/admin/settings/status");
      await page.getByTestId("image-audit-btn").click();
      await expect(page.getByTestId("image-audit-result")).toContainText("Datei fehlt");
      expect(await overflow(page)).toBeLessThanOrEqual(1);
    });
  });
}
