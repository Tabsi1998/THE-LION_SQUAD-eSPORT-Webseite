const { test, expect } = require("@playwright/test");

// Mitgliederbereich (#283, #284, #1257, #1336): oben die eigene Karte mit Gruß und Beitragsstand, darunter die
// Sprungleiste mit dem, was offen ist (am Handy eine Zeile zum Wischen, am PC links fest), darunter nur Abschnitte mit
// Inhalt - interne Events aus der Event-Liste, Dokumente, Vorteile, interne News, Ansprechpartner. Ist nichts
// freigeschaltet, steht ein Satz statt leerer Karten. Kein Verweis überdeckt eine Überschrift (gemessen, nicht geschätzt).

const member = { id: "user-1", username: "lunabyte", display_name: "LunaByte", role: "player", is_club_member: true };

const MEMBERSHIP = {
  membership: { member_status: "active", member_number: "TLS-031", member_since: "2026-02-01", member_since_precision: "month", membership_type: "ordinary" },
  dolibarr: { led_by_dolibarr: true, type_label: "Ordentliches Mitglied", paid_until: "2026-12-31", fee: { status: "paid", required: true, amount: 36, currency: "EUR" }, as_of: "2026-10-01T08:00:00Z" },
};

const MEETING = {
  id: 7, kind: "general", kind_label: "Generalversammlung", title: "Generalversammlung 2099", day: "2099-10-24", time: "18:00", place: "Vereinsheim",
  format_label: "vor Ort und online", response: "", response_label: "noch keine Antwort", can_respond: true,
};

const SUMMARY = { meetings_open: 1, ballots_open: 0, next_meeting: MEETING, helping_free: 6, helping_mine: 0, news_new: 1, documents: 2, documents_new: 1 };

const HELPING = {
  available: true, my_count: 0, open_places: 6, events: [
    { id: 5, label: "Sommerfest 2099", day: "2099-07-10", place: "Vereinsheim", upcoming: true, open_places: 4, mine: [] },
    { id: 6, label: "LAN-Party 2099", day: "2099-11-14", place: "Turnhalle", upcoming: true, open_places: 2, mine: [] },
  ],
};

const events = [
  { id: "e-lan", name: "LAN für alle", slug: "lan-fuer-alle", visibility: "public", status: "announced", start_date: "2099-09-18T10:00:00Z" },
  { id: "e-hallo", name: "Halloween Gaming Night 2099", slug: "halloween-2099", visibility: "members", status: "announced", start_date: "2099-10-31T18:00:00Z", end_date: "2099-11-01T02:00:00Z", location: "Vereinsheim" },
];

const DOCUMENTS = [
  { id: "d-1", title: "Statuten 2026", original_filename: "statuten.pdf", created_at: "2026-01-10T10:00:00Z" },
  { id: "d-2", title: "Protokoll Generalversammlung", original_filename: "protokoll.pdf", created_at: "2026-03-10T10:00:00Z" },
];

const NEWS = [
  { id: "n-1", slug: "intern-1", title: "Nur für Mitglieder", visibility: "members", created_at: "2026-09-01T10:00:00Z" },
  { id: "n-2", slug: "public-1", title: "Für alle", visibility: "public", created_at: "2026-09-02T10:00:00Z" },
];

const BOARD = [
  { id: "p-1", display_title: "Obfrau", is_active: true, user: { display_name: "Mira Muster", profile_url: "/members/mira" } },
  { id: "p-2", display_title: "Kassier:in", is_active: true, user: { display_name: "Ole Beispiel", profile_url: "/members/ole" } },
];

const json = (body) => ({ contentType: "application/json", body: JSON.stringify(body) });

async function mockServer(page, { eventList = [], board = [], documents = [], news = [], benefits = [], settings = {}, me = { membership: { member_number: "TLS-007", member_since: "2024-03-01", member_since_precision: "day" } }, summary = {}, helping = { available: false }, onAnswer = null } = {}) {
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill(json(member)));
  await page.route("**/api/settings/public", (route) => route.fulfill(json(settings)));
  await page.route("**/api/membership/me", (route) => route.fulfill(json(me)));
  await page.route("**/api/membership/area-summary", (route) => route.fulfill(json(summary)));
  await page.route("**/api/membership/me/helper-shifts", (route) => route.fulfill(json(helping)));
  await page.route("**/api/membership/me/meetings/*/response", async (route) => {
    const body = route.request().postDataJSON();
    if (onAnswer) onAnswer(body);
    return route.fulfill(json({ ...MEETING, response: body.response, response_label: body.response === "yes" ? "zugesagt" : body.response === "no" ? "abgesagt" : "vielleicht" }));
  });
  await page.route("**/api/membership/benefits", (route) => route.fulfill(json(benefits)));
  await page.route(/\/api\/documents(\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    // Im Mitgliederbereich nur die Vereinsdokumente (#1255) - die eigenen Unterlagen stehen im Profil.
    expect(url.searchParams.get("scope")).toBe("club");
    return route.fulfill(json(documents));
  });
  await page.route("**/api/news", (route) => route.fulfill(json(news)));
  await page.route("**/api/board?**", (route) => route.fulfill(json(board)));
  await page.route("**/api/events?**", (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("upcoming")).toBe("true");
    return route.fulfill(json(eventList));
  });
}

