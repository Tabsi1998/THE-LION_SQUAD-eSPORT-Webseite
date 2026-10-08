const { test, expect } = require("@playwright/test");

// Die Vereinsseiten aus Meilenstein 79, gemessen statt geschätzt - bei 390, 768, 1440 und 2560 px:
// - Über uns (#1253, #1333): kein seitliches Scrollen, Zeitstrahl und Werte da, Spielnamen nie mit „…“; /values → #werte.
// - Vorstand (#1332): Porträts höchstens 280 px breit, die offene Funktion lädt zum Mitmachen ein, Statuten für alle.
// - Erfolge & Referenzen (#1334): die Vitrine mit 2 / 3 / 5 Pokalen je Reihe.
// - Sponsoren (#1254): „Sponsor werden“ am Handy als Karten, am PC als Tabelle.
// - Mitglied werden (#1335): der goldene Knopf mit genug Kontrast (axe und nachgerechnet), mit „Bewegung reduzieren“ ohne
//   Lichtlauf über die Karte.
// Alle Daten sind erfunden.

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const upload = (name) => `/api/static/uploads/${name}`;

const ABOUT = {
  texts: {
    hero_eyebrow: "Über uns", hero_title: "", hero_text: "Ein eingetragener eSports-Verein: wir spielen gemeinsam, organisieren Turniere und treffen uns auch offline.",
    values_title: "Mehr als nur Zocken", values_text: "Gemeinschaft, Spaß und Zusammenhalt.",
    values: [
      { title: "Fairplay", text: "Wir gratulieren auch, wenn wir verlieren.", example: "Nach jedem Match ein „GG“." },
      { title: "Rudel-Mentalität", text: "Niemand wird zurückgelassen.", example: "Neue spielen ihr erstes Turnier im Team." },
      { title: "Ambition", text: "Spaß zuerst – aber wir wollen besser werden.", example: "Einmal im Monat Replay-Analyse." },
    ],
    goals: ["**Eine Heimat schaffen** für eSports-Begeisterte.", "**Vereinsevents** online und offline."],
    timeline: [
      { year: "2023", title: "Gründung in Musterdorf", text: "Sieben Leute, ein Discord, eine Idee.", image_url: "" },
      { year: "2024", title: "Erste LAN", text: "42 Gäste, zwei Turniere.", image_url: upload("lan.png") },
      { year: "2025", title: "Erster Podestplatz", text: "Bronze in der Racing-Liga.", image_url: "" },
    ],
    club_photo: { url: upload("verein.png"), focus_x: 50, focus_y: 40 },
    games_title: "Vom Casual bis zum Cup", games_text: "Wir spielen, worin wir auch antreten.",
    offline_title: "Gaming endet nicht am Bildschirm", offline_text: "Grillabende und LAN-Partys.", offline_items: ["Grillabende"],
    cta_title: "Du willst Teil des Rudels werden?", cta_text: "Registriere dich und lerne uns kennen.",
  },
  organization: { name: "Beispielverein", founded_year: 2023, founded_on: "2023-03-01", nonprofit: true, source: "manual" },
  numbers: { members: 42, tournaments_completed: 14, prizes: 25, years_active: 3 },
  numbers_shown: ["prizes", "tournaments_completed", "members", "years_active"],
  games: [
    { id: "g-ssb", name: "Super Smash Bros. Ultimate", slug: "super-smash-bros-ultimate", short_name: "SSB", cover_url: upload("ssb.png"), tournaments: 1, references: 0 },
    { id: "g-mk", name: "Mario Kart 8 Deluxe", slug: "mario-kart-8-deluxe", short_name: "MK8", cover_url: upload("mk.png"), tournaments: 3, references: 0 },
    { id: "g-cod", name: "Call of Duty: Black Ops Six Ranked Playlist", slug: "call-of-duty", short_name: "COD", cover_url: upload("cod.png"), tournaments: 3, references: 16 },
    { id: "g-pal", name: "Palworld", slug: "palworld", short_name: "PAL", cover_url: "", tournaments: 0, references: 0 },
  ],
  offline_events: [],
};

const BOARD = [
  { id: "p-obmann", slug: "obmann", title_male: "Obmann", title_female: "Obfrau", display_title: "Obmann", neutral_title: "Obmann/Obfrau", allow_deputy: false, is_active: true, order_index: 1,
    user: { id: "cp-leo", display_name: "Leo Beispiel", gamertag: "LeoLöwe", avatar_url: upload("leo.png"), photo_url: upload("leo.png"), photo_cutout: true, profile_url: "/members/leoloewe" } },
  { id: "p-kassier", slug: "kassier", title_male: "Kassier", title_female: "Kassierin", display_title: "Kassierin", neutral_title: "Kassier:in", allow_deputy: false, is_active: true, order_index: 2,
    user: { id: "cp-mira", display_name: "Mira Muster", gamertag: "MiraMaus", avatar_url: upload("mira.png"), photo_url: upload("mira.png"), photo_cutout: false, profile_url: "/members/miramaus" } },
  { id: "p-jugend", slug: "jugendreferent", title_male: "Jugendreferent", title_female: "Jugendreferentin", display_title: "Jugendreferent", neutral_title: "Jugendreferent:in", allow_deputy: false, is_active: true, order_index: 10,
    user: null, vacant: true, vacancy_text: "Zwei Stunden im Monat – du planst Turniere für Jugendliche." },
];

