const { test, expect } = require("@playwright/test");

// Jahreswertung und Gewinne im Admin (#2123) bei 390 und 1440 px: Abschließen nur mit Vorschau, Löschen nur beim
// Entwurf, Korrekturen mit Grund; Gewinne ohne Frist bis „Bereit“, „Wieder öffnen“ bei verfallenen. Konto und API
// sind Attrappen im Browser - geprüft wird, was die Oberfläche zeigt und an den Server schickt.

const SEASONS = [
  { id: "s-a", slug: "jw-2026", name: "Jahreswertung 2026", status: "active", kind: "season", drop_worst: 1 },
  { id: "s-d", slug: "jw-2027", name: "Jahreswertung 2027", status: "draft", kind: "season" },
];
const PREVIEW = { season: { id: "s-a", name: "Jahreswertung 2026" }, ranked: 2, awards_total: 1, finished: false, standings: [
  { rank: 1, user_id: "u1", display_name: "Anna Beispiel", points: 320, awards: [{ code: "season_wins_1", name: "Saisonmeister" }] },
  { rank: 2, user_id: "u2", display_name: "Bert Beispiel", points: 210, awards: [] },
] };
const PRIZES = [
  { id: "p-open", tournament_title: "Herbst-Cup", place: 1, prize_label: "1. Platz", prize_value: "Pokal", status: "pending", pickup_deadline: null, recipient_label: "Anna Beispiel", recipient_type: "user" },
  { id: "p-old", tournament_title: "Sommer-Cup", place: 2, prize_label: "2. Platz", prize_value: "Kappe", status: "expired", pickup_deadline: "2026-07-01T00:00:00+00:00", recipient_label: "Löwen", recipient_type: "team" },
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
    if (request.method() !== "GET") {
      calls.push({ method: request.method(), path, body: request.postData() ? request.postDataJSON() : null });
      return json({ ok: true });
    }
    const table = {
      "/seasons": SEASONS,
      "/seasons/s-a/completion-preview": PREVIEW,
      "/seasons/s-a/adjustments": [{ id: "adj-1", recipient_label: "Cleo Beispiel", total_points: -10, bonus_reason: "Regelverstoß beim Cup" }],
      "/admin/people/search": [{ id: "u3", name: "Cleo Beispiel", context: "Mitglied" }],
      "/prizes": PRIZES,
    };
    if (path in table) return json(table[path]);
    const list = path.includes("/notifications") || path.endsWith("/games") || path.startsWith("/tournaments") || path.startsWith("/f1");
    return json(list ? [] : {});
  });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const width of [390, 1440]) {
  test.describe(`Jahreswertung und Gewinne bei ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("Abschließen nur nach der Vorschau, Löschen nur beim Entwurf", async ({ page }) => {
      const calls = [];
      await mockAdmin(page, calls);
      await page.goto("/admin/seasons");
      await expect(page.getByTestId("season-complete-s-a")).toBeVisible();
      await expect(page.getByTestId("season-complete-s-d")).toHaveCount(0);
      await expect(page.getByTestId("season-delete-s-a")).toHaveCount(0);
      await expect(page.getByTestId("season-delete-s-d")).toBeVisible();
      await noSideScroll(page);

      await page.getByTestId("season-complete-s-a").click();
      const preview = page.getByTestId("season-complete-preview");
      await expect(preview).toContainText("2 Plätze · 1 Erfolg beim Abschluss");
      await expect(preview).toContainText("Saisonmeister");
      expect(calls).toEqual([]);
      await page.getByTestId("season-complete-submit").click();
      await expect.poll(() => calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /seasons/s-a/complete"]);
    });

    test("Korrektur mit Grund, keine Fallback-Tabelle, kein „Abgeschlossen“ im Status", async ({ page }) => {
      const calls = [];
      await mockAdmin(page, calls);
      await page.goto("/admin/seasons");
      await page.getByTestId("season-edit-s-a").click();
      await expect(page.getByTestId("season-sheet")).toBeVisible();
      await expect(page.getByTestId("season-points")).toHaveCount(0);
      await expect(page.getByTestId("season-status").locator("option")).toHaveText(["Entwurf", "Aktiv", "Archiv"]);
      await expect(page.getByTestId("season-adjust-list")).toContainText("Regelverstoß beim Cup");
      await page.getByTestId("season-adjust-person-search").fill("Cleo");
      await page.getByTestId("season-adjust-person-option-u3").click();
      await page.getByTestId("season-adjust-points").fill("-5");
      await expect(page.getByTestId("season-adjust-submit")).toBeDisabled();
      await page.getByTestId("season-adjust-reason").fill("Unsportliches Verhalten");
      await page.getByTestId("season-adjust-submit").click();
      await expect.poll(() => calls.find((c) => c.path === "/seasons/s-a/adjustments")?.body)
        .toEqual({ user_id: "u3", points: -5, reason: "Unsportliches Verhalten" });
      await noSideScroll(page);
    });

    test("Gewinne: offen ohne Frist, verfallen lässt sich wieder öffnen", async ({ page }) => {
      const calls = [];
      await mockAdmin(page, calls);
      await page.goto("/admin/prizes");
      const mobile = width < 768;
      const open = page.getByTestId(mobile ? "prize-mobile-p-open" : "prize-row-p-open");
      await expect(open).toContainText("ab „Bereit“");
      await page.getByTestId(mobile ? "prize-mobile-reopen-p-old" : "prize-reopen-p-old").click();
      await expect.poll(() => calls.find((c) => c.path === "/prizes/p-old")?.body).toEqual({ status: "ready", notes: "" });
      await expect(page.getByText("Wieder geöffnet – neue Abholfrist, der Gewinner bekommt Bescheid.")).toBeVisible();
      await noSideScroll(page);
    });
  });
}