async function acceptCookies(page) {
  const consent = page.getByRole("button", { name: /alle erlauben/i });
  if (await consent.count()) await consent.click();
}

const FULL = { eventList: events, board: BOARD, documents: DOCUMENTS, news: NEWS, me: MEMBERSHIP, summary: SUMMARY, helping: HELPING, settings: { discord_invite_url: "https://discord.com/invite/lions" } };

test("ein Mitglieder-Event steht im Mitgliederbereich, ein öffentliches nicht; keine Kacheln mehr", async ({ page }) => {
  await mockServer(page, { eventList: events });
  await page.goto("/members/area");
  await acceptCookies(page);

  await expect(page.getByTestId("member-area-event-e-hallo")).toContainText("Halloween Gaming Night 2099");
  await expect(page.getByTestId("member-area-event-e-hallo")).toContainText("Vereinsheim");
  await expect(page.getByTestId("member-area-event-e-hallo")).toHaveAttribute("href", "/events/halloween-2099");
  await expect(page.getByTestId("member-area-event-e-lan")).toHaveCount(0);
  await expect(page.locator('[data-testid^="tile-"]')).toHaveCount(0);
  await expect(page.getByTestId("member-area-empty")).toHaveCount(0);
  await expect(page.getByTestId("member-area-news")).toHaveCount(0);
  await expect(page.getByTestId("member-area-links")).toContainText("Versammlung");
});

test("ist nichts freigeschaltet, steht ein Satz statt leerer Karten", async ({ page }) => {
  await mockServer(page, { eventList: [events[0]] });
  await page.goto("/members/area");
  await acceptCookies(page);

  await expect(page.getByTestId("member-area-empty")).toBeVisible();
  await expect(page.getByTestId("member-area-events")).toHaveCount(0);
  await expect(page.getByTestId("member-area-documents")).toHaveCount(0);
  await expect(page.getByTestId("member-area-benefits")).toHaveCount(0);
  await expect(page.getByTestId("member-area-board")).toHaveCount(0);
  // Ohne gültige Mitgliedschaft keine Karte - nur der Gruß.
  await expect(page.getByTestId("member-area-greeting")).toHaveText("Hallo, LunaByte");
  await expect(page.getByTestId("member-area-card")).toHaveCount(0);
});

test("Dokumente, interne News, Ansprechpartner und der Discord-Link erscheinen, sobald es sie gibt", async ({ page }) => {
  await mockServer(page, {
    documents: [{ id: "d-1", title: "Statuten 2026", original_filename: "statuten.pdf" }],
    news: NEWS,
    board: [{ id: "p-1", display_title: "Obmann", is_active: true, user: { display_name: "Lion Boss", profile_url: "/members/lion-boss" } }],
    settings: { discord_invite_url: "https://discord.com/invite/lions" },
  });
  await page.goto("/members/area");
  await acceptCookies(page);

  await expect(page.getByTestId("member-area-documents")).toContainText("Statuten 2026");
  await expect(page.getByTestId("member-area-news")).toContainText("Nur für Mitglieder");
  await expect(page.getByTestId("member-area-news")).not.toContainText("Für alle");
  await expect(page.getByTestId("member-area-board")).toContainText("Obmann");
  await expect(page.getByTestId("member-area-board")).toContainText("Lion Boss");
  await expect(page.getByTestId("member-area-discord")).toHaveAttribute("href", "https://discord.com/invite/lions");
  await expect(page.getByTestId("member-area-empty")).toHaveCount(0);
});

/** Rechteck eines Elements - für „überdeckt nichts“ und „steht links daneben“. */
async function box(locator) {
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  return rect;
}

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