const STATUTES = { available: true, source: "dolibarr", state: "in_force", current: { id: 3, version: 2, decided_on: "2025-11-20", valid_from: "2026-01-01", state: "in_force" }, versions: [{ id: 3, version: 2, decided_on: "2025-11-20", valid_from: "2026-01-01", state: "in_force" }], pdf_url: "/api/board/statutes/3/pdf" };

const reference = (id, placement, day) => ({ id, title: `Cup ${id}`, tournament_name: `Cup ${id}`, placement, best_placement: placement, start_date: day, season: day.slice(0, 4),
  game: { id: "g-mk", name: "Mario Kart 8 Deluxe", short_name: "MK8" }, entries: [{ id: `${id}-solo`, kind: "solo", placement, participant_count: 12, lineup_members: [] }] });
const REFERENCES = {
  summary: { total: 7, podiums: 7, games: 1, gold: 3, silver: 2, bronze: 2, seasons: ["2026", "2025"] },
  items: [reference("r1", 1, "2026-05-01"), reference("r2", 2, "2026-04-01"), reference("r3", 3, "2026-03-01"), reference("r4", 1, "2025-11-01"),
    reference("r5", 2, "2025-10-01"), reference("r6", 3, "2025-09-01"), reference("r7", 1, "2025-08-01")],
};

const OFFER = {
  available: true, intro: "Mit eurer Hilfe bleiben Startgelder niedrig und Preise fair.",
  numbers: [{ value: "214", label: "im Discord" }, { value: "3", label: "LANs im Jahr" }], tiers: ["gold", "silver", "bronze"],
  benefits: [{ label: "Logo auf TV und Beamer bei jeder LAN", tiers: ["gold"] }, { label: "Logo im Laufband der Fußzeile", tiers: ["gold", "silver", "bronze"] }],
  pdf_url: "",
};

const FEES = { available: true, stale: false, as_of: "2026-10-07T08:00:00Z", purpose: "", fees: [
  { id: 2, label: "Ordentliches Mitglied", description: "Mit Stimmrecht", amount: 60, currency: "EUR", period_label: "je Jahr", subscription_required: true, admission_fee: 0 },
  { id: 3, label: "Ermäßigt", description: "Schüler, Lehrlinge, Studierende", amount: 30, currency: "EUR", period_label: "je Jahr", subscription_required: true, admission_fee: 0 },
] };

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mockServer(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 864e5 }));
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path.startsWith("/static/uploads/")) return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    if (path === "/auth/me") return route.fulfill(json({ detail: "Nicht angemeldet" }, 401));
    if (path === "/settings/public") return route.fulfill(json({ club_name: "Beispielverein" }));
    if (path === "/seasonal/active") return route.fulfill(json({ enabled: false, preview: false, weather: null, seasons: [] }));
    if (path === "/home/about") return route.fulfill(json(ABOUT));
    if (path === "/board") return route.fulfill(json(BOARD));
    if (path === "/board/statutes") return route.fulfill(json(STATUTES));
    if (path === "/references") return route.fulfill(json(REFERENCES));
    if (path === "/sponsoring/offer") return route.fulfill(json(OFFER));
    if (path === "/membership/fees") return route.fulfill(json(FEES));
    if (path === "/membership/join-page") return route.fulfill(json({ benefits: [], fee_purpose: "" }));
    return route.fulfill(json([]));
  });
}

