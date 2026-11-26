const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Saisonende-Moment (#1639, docs/LIGA.md „F.8 Saisonende-Moment“) im echten Browser, Server nachgestellt: Aufstieg, Abstieg und Meister
// beim nächsten Besuch, einmal je Person (nach dem Neuladen und auf einem zweiten Gerät nicht noch einmal), reduzierte Bewegung zeigt den
// Endzustand, Bedienung mit der Tastatur, der Hinweis im Profil - bei 390 und 1440 px ohne seitliches Scrollen und ohne Abschneiden.
// Mit E2E_SCREENS_DIR legt der Test Bilder je Moment ab: Anfang, Mitte, Ende. Nur erfundene Namen.

const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
const consent = () => {
  window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
};

const PLAYER = { id: "p1", username: "neonfalke", display_name: "NeonFalke", role: "player", roles: ["player"], areas: [], email_verified: true };
const TITLE = "Probe-Liga · Season 1";

const step = (level, nickname = null) => ({ level, nickname, label: nickname ? `Liga ${level} · ${nickname}` : `Liga ${level}` });
const badge = (level, nickname = null, champion = false) => ({ level, nickname, champion });
const MOMENTS = {
  up: {
    id: "m-up", outcome: "up", season_id: "s1", title: TITLE, url: "/liga/probe-liga/season-1", squad_id: "q1", team_id: "team-1",
    display_name: "Nordlicht · Nordlicht A", from: step(2), to: step(1, "Elite"), badge_from: badge(2), badge_to: badge(1, "Elite"), via: null,
    corrected: false, next_step: null,
    texts: { label: "Aufstieg", kicker: "Aufstieg", title: "Liga 1 · Elite", name: "Nordlicht · Nordlicht A", meta: TITLE,
      line: "Nordlicht · Nordlicht A steigt von Liga 2 in Liga 1 · Elite auf.", next: null,
      summary: "Nordlicht · Nordlicht A steigt von Liga 2 in Liga 1 · Elite auf.",
      aria: "Aufstieg: Nordlicht · Nordlicht A steigt von Liga 2 in Liga 1 · Elite auf." },
  },
  down: {
    id: "m-down", outcome: "down", season_id: "s1", title: TITLE, url: "/liga/probe-liga/season-1", squad_id: "q2", team_id: "team-2",
    display_name: "Sturmfalken · Falken Rot", from: step(1, "Elite"), to: step(2), badge_from: badge(1, "Elite"), badge_to: badge(2), via: null,
    corrected: false, next_step: null,
    texts: { label: "Abstieg", kicker: "Abstieg", title: "Nächste Season in Liga 2", name: "Sturmfalken · Falken Rot", meta: TITLE,
      line: "Sturmfalken · Falken Rot wechselt von Liga 1 · Elite in Liga 2.", summary: "Sturmfalken · Falken Rot spielt die nächste Season in Liga 2.", next: "Die neue Season beginnt für alle bei null.",
      aria: "Abstieg: Sturmfalken · Falken Rot spielt die nächste Season in Liga 2." },
  },
  champion: {
    id: "m-champion", outcome: "champion", season_id: "s1", title: TITLE, url: "/liga/probe-liga/season-1", squad_id: "q3", team_id: "team-3",
    display_name: "Eisbären · Eisbären B", from: step(1, "Elite"), to: step(1, "Elite"), badge_from: badge(1, "Elite"), badge_to: badge(1, "Elite", true),
    via: null, corrected: false, next_step: null, playoffs: false,
    texts: { label: "Meister", kicker: "Liga 1 · Elite", title: "Meister", name: "Eisbären · Eisbären B", meta: TITLE, line: "Platz 1 im Endstand der Season.",
      summary: "Eisbären · Eisbären B ist Meister in Liga 1 · Elite.",
      next: null, aria: `Meister: Eisbären · Eisbären B ist Meister von ${TITLE} in Liga 1 · Elite.` },
  },
};
// Grenzfall (break-ui): langer Name ohne Leerzeichen, Liga 10 und mehr, langer Beiname, über die Relegation.
const LONG = {
  ...MOMENTS.up, id: "m-long", from: step(11), to: step(10, "Nachwuchsklasse-Mittelsteiermark"), badge_from: badge(11),
  badge_to: badge(10, "Nachwuchsklasse-Mittelsteiermark"), via: "relegation",
  display_name: "Löwenrudel-Nordwestkärnten-Ausdauerakademie · Zweitmannschaft",
  texts: { ...MOMENTS.up.texts, title: "Liga 10 · Nachwuchsklasse-Mittelsteiermark", name: "Löwenrudel-Nordwestkärnten-Ausdauerakademie · Zweitmannschaft",
    line: "Löwenrudel-Nordwestkärnten-Ausdauerakademie · Zweitmannschaft steigt über die Relegation von Liga 11 in Liga 10 · Nachwuchsklasse-Mittelsteiermark auf.",
    summary: "Löwenrudel-Nordwestkärnten-Ausdauerakademie · Zweitmannschaft steigt über die Relegation von Liga 11 in Liga 10 · Nachwuchsklasse-Mittelsteiermark auf." },
  next_step: { label: "Startrecht zusagen", url: "/teams" },
};
const PROFILE = { id: "p1", username: "neonfalke", display_name: "NeonFalke", role: "player", country: "AT", created_at: "2025-03-01T10:00:00+00:00", stats: {}, teams: [],
  tournaments: [], awards: [], league_history: [], league_moments: [MOMENTS.up], achievement_level: { level: 7, progress: 40 }, privacy_public_profile: true };

/** Ein Server, der sich merkt, was gesehen wurde: ``claimed`` nur beim ersten Mal, danach ist der Moment aus „unseen“ heraus. */
async function mockServer(page, { user = PLAYER, moments = [], otherDevice = false } = {}) {
  const state = { seen: new Set(otherDevice ? moments.map((row) => row.id) : []), posts: [] };
  await page.addInitScript(consent);
  await page.route("**/api/**", json({}));
  for (const item of ["sponsors**", "notifications/me", "games", "streams/live"]) await page.route(`**/api/${item}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(user));
  await page.route("**/api/me/rewards/unseen", json({ rewards: [] }));
  // Ein zweites Gerät hat den Moment schon: „unseen“ liefert ihn noch (gleichzeitig geladen), „seen“ spricht ihn nicht mehr zu.
  await page.route("**/api/me/league-moments/unseen", (route) => json({ moments: moments.filter((row) => otherDevice || !state.seen.has(row.id)) })(route));
  await page.route("**/api/me/league-moments/seen", (route) => {
    const { ids } = route.request().postDataJSON();
    state.posts.push(ids);
    const claimed = ids.filter((id) => !state.seen.has(id));
    claimed.forEach((id) => state.seen.add(id));
    return json({ ok: true, claimed })(route);
  });
  await page.route("**/api/users/public/neonfalke**", json(PROFILE));
  // „Startrecht zusagen“ führt zu den Teams - dort braucht die Seite Listen.
  for (const item of ["teams/my", "teams/invites/my", "teams/dissolved/mine"]) await page.route(`**/api/${item}`, json([]));
  await page.route("**/api/me/league-applications", json({ items: [], start_rights: [] }));
  return state;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Nichts abgeschnitten: Die Karte steht ganz im Bild, kein Text ragt aus ihr heraus. */
async function fitsInCard(page) {
  const problems = await page.evaluate(() => {
    const card = document.querySelector(".tls-season-moment__card");
    const box = card.getBoundingClientRect();
    const out = [];
    if (box.left < 0 || box.right > window.innerWidth + 1) out.push("Karte breiter als das Fenster");
    // Der Satz nur für Screenreader (.sr-only) ist absichtlich unsichtbar.
    for (const node of card.querySelectorAll("p:not(.sr-only), h2, a, button")) {
      const rect = node.getBoundingClientRect();
      if (rect.right > box.right + 1 || rect.left < box.left - 1) out.push(`ragt heraus: ${node.textContent.slice(0, 30)}`);
      if (node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflow === "hidden") out.push(`abgeschnitten: ${node.textContent.slice(0, 30)}`);
    }
    return out;
  });
  expect(problems).toEqual([]);
}

async function shot(page, name) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`), style: ".tls-bottom-nav { display: none !important; }" });
}