for (const width of [390, 768, 1440, 2560]) {
  test.describe(`Mitgliederbereich bei ${width} px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 1000 } });

    test(`Karte oben, Sprungleiste, kein Verweis über einer Überschrift (${width})`, async ({ page }) => {
      await mockServer(page, FULL);
      await page.goto("/members/area");
      await acceptCookies(page);

      await expect(page.getByTestId("member-area-card")).toBeVisible();
      await expect(page.getByTestId("member-area-greeting")).toHaveText("Hallo, LunaByte");
      await expect(page.getByTestId("member-area-fee")).toHaveText("Beitrag bezahlt");
      const bar = page.getByTestId("member-area-links");
      await expect(bar.getByTestId("member-area-jump-versammlung")).toHaveText("Versammlung · 1 offen");
      await expect(bar.getByTestId("member-area-jump-helfen")).toHaveText("Helfen · 6 frei");
      await expect(bar.getByTestId("member-area-jump-news")).toHaveText("News · 1 neu");
      await expect(bar.getByTestId("member-area-jump-dokumente")).toHaveText("Dokumente · 1 neu");
      await expect(bar.getByTestId("member-area-jump-karte")).toHaveText("Karte");
      await expect(page.getByTestId("member-area-board")).toContainText("Mira Muster");

      const items = await bar.locator(".tls-area-jump__item").all();
      const rects = [];
      for (const item of items) rects.push(await box(item));
      const content = await box(page.getByTestId("member-area-meetings"));
      const barBox = await box(bar);
      if (width >= 1280) {
        // PC: die Leiste steht links fest neben den Abschnitten, Eintrag unter Eintrag.
        expect(barBox.x + barBox.width).toBeLessThanOrEqual(content.x);
        for (let i = 1; i < rects.length; i += 1) expect(rects[i].y).toBeGreaterThan(rects[i - 1].y);
      } else {
        // Handy und Tablet: eine Zeile zum Wischen über den Abschnitten.
        for (const rect of rects) expect(Math.abs(rect.y - rects[0].y)).toBeLessThanOrEqual(1);
        expect(barBox.y + barBox.height).toBeLessThanOrEqual(content.y);
      }

      // Kein Verweis („Alle …“, „Vorstand“) überdeckt seine Überschrift - auch nicht in der schmalen Spalte rechts.
      for (const section of ["member-area-meetings", "member-area-helping", "member-area-news", "member-area-documents", "member-area-events", "member-area-board"]) {
        const title = await box(page.getByTestId(`${section}-title`));
        const more = await box(page.getByTestId(`${section}-more`));
        expect(overlaps(title, more), `${section}: Titel und Verweis überlappen`).toBe(false);
      }

      // Gold nur an Karte und Strich: Verweise sind Cyan.
      for (const testId of ["member-area-board-more", "member-area-my-membership"]) {
        const color = await page.getByTestId(testId).evaluate((element) => getComputedStyle(element).color);
        expect(color, testId).toBe("rgb(41, 182, 232)");
      }

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("Handy (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Zusage zur Versammlung direkt in der Karte - die Zahl in der Leiste geht weg", async ({ page }) => {
    const answers = [];
    await mockServer(page, { ...FULL, onAnswer: (body) => answers.push(body.response) });
    await page.goto("/members/area");
    await acceptCookies(page);

    const card = page.getByTestId("member-area-meeting-7");
    await expect(card).toContainText("Generalversammlung 2099");
    await expect(card.getByTestId("member-area-date-tile")).toContainText("Okt");
    await page.getByTestId("member-area-answer-yes").click();
    await expect(page.getByTestId("member-area-answer")).toHaveText("Deine Antwort: zugesagt");
    expect(answers).toEqual(["yes"]);
    await expect(page.getByTestId("member-area-jump-versammlung")).toHaveText("Versammlung");
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/members\/area$/);
  });

  test("die Leiste bleibt beim Scrollen unter dem Kopf stehen; ein Tipp springt zum Abschnitt", async ({ page }) => {
    await mockServer(page, FULL);
    await page.goto("/members/area");
    await acceptCookies(page);
    const bar = page.getByTestId("member-area-links");
    await expect(bar.getByTestId("member-area-jump-dokumente")).toBeVisible();
    await bar.getByTestId("member-area-jump-dokumente").click();
    await expect(bar.getByTestId("member-area-jump-dokumente")).toHaveAttribute("data-active", "1");
    await expect.poll(async () => (await box(page.getByTestId("member-area-documents"))).y).toBeLessThan(200);
    const barBox = await box(bar);
    const header = await box(page.getByTestId("site-header"));
    expect(Math.abs(barBox.y - (header.y + header.height))).toBeLessThanOrEqual(1);
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/members\/area#dokumente$/);
  });
});
