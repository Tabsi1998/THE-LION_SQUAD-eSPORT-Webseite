const { test, expect } = require("@playwright/test");

// Regelwerk der Liga (docs/LIGA.md, #1646) im echten Browser, Server nachgestellt: Regelseite und Pflege bei 390 und 1440 px, mit langen
// Texten, langen Wörtern und einer breiten Tabelle. Inhaltsverzeichnis, Sprung auf einen Paragrafen, Suche, Markierung, Vergleich,
// Zustimmung. Erfundene Regeln, erfundene Namen.

const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const LONG_WORD = "Donaudampfschifffahrtsgesellschaftskapitänsmützenabzeichen".repeat(3);
const FILLER = Array.from({ length: 12 }, (_, index) => `Satz ${index + 1} dieser Probe-Regel erklärt ruhig und in normaler Länge, was im Spielbetrieb gelten soll.`).join(" ");
const WIDE = `| ${Array.from({ length: 9 }, (_, index) => `Spalte ${index + 1}`).join(" | ")} |\n| ${Array(9).fill("---").join(" | ")} |\n| ${Array.from({ length: 9 }, () => "Ein Wert mit etwas Text").join(" | ")} |`;

const V2 = { id: "v2", scope: "league_season", version: 2, label: "Version 2", title: `Regelwerk der Probe-Liga mit einem recht langen Titel ${LONG_WORD}`, valid_from: "2030-03-05",
  published_at: "2030-03-01T10:00:00+00:00", change_reason: "Pool erneuert und Fairplay neu gefasst", is_current: true, pdf_url: "/api/league-rules/seasons/probe/s1/versions/v2/pdf" };
const V1 = { id: "v1", scope: "league_season", version: 1, label: "Version 1", title: "Regelwerk", valid_from: "2030-01-01", published_at: "2030-01-01T10:00:00+00:00", change_reason: "Erste Fassung", is_current: false };
const SECTIONS = [
  { anchor: "einleitung", title: null, level: 0, kind: "main", body_md: "Vorwort der Probe-Liga.", mark: null },
  { anchor: "1-fairplay", title: "§ 1 Fairplay", level: 1, kind: "main", body_md: `Fair spielen. ${FILLER}\n\n- Pünktlich sein\n- Kein Cheaten\n\n[Sprung zu den Maps](#2-maps)`, mark: "changed" },
  { anchor: LONG_WORD.toLowerCase().slice(0, 60), title: `§ 1a ${LONG_WORD}`, level: 2, kind: "main", body_md: `${LONG_WORD} steht hier als ein einziges Wort.`, mark: null },
  { anchor: "2-maps", title: "§ 2 Maps", level: 1, kind: "main", body_md: "| Modus | Maps |\n| --- | --- |\n| Stellung | Hafenkante, Nebelwerk |", mark: "new" },
  { anchor: "3-tabelle", title: "§ 3 Breite Tabelle", level: 1, kind: "main", body_md: WIDE, mark: null },
  { anchor: "4-ablauf", title: "§ 4 Ablauf", level: 1, kind: "main", body_md: `${FILLER}\n\n${FILLER}\n\n${FILLER}`, mark: null },
  { anchor: "anlage-a", title: "Anlage A: Strafen", level: 1, kind: "annex", body_md: `Verwarnung, dann Punktabzug. ${FILLER}`, mark: null },
];
const PAGE = {
  league: { slug: "probe", name: "Probe-Liga" }, season: { id: "s1", slug: "s1", name: "Season 1", number: 1, status: "active" }, look: {}, public: true,
  source: "rules", version: V2, versions: [V2, V1], upcoming: null, seasons: [], fallback_text: null,
  consent: { version_id: "v2", version: 2, label: "Version 2", squads: [{ squad_id: "sq1", squad_name: "Rudel A mit langem Namen", agreed: false, agreed_at: null }] },
  sections: SECTIONS,
  changes: { base: V1, changed: [{ anchor: "1-fairplay", title: "§ 1 Fairplay" }], new: [{ anchor: "2-maps", title: "§ 2 Maps" }], removed: [{ anchor: "weg", title: "Alte Regel" }] },
};
const COMPARE = { base: V1, target: V2, sections: [
  { anchor: "1-fairplay", title: "§ 1 Fairplay", level: 1, status: "changed", ops: [{ op: "eq", text: "Fair " }, { op: "del", text: "bleiben" }, { op: "ins", text: "spielen" }, { op: "eq", text: `. ${LONG_WORD}` }] },
  { anchor: "gleich", title: "Gleich", level: 1, status: "same" },
  { anchor: "weg", title: "Alte Regel", level: 1, status: "removed", ops: [{ op: "del", text: "Entfernter Satz der alten Fassung" }] },
] };
const BLOCKS = [{ key: "map_pool", label: "Map-Pool", hint: "Die Maps je Modus.", token: "[[baustein:map_pool]]" }, { key: "mode_order", label: "Modusfolge", hint: "Die Modi je Map.", token: "[[baustein:mode_order]]" }];
const ADMIN_VIEW = {
  scope: "league_season", scope_id: "s1", league: { id: "l1", name: "Probe-Liga mit einem recht langen Namen", slug: "probe" }, season: { id: "s1", name: "Season 1", slug: "s1", visibility: "public" },
  draft: { id: "d1", status: "draft", revision: 2, title: "Regelwerk", body_md: `# § 1 Fairplay\n${FILLER}\n\n[[baustein:map_pool]]`, annexes: [{ key: "A", title: "Strafen", body_md: "Katalog" }] },
  versions: [{ ...V2, published_by: "admin-1" }, { ...V1, published_by: "admin-1" }], inherited: null, current: V2, blocks: BLOCKS, today: "2030-03-05", public_url: "/liga/probe/s1/regeln",
  data_changes: { version_id: "v2", version: 2, label: "Version 2", rows: [{ block: "map_pool", label: "Map-Pool", season_id: "s1", season_name: "Season 1", status: "changed",
    before: "| Stellung | Hafenkante |", after: "| Stellung | Turmblick |", ops: [{ op: "eq", text: "| Stellung | " }, { op: "del", text: "Hafenkante" }, { op: "ins", text: "Turmblick" }, { op: "eq", text: " |" }] }] },
  consents: { version_id: "v2", label: "Version 2", rows: [
    { squad_id: "a", squad_name: "Rudel A", team_name: `Löwen · Rudel A ${LONG_WORD}`, agreed: true, agreed_at: "2030-03-02T10:00:00+00:00", agreed_by: "Testkapitän" },
    { squad_id: "b", squad_name: "Horst", team_name: "Falken · Horst", agreed: false, agreed_at: null, agreed_by: "" }] },
};

