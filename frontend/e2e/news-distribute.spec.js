const { test, expect } = require("@playwright/test");

// Verteilen (#1359): die Redaktion sendet den Newsletter direkt aus dem News-Editor - mit Rückfrage, danach steht
// „gesendet am … an …“. Am Handy ist der Kasten zugeklappt. Bei 390, 768 und 1440 px; der Versand ist eine Attrappe.

const WIDTHS = [["handy", 390, 844], ["tablet", 768, 1024], ["pc", 1440, 900]];
const EDITOR = { id: "u-red", username: "rita", display_name: "Rita Redaktion", role: "player", areas: ["content"], mfa_enabled: true, auth_mfa_verified: true };
const POST = { id: "n-1", slug: "herbst-lan-plan", title: "Herbst-LAN: Plan und Turniere stehen", excerpt: "Alles zur Herbst-LAN.", content: "Der Plan steht.", category: "verein",
  visibility: "public", published: true, published_at: "2026-10-05T16:00:00+02:00", discord_skip: false };

function box(sent) {
  return { kind: "news", source_id: "n-1", title: POST.title, visibility: "public", state: sent ? "sent" : "ready", recipients: 214,
    sent_at: sent ? "2026-10-08T09:30:00+00:00" : null, sent_count: sent ? 214 : 0, can_send: true, can_resend: true,
    announcement: "Keine eigene Meldung – öffentliche Beiträge gehen über Newsletter und Discord." };
}

async function mockApi(page, state) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() === "POST" && url.pathname === "/api/settings/newsletter/send") {
      state.sent = request.postDataJSON();
      return json({ ok: true, queued: 214 });
    }
    if (request.method() !== "GET") return json({ ok: true });
    if (url.pathname === "/api/auth/me") return json(EDITOR);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (url.pathname === "/api/admin/news") return json([POST]);
    if (url.pathname === "/api/news-meta") return json({ categories: [{ key: "verein", label: "Verein" }] });
    if (url.pathname === "/api/settings/newsletter/state") return json(box(Boolean(state.sent)));
    const list = /notifications|games$|nav$|site-banners|sponsors|partners|tournaments|challenges|events/.test(url.pathname);
    return json(list ? [] : {});
  });
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
      await page.setViewportSize({ width, height });
    });

    test("Redaktion sendet den Newsletter aus dem News-Editor", async ({ page }) => {
      const state = { sent: null };
      await mockApi(page, state);
      await page.goto("/admin/news/n-1");
      const toggle = page.getByTestId("distribute-toggle");
      await expect(toggle).toBeVisible();
      if (width < 768) {
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await toggle.click();
      }
      await expect(page.getByTestId("distribute-newsletter-line")).toContainText("geht an 214 Personen");
      await page.getByTestId("distribute-send").click();
      await expect(page.getByTestId("confirm-dialog")).toContainText("214 Personen");
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect.poll(() => state.sent).toEqual({ kind: "news", id: "n-1", force: false });
      await expect(page.getByTestId("distribute-newsletter-line")).toContainText("an 214 Personen.");
      await expect(page.getByTestId("distribute-newsletter-line")).toContainText("Gesendet am");
      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(2);
    });
  });
}