/** Alle Bewegungen des Moments auf denselben Zeitpunkt (ms seit dem Start) - so zeigen die Bilder genau Anfang, Mitte und Ende. */
async function freezeAt(page, ms) {
  await page.evaluate((time) => {
    // Nur zeitbasierte Bewegungen im Moment - die Seite dahinter hat auch an den Bildlauf gebundene.
    for (const animation of document.getAnimations()) {
      if (animation.timeline !== document.timeline || !animation.effect?.target?.closest?.(".tls-season-moment")) continue;
      animation.pause();
      animation.currentTime = time;
    }
  }, ms);
}

// Anfang, Mitte, Ende der Bewegung - nur für die Bilder; geprüft wird der Endzustand über Attribute. ``middle``: wann der Zahlenwechsel
// (bzw. beim Meister der Glanz) gerade läuft.
async function phases(page, name, { middle = 1150 } = {}) {
  if (!process.env.E2E_SCREENS_DIR) return;
  await freezeAt(page, 330);
  await shot(page, `${name}-1-anfang`);
  await freezeAt(page, middle);
  await shot(page, `${name}-2-mitte`);
  await freezeAt(page, 4000);
  await shot(page, `${name}-3-ende`);
  await page.evaluate(() => document.getAnimations()
    .filter((animation) => animation.timeline === document.timeline && animation.effect?.target?.closest?.(".tls-season-moment"))
    .forEach((animation) => animation.finish()));
}