async function mockServer(page, { user = null } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", json({}));
  for (const path of ["sponsors**", "notifications/me", "games"]) await page.route(`**/api/${path}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", user ? json(user) : (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.route("**/api/league-rules/seasons/probe/s1**", (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify(route.request().url().includes("/compare") ? COMPARE : PAGE) }));
  await page.route("**/api/admin/league-rules/league_season/s1", json(ADMIN_VIEW));
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  const narrow = width < 1024;

  test(`Regelseite (${width} px): lesbar, lange Wörter, Tabelle scrollt für sich`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/liga/probe/s1/regeln");
    await expect(page.getByTestId("rules-document")).toBeVisible();
    await expect(page.getByTestId("rules-meta")).toContainText("Version 2 · gültig ab 05.03.2030");
    await noSideScroll(page);
    const table = page.locator("[id='3-tabelle'] .prose-cms-table");
    const box = await table.evaluate((node) => ({ scrolls: node.scrollWidth > node.clientWidth, overflow: getComputedStyle(node).overflowX }));
    expect(box.overflow).toBe("auto");
    if (narrow) expect(box.scrolls).toBe(true);
    const measure = await page.getByTestId("rules-document").evaluate((node) => node.getBoundingClientRect().width);
    expect(measure).toBeLessThanOrEqual(800);
    expect(await page.locator('meta[name="robots"]').getAttribute("content")).toBe("index, follow");
    if (process.env.ABNAHME_SHOTS) {
      await page.screenshot({ path: `${process.env.ABNAHME_SHOTS}/regeln-${width}.png` });
      await page.locator("[id='1-fairplay']").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${process.env.ABNAHME_SHOTS}/regeln-${width}-text.png` });
    }
  });

  test(`Regelseite (${width} px): Inhaltsverzeichnis und Sprung auf einen Paragrafen`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/liga/probe/s1/regeln");
    const toc = page.getByTestId("rules-toc");
    if (narrow) await page.getByTestId("rules-toc-toggle").click();
    await toc.getByRole("link", { name: "Anlage A: Strafen" }).click();
    await expect(page).toHaveURL(/#anlage-a$/);
    const top = await page.locator("[id='anlage-a']").evaluate((node) => node.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(height / 2);
    const tools = await page.locator(".tls-rules-tools").boundingBox();
    expect(top).toBeGreaterThanOrEqual(tools.y + tools.height - 1);
    if (!narrow) await expect(toc).toBeVisible();
  });

  test(`Regelseite (${width} px): Direktlink öffnet den Paragrafen`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/liga/probe/s1/regeln#4-ablauf");
    await expect(page.locator("[id='4-ablauf']")).toBeInViewport();
  });

  test(`Regelseite (${width} px): Suche zählt, springt und färbt`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/liga/probe/s1/regeln");
    await page.getByTestId("rules-search").fill("Punktabzug");
    await expect(page.getByTestId("rules-search-count")).toHaveText("1 von 1");
    await expect(page.getByText("Verwarnung, dann Punktabzug.", { exact: false })).toBeInViewport();
    expect(await page.evaluate(() => CSS.highlights.get("tls-rules-hit-active")?.size)).toBe(1);
    await page.getByTestId("rules-search").fill("gibtesnicht");
    await expect(page.getByTestId("rules-search-count")).toHaveText("Keine Treffer");
    await noSideScroll(page);
    await page.getByTestId("rules-search").press("Escape");
    await expect(page.getByTestId("rules-search")).toHaveValue("");
  });

  test(`Regelseite (${width} px): Markierung mit Strich und Wort, Schalter blendet aus, ohne dass der Text springt`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/liga/probe/s1/regeln");
    const changes = page.getByTestId("rules-changes");
    await expect(changes).toContainText("Neu in Version 2");
    await expect(changes).toContainText("Entfernt: Alte Regel");
    const section = page.locator("[id='1-fairplay']");
    await expect(section).toContainText("Geändert in Version 2");
    const bar = await section.evaluate((node) => {
      const style = getComputedStyle(node, "::before");
      return { width: style.width, left: parseFloat(style.left), color: style.backgroundColor };
    });
    expect(bar.width).toBe("3px");
    expect(bar.left + (await section.boundingBox()).x).toBeGreaterThanOrEqual(0);
    const textLeft = (await section.locator(".prose-cms").boundingBox()).x;
    await page.getByTestId("rules-marks-switch").click();
    await expect(section).not.toContainText("Geändert in Version 2");
    expect((await section.locator(".prose-cms").boundingBox()).x).toBe(textLeft);
    await expect(page.getByTestId("rules-pdf")).toHaveAttribute("href", /marks=0/);
  });

  test(`Regelseite (${width} px): Vergleich Wort für Wort mit entferntem Text`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/liga/probe/s1/regeln");
    await page.getByTestId("rules-compare-select").selectOption("v1");
    const view = page.getByTestId("rules-compare");
    await expect(view.locator("del", { hasText: "bleiben" })).toBeVisible();
    await expect(view.locator("ins", { hasText: "spielen" })).toBeVisible();
    await expect(view.locator("del", { hasText: "Entfernter Satz" })).toBeVisible();
    if (process.env.ABNAHME_SHOTS) await page.screenshot({ path: `${process.env.ABNAHME_SHOTS}/regeln-vergleich-${width}.png` });
    await expect(page).toHaveURL(/vergleich=v1/);
    // Die Auswahl ist weg: Der Fokus geht auf die Überschrift des Vergleichs, Tastatur und Vorleser verlieren den Faden nicht.
    await expect(page.getByTestId("rules-compare-title")).toBeFocused();
    await expect(page.getByTestId("rules-compare-title")).toBeInViewport();
    expect(await page.locator('meta[name="robots"]').getAttribute("content")).toBe("noindex, nofollow");
    await noSideScroll(page);
    await view.getByRole("button", { name: /Zurück zum Text/ }).click();
    await expect(page.getByTestId("rules-document")).toBeVisible();
  });

  test(`Regelseite (${width} px): Kapitäns-Hinweis, Zustimmung geht an den Server`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    let sent = null;
    await page.route("**/api/league-rules/consents", (route) => {
      sent = route.request().postDataJSON();
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.goto("/liga/probe/s1/regeln");
    const hint = page.getByTestId("rules-consent");
    await expect(hint).toContainText("Spiele laufen auch ohne Zustimmung weiter");
    await noSideScroll(page);
    await hint.getByRole("button", { name: "Zustimmen" }).click();
    await expect.poll(() => sent).toEqual({ version_id: "v2", season_id: "s1", squad_id: "sq1" });
  });

  test(`Pflege (${width} px): Entwurf, Bausteine, Vorschlag bei Datenänderung, Fassungen, Zustimmungen`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page, { user: ADMIN });
    await page.goto("/admin/leagues/rules/league_season/s1");
    await expect(page.getByRole("heading", { level: 1, name: "Regelwerk", exact: true })).toBeVisible();
    await expect(page.getByTestId("rules-data-changes")).toContainText("Daten geändert, neue Version vorbereiten");
    if (process.env.ABNAHME_SHOTS) await page.screenshot({ path: `${process.env.ABNAHME_SHOTS}/regeln-pflege-${width}.png`, fullPage: true });
    await expect(page.getByTestId("rules-versions")).toContainText("Pool erneuert");
    await expect(page.getByTestId("rules-consent-row-b")).toContainText("offen");
    await page.getByTestId("rules-block-mode_order").click();
    await expect(page.getByText("Nicht gespeichert")).toBeVisible();
    await noSideScroll(page);
    await page.route("**/api/admin/league-rules/league_season/s1/preview", (route) => route.fulfill({ contentType: "application/json",
      body: JSON.stringify({ sections: SECTIONS, changes: PAGE.changes, blocks_used: ["map_pool"], unknown_blocks: [] }) }));
    await page.getByTestId("rules-preview").click();
    await expect(page.getByTestId("rules-preview-document")).toContainText("§ 2 Maps");
    await noSideScroll(page);
    await expect(page.getByTestId("rules-publish")).toBeDisabled();
    await page.getByTestId("rules-reason").fill("Neue Modusfolge eingetragen");
    await expect(page.getByTestId("rules-publish")).toBeEnabled();
  });
}