async function noSideScroll(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

async function box(locator) {
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  return rect;
}

/** Relative Leuchtdichte nach WCAG aus „rgb(…)“. */
function luminance(color) {
  const [r, g, b] = color.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

for (const width of [390, 768, 1440, 2560]) {
  test.describe(`Vereinsseiten bei ${width} px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 1000 } });

    test(`Über uns: Zeitstrahl, Werte, Spielnamen ohne „…“ (${width})`, async ({ page }) => {
      await mockServer(page);
      await page.goto("/about");
      await expect(page.getByTestId("about-timeline")).toBeVisible();
      await expect(page.getByTestId("about-timeline-2")).toContainText("Erster Podestplatz");
      await expect(page.getByTestId("about-values")).toContainText("Rudel-Mentalität");
      const shelf = page.getByTestId("about-game-competitive");
      await expect(shelf).toBeVisible();
      for (const game of ABOUT.games.filter((entry) => entry.tournaments + entry.references > 0)) {
        const card = page.getByTestId(`about-game-${game.id}`);
        const title = card.locator(".tls-card__title");
        await expect(title).toHaveText(game.name);
        // Der ganze Name steht da: nicht abgeschnitten, kein „…“, innerhalb der Karte.
        const cut = await title.evaluate((element) => ({
          clipped: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
          ellipsis: getComputedStyle(element).textOverflow === "ellipsis",
        }));
        expect(cut, game.name).toEqual({ clipped: false, ellipsis: false });
        const [cardBox, titleBox] = [await box(card), await box(title)];
        expect(titleBox.y).toBeGreaterThanOrEqual(cardBox.y - 1);
        expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 1);
      }
      await expect(page.getByTestId("about-game-fun")).toContainText("Palworld");
      await noSideScroll(page);
    });

    test(`Vorstand: Porträts höchstens 280 px, offene Funktion lädt ein, Statuten für alle (${width})`, async ({ page }) => {
      await mockServer(page);
      await page.goto("/board");
      for (const slug of ["obmann", "kassier"]) {
        const portrait = page.getByTestId(`board-position-${slug}`);
        await expect(portrait).toBeVisible();
        expect((await box(portrait)).width).toBeLessThanOrEqual(280.5);
      }
      await expect(page.getByTestId("board-position-obmann-image")).toHaveAttribute("data-look", "club");
      await expect(page.getByTestId("board-position-kassier-image")).toHaveAttribute("data-look", "duotone");
      const vacancy = page.getByTestId("board-vacancy-jugendreferent");
      await expect(vacancy).toContainText("Zwei Stunden im Monat");
      expect((await box(vacancy)).width).toBeLessThanOrEqual(280.5);
      await expect(page.getByTestId("board-vacancy-jugendreferent-contact")).toHaveAttribute("href", /^\/contact\?topic=volunteer(&|$)/);
      await expect(page.getByTestId("board-statutes-current")).toBeVisible();
      await noSideScroll(page);
    });

    test(`Erfolge & Referenzen: die Vitrine mit festen Reihen (${width})`, async ({ page }) => {
      await mockServer(page);
      await page.goto("/references");
      const first = page.getByTestId("reference-trophy-r1");
      await expect(first).toBeVisible();
      const tops = [];
      for (const item of REFERENCES.items) tops.push(Math.round((await box(page.getByTestId(`reference-trophy-${item.id}`))).y));
      const perRow = tops.filter((top) => Math.abs(top - tops[0]) <= 2).length;
      expect(perRow).toBe(width >= 1024 ? 5 : width >= 640 ? 3 : 2);
      await noSideScroll(page);
    });

    test(`Sponsor werden: Karten am Handy, Tabelle am PC (${width})`, async ({ page }) => {
      await mockServer(page);
      await page.goto("/sponsors");
      await expect(page.getByTestId("sponsors-offer")).toContainText("Startgelder niedrig");
      if (width >= 1024) {
        await expect(page.getByTestId("sponsors-offer-table")).toBeVisible();
        await expect(page.getByTestId("sponsors-offer-cards")).toBeHidden();
      } else if (width >= 768) {
        await expect(page.getByTestId("sponsors-offer-cards")).toBeVisible();
      } else {
        await expect(page.getByTestId("sponsors-offer-cards")).toBeVisible();
        await expect(page.getByTestId("sponsors-offer-table")).toBeHidden();
      }
      await noSideScroll(page);
    });

    test(`Mitglied werden: goldener Knopf mit genug Kontrast (${width})`, async ({ page }) => {
      await mockServer(page);
      await page.goto("/membership/join");
      const button = page.getByTestId("join-apply-btn");
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute("href", "/membership/apply");
      // Nachgerechnet: dunkle Schrift auf Gold, mindestens 7:1.
      const colors = await button.evaluate((element) => ({ text: getComputedStyle(element).color, ground: getComputedStyle(element).backgroundColor }));
      const [light, dark] = [luminance(colors.ground), luminance(colors.text)].sort((a, b) => b - a);
      expect((light + 0.05) / (dark + 0.05)).toBeGreaterThanOrEqual(7);
      // Und axe: kein Kontrast-Verstoß am Knopf.
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => {
        const result = await window.axe.run(document.querySelector("[data-testid='join-apply-btn']"), { runOnly: { type: "rule", values: ["color-contrast"] } });
        return result.violations.map((violation) => violation.id);
      });
      expect(violations).toEqual([]);
      await expect(page.getByTestId("join-fees-list")).toContainText("Ermäßigt");
      await noSideScroll(page);
    });
  });
}

test("/values führt zu den Werten auf „Über uns“", async ({ page }) => {
  await mockServer(page);
  await page.goto("/values");
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/about#werte$/);
  await expect(page.getByTestId("about-values")).toBeInViewport();
});

test.describe("Bewegung reduzieren", () => {
  test.use({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });

  test("die Karte auf „Mitglied werden“ ohne Lichtlauf", async ({ page }) => {
    await mockServer(page);
    await page.goto("/membership/join");
    const card = page.getByTestId("join-card");
    await expect(card).toBeVisible();
    const shine = await card.locator(".tls-member-card__shine").evaluate((element) => getComputedStyle(element).opacity);
    expect(shine).toBe("0");
  });
});
