const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Anmeldungen & Einlass (#1372): an der Tür (390 px) Name tippen, „Da“, der Zähler stimmt sofort; am PC (1440 px)
// Liste mit Details rechts und „Nachricht an alle“ mit Vorschau und Bestätigung. Die API ist nachgestellt, die Namen
// sind erfunden. Mit E2E_SCREENS_DIR legt der Test zusätzlich Bilder für den PR ab.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const NAMES = ["Paula Brünner", "Max Mustermann", "Zoë Adler", "Kemal Yıldız", "Lena Hofer", "Jonas Berger", "Mira Novak", "Tobias Rainer"];

function rows() {
  return NAMES.map((name, index) => ({
    id: `r${index + 1}`, display_name: name, status: index < 2 ? "checked_in" : index === 7 ? "waitlist" : "registered",
    companion_count: index === 0 ? 1 : index === 4 ? 2 : 0, seat_count: index === 0 ? 2 : index === 4 ? 3 : 1,
    email_masked: `${name[0].toLowerCase()}***@example.test`, has_note: index === 2, created_at: "2026-10-01T16:00:00+00:00",
  })).sort((a, b) => a.display_name.localeCompare(b.display_name, "de"));
}

async function screenshot(page, testInfo, name) {
  const body = await page.screenshot({ fullPage: false });
  await testInfo.attach(name, { body, contentType: "image/png" });
  if (process.env.E2E_SCREENS_DIR) await page.screenshot({ path: path.join(process.env.E2E_SCREENS_DIR, name), fullPage: false });
}

async function setup(page) {
  await page.clock.setFixedTime(new Date("2026-10-18T07:40:00+00:00"));
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const state = { rows: rows(), patches: [], messages: [], sent: null };
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/auth/me") return route.fulfill(json({ id: "s1", username: "leitung", display_name: "Turnierleitung", role: "tournament_admin", areas: [] }));
    if (url.pathname === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (url.pathname === "/api/events/herbst-lan/lead") {
      return route.fulfill(json({
        event: { id: "e1", slug: "herbst-lan", name: "Herbst-LAN 2026", start_date: "2026-10-18T08:00:00+00:00", max_participants: 20, allow_companions: true, max_companions_per_registration: 2 },
        counts: {}, registrations: state.rows, can_message: true, message_recipients: state.rows.filter((row) => row.status !== "waitlist").length, messages: state.messages,
      }));
    }
    const patch = url.pathname.match(/^\/api\/events\/e1\/registrations\/(r\d+)$/);
    if (patch && request.method() === "PATCH") {
      const body = request.postDataJSON();
      state.patches.push({ id: patch[1], ...body });
      state.rows = state.rows.map((row) => (row.id === patch[1] ? { ...row, ...body } : row));
      return route.fulfill(json({ id: patch[1], ...body }));
    }
    if (url.pathname === "/api/events/e1/lead/message" && request.method() === "POST") {
      state.sent = request.postDataJSON();
      state.messages = [{ id: "m1", text: state.sent.text, recipient_count: state.sent.confirm_count, actor_name: "Turnierleitung", created_at: "2026-10-18T07:41:00+00:00" }];
      return route.fulfill(json({ message_id: "m1", recipient_count: state.sent.confirm_count, notified: state.sent.confirm_count, mails: 5 }));
    }
    return route.fulfill(json([]));
  });
  return state;
}

test.describe("Anmeldungen & Einlass", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  test("an der Tür: Name tippen, „Da“, Zähler stimmt sofort", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await setup(page);
    await page.goto("/events/herbst-lan/leitung");

    await expect(page.getByTestId("event-lead-counter")).toHaveText("2 von 7 da");
    await expect(page.getByTestId("event-lead-filter-open")).toHaveAttribute("aria-pressed", "true");
    await screenshot(page, testInfo, "einlass-390.png");

    await page.getByTestId("event-lead-search").fill("zoe");
    await expect(page.getByTestId(/^event-lead-row-/)).toHaveCount(1);
    await page.getByTestId("event-lead-checkin-r3").click();
    await expect(page.getByTestId("event-lead-counter")).toHaveText("3 von 7 da");
    await expect(page.getByTestId("event-lead-undo-bar")).toContainText("Zoë Adler ist da.");
    await expect(page.getByTestId("event-lead-search")).toHaveValue("");
    expect(state.patches).toEqual([{ id: "r3", status: "checked_in" }]);
    await screenshot(page, testInfo, "einlass-390-rueckgaengig.png");

    await page.getByTestId("event-lead-undo-last").click();
    await expect(page.getByTestId("event-lead-counter")).toHaveText("2 von 7 da");
    expect(state.patches.at(-1)).toEqual({ id: "r3", status: "registered" });
  });

  test("am PC: Details rechts und Nachricht an alle mit Bestätigung", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const state = await setup(page);
    await page.goto("/events/herbst-lan/leitung");

    await page.getByTestId("event-lead-filter-all").click();
    await page.getByTestId("event-lead-name-r1").click();
    const aside = page.getByTestId("event-lead-aside");
    await expect(aside.getByTestId("event-lead-mail")).toHaveText("p***@example.test");
    await screenshot(page, testInfo, "anmeldungen-1440.png");

    await page.getByTestId("event-lead-message-open").click();
    await expect(page.getByTestId("event-lead-message-preview")).toContainText("Geht an 7 Angemeldete");
    await page.getByText("Der Parkplatz ist gesperrt – bitte den Hintereingang nehmen.").click();
    await page.getByTestId("event-lead-message-next").click();
    await expect(page.getByTestId("event-lead-message-confirm")).toContainText("Wirklich an 7 Personen senden?");
    await screenshot(page, testInfo, "nachricht-1440.png");
    expect(state.sent).toBeNull();
    await page.getByTestId("event-lead-message-send").click();
    await expect(page.getByTestId("event-lead-message")).toHaveCount(0);
    expect(state.sent).toEqual({ text: "Der Parkplatz ist gesperrt – bitte den Hintereingang nehmen.", confirm_count: 7 });
    await expect(page.getByTestId("event-lead-log")).toContainText("Der Parkplatz ist gesperrt");
  });
});