const MFA = { mfa_enabled: true, auth_mfa_verified: true };
const DUTY = { id: "z1", username: "zustaendig", display_name: "Zuständig", role: "player", areas: [], has_league_staff: true, ...MFA };
const LEAD = { id: "t1", username: "turnierleitung", display_name: "Turnierleitung", role: "tournament_admin", areas: ["tournaments", "moderation"], ...MFA };

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Pflege (${width} px): Zuständige ohne Bereich kommen hinein`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page, { user: DUTY });
    await page.goto("/admin/leagues/rules/league_season/s1");
    await expect(page.getByTestId("rules-draft")).toBeVisible();
    await noSideScroll(page);
  });

  test(`Pflege (${width} px): Die Turnierleitung kommt nicht hinein`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page, { user: LEAD });
    await page.goto("/admin/leagues/rules/league_season/s1");
    await expect(page).toHaveURL(/\/403/);
    await expect(page.getByTestId("rules-draft")).toHaveCount(0);
  });
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

for (const [who, user, scope] of [["Zuständige ohne Bereich", DUTY, null], ["Superadmin", ADMIN, "media_scope=admin"]]) {
  test(`Pflege: ${who} laden das Bild dorthin, wo sie dürfen`, async ({ page }) => {
    await mockServer(page, { user });
    await page.route("**/api/uploads/image**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ url: "/api/static/uploads/plan.png" }) }));
    await page.goto("/admin/leagues/rules/league_season/s1");
    await expect(page.getByTestId("rules-draft")).toBeVisible();
    const sent = page.waitForRequest((request) => request.url().includes("/api/uploads/image") && request.method() === "POST");
    await page.locator('input[type="file"]').first().setInputFiles({ name: "plan.png", mimeType: "image/png", buffer: PNG });
    const url = (await sent).url();
    if (scope) expect(url).toContain(scope); else expect(url).not.toContain("media_scope");
  });
}

test("Pflege: Zuständige ohne Zwei-Faktor gehen zuerst zur Sicherheit", async ({ page }) => {
  await mockServer(page, { user: { ...DUTY, auth_mfa_verified: false, mfa_enabled: false } });
  await page.goto("/admin/leagues/rules/league_season/s1");
  await expect(page).not.toHaveURL(/\/admin\/leagues\/rules/);
  await expect(page.getByTestId("rules-draft")).toHaveCount(0);
});

test("Ligaseite verlinkt das Regelwerk statt des Aufklappblocks", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockServer(page);
  await page.route("**/api/leagues/probe/s1", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    league: { id: "l1", slug: "probe", name: "Probe-Liga", game: { name: "Probe Shooter" } },
    season: { name: "Season 1", slug: "s1", start_date: "2030-03-05T23:00:00+00:00", end_date: "2030-05-18T22:59:59+00:00", matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", best_of: 3, team_size: 4, match_points: { win: 3, draw: 1, loss: 0 }, rules_text: "## Alt", blocked_periods: [] },
    map_pool: null, divisions: [],
    rules: { source: "rules", version: 2, label: "Version 2", valid_from: "2030-03-05", url: "/liga/probe/s1/regeln", pdf_url: "/api/league-rules/seasons/probe/s1/versions/v2/pdf", consent_open: false },
  }) }));
  await page.goto("/liga/probe/s1");
  await expect(page.getByTestId("league-rules-version")).toContainText("Version 2");
  await expect(page.getByTestId("league-rules")).toHaveCount(0);
  await page.getByTestId("league-rules-link").getByRole("link", { name: /Regeln/ }).click();
  await expect(page).toHaveURL(/\/liga\/probe\/s1\/regeln$/);
  await expect(page.getByTestId("rules-document")).toBeVisible();
});
