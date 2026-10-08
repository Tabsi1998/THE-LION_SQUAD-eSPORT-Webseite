const { test, expect } = require("@playwright/test");

// Mitgliedskarte offline (#1256): Karte laden, Netz weg - die zuletzt geladene Karte steht mit „Stand“ da, statt des
// Prüfcodes „Prüfcode braucht Netz“; gespeichert ist nur, was auf der Karte steht. Alles mit erfundenen Daten.

const member = { id: "u-luna", username: "lunabyte", display_name: "LunaByte", role: "player", is_club_member: true };
const card = () => ({
  status: "valid", club_name: "THE LION SQUAD", name: "LunaByte", member_number: "TLS-031", type_label: "Ordentliches Mitglied", member_since: "2024-03-01",
  valid_until: "2026-12-31", verify_url: "https://lionsquad.at/karte/pruefen/abcdEFGH1234", token_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
});

async function mockServer(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/auth/me") return json(member);
    if (path === "/membership/me") return json({ membership: { member_status: "active", member_number: "TLS-031", member_since: "2024-03-01" }, is_active_member: true, dolibarr: null });
    if (path === "/account/member-card") return json(card());
    if (path === "/seasonal/active") return json({ enabled: false, seasons: [] });
    const objects = ["/settings/public", "/membership/me/identity", "/membership/me/self-service", "/membership/me/website-profile", "/membership/me/consents", "/membership/me/directory"];
    return json(objects.includes(path) ? {} : []);
  });
}

for (const width of [390, 1440]) {
  test(`Karte laden, Netz aus, die Karte steht mit Stand da (${width} px)`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await mockServer(page);
    await page.goto("/members/membership");
    const art = page.getByTestId("member-card-art");
    await expect(art).toContainText("LunaByte");
    await expect(page.getByTestId("member-card-qr-box")).toBeVisible();
    const stored = await page.evaluate(() => window.localStorage.getItem("tls-member-card-v1"));
    expect(stored).toContain("TLS-031");
    expect(stored).not.toContain("abcdEFGH1234");

    await page.route("**/api/account/member-card", (route) => route.abort("internetdisconnected"));
    await context.setOffline(true);
    await expect(page.getByTestId("member-card-offline")).toContainText("Stand:");
    await expect(page.getByTestId("member-card-art-offline")).toContainText("Prüfcode braucht Netz");
    await expect(page.getByTestId("member-card-qr-box")).toHaveCount(0);
    await expect(art).toContainText("Nr. TLS-031");
    await context.setOffline(false);
  });
}