test.describe("Liga: Saisonende-Moment", () => {
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Aufstieg bei ${width} px: Wappen, Zahlenwechsel, Krone - einmal, nach dem Neuladen nicht mehr`, async ({ page }, info) => {
      await page.setViewportSize({ width, height });
      const state = await mockServer(page, { moments: [MOMENTS.up] });
      await page.goto("/u/neonfalke");
      const moment = page.getByTestId("season-moment");
      await expect(moment).toBeVisible();
      await expect(moment).toHaveAttribute("data-outcome", "up");
      await expect(moment.getByTestId("season-moment-kicker")).toHaveText("Aufstieg");
      await expect(moment.getByTestId("season-moment-title")).toHaveText("Liga 1 · Elite");
      await expect(moment.getByTestId("season-moment-crown")).toBeAttached();
      await expect(moment.locator(".tls-season-moment__card")).toHaveAttribute("data-play", "run");
      await expect(page.getByRole("dialog", { name: "Liga 1 · Elite" })).toBeVisible();
      if (info.project.name === "chromium") await phases(page, `aufstieg-${width}`);
      await noSideScroll(page);
      await fitsInCard(page);
      expect(state.posts).toEqual([["m-up"]]);
      // Schließen mit der Tastatur.
      await page.keyboard.press("Escape");
      await expect(moment).toBeHidden();
      // Danach bleibt der Hinweis im Profil.
      await expect(page.getByTestId("profile-league-moments-m-up")).toContainText("steigt von Liga 2 in Liga 1 · Elite auf.");
      await page.reload();
      await expect(page.getByTestId("profile-league-moments-m-up")).toBeVisible();
      await expect(page.getByTestId("season-moment")).toHaveCount(0);
      expect(state.posts).toEqual([["m-up"]]);
    });

    test(`Abstieg bei ${width} px: ruhig, Blick auf die nächste Season`, async ({ page }, info) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, { moments: [MOMENTS.down] });
      await page.goto("/u/neonfalke");
      const moment = page.getByTestId("season-moment");
      await expect(moment).toBeVisible();
      await expect(moment).toHaveAttribute("data-metal", "calm");
      await expect(moment.getByTestId("season-moment-title")).toHaveText("Nächste Season in Liga 2");
      await expect(moment.getByTestId("season-moment-next")).toHaveText("Die neue Season beginnt für alle bei null.");
      await expect(moment.getByTestId("season-moment-crown")).toHaveCount(0);
      if (info.project.name === "chromium") await phases(page, `abstieg-${width}`);
      await noSideScroll(page);
      await fitsInCard(page);
      await moment.getByTestId("season-moment-done").click();
      await expect(moment).toBeHidden();
    });

    test(`Meister bei ${width} px: goldener Moment mit Pokal`, async ({ page }, info) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, { moments: [MOMENTS.champion] });
      await page.goto("/u/neonfalke");
      const moment = page.getByTestId("season-moment");
      await expect(moment).toBeVisible();
      await expect(moment).toHaveAttribute("data-metal", "gold");
      await expect(moment.getByTestId("season-moment-trophy")).toBeVisible();
      await expect(moment.getByTestId("season-moment-title")).toHaveText("Meister");
      if (info.project.name === "chromium") await phases(page, `meister-${width}`, { middle: 1250 });
      await noSideScroll(page);
      await fitsInCard(page);
      await moment.getByTestId("season-moment-close").click();
      await expect(moment).toBeHidden();
    });

    test(`Tastatur bei ${width} px: der Fokus bleibt in der Karte, Enter folgt dem Startrecht`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, { moments: [LONG] });
      await page.goto("/u/neonfalke");
      const moment = page.getByTestId("season-moment");
      await expect(moment).toBeVisible();
      // Grenzfall: langer Name, Liga 10, langer Beiname - bricht um, nichts ragt heraus.
      await expect(moment.locator(".tls-season-moment__num--to text")).toHaveText("10");
      await noSideScroll(page);
      await fitsInCard(page);
      for (let index = 0; index < 6; index += 1) {
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-testid='season-moment']")))).toBe(true);
      }
      if (process.env.E2E_SCREENS_DIR && width === 390) {
        await page.waitForTimeout(2600);
        await shot(page, "grenzfall-lang-390");
      }
      await moment.getByTestId("season-moment-next-step").focus();
      await page.keyboard.press("Enter");
      await expect(moment).toBeHidden();
      await expect(page).toHaveURL(/\/teams$/);
    });

    test(`Reduzierte Bewegung bei ${width} px: gleich der Endzustand`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await mockServer(page, { moments: [MOMENTS.up] });
      await page.goto("/u/neonfalke");
      const moment = page.getByTestId("season-moment");
      await expect(moment).toHaveAttribute("data-reduced", "true");
      await expect(moment.locator(".tls-season-moment__card")).not.toHaveAttribute("data-play", "run");
      // Ohne Bewegung steht nur das Nachher da: die neue Zahl sichtbar, die alte nicht.
      await expect.poll(() => moment.locator(".tls-season-moment__num--from").evaluate((node) => getComputedStyle(node).opacity)).toBe("0");
      await expect.poll(() => moment.locator(".tls-season-moment__num--to").evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
      await expect.poll(() => moment.getByTestId("season-moment-crown").evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
      await shot(page, `reduziert-${width}`);
    });

    test(`Zweites Gerät bei ${width} px: schon gesehen - kein Moment`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const state = await mockServer(page, { moments: [MOMENTS.up], otherDevice: true });
      await page.goto("/u/neonfalke");
      await expect.poll(() => state.posts.length).toBe(1);
      await expect(page.getByTestId("profile-league-moments")).toBeVisible();
      await expect(page.getByTestId("season-moment")).toHaveCount(0);
    });

    test(`Hinweis im Profil bei ${width} px: Moment noch einmal ansehen, ohne zu zählen`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const state = await mockServer(page, { moments: [] });
      await page.goto("/u/neonfalke");
      const hint = page.getByTestId("profile-league-moments-m-up");
      await expect(hint).toBeVisible();
      await noSideScroll(page);
      await hint.getByTestId("profile-league-moments-m-up-replay").click();
      const moment = page.getByTestId("season-moment");
      await expect(moment).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(moment).toBeHidden();
      expect(state.posts).toEqual([]);
      if (process.env.E2E_SCREENS_DIR) await hint.screenshot({ path: path.join(process.env.E2E_SCREENS_DIR, `hinweis-profil-${width}.png`) });
    });
  }
});
