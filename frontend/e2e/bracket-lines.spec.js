const { test, expect } = require("@playwright/test");
const { mockTvApi } = require("./fixtures/tvMock");
const CASES = require("./fixtures/bracketLines.json");
const GENERATED = require("./fixtures/ffaGenerated.json");

// Turnierbaum übersichtlich (#1591): Fälle aus dem echten Generator (scripts/make_ffa_bracket_fixture.py --lines) im
// echten Layout - Web 1440 und 375, TV 1920. Geprüft wird jede sichtbare Linie (lib/bracketLineAudit): beide Enden an
// Karte, Schiene oder Marker, nichts doppelt gezeichnet, nichts gedrängt, nichts außerhalb der Leinwand oder durch eine
// Karte, je Gruppe eine Schiene. Dazu die Namen: „Loser Runde 1“, „Grand Final“, einzeilige Plätze. Alle Antworten kommen
// aus dem Test (page.route), alle Namen sind erfunden. Bilder in SHOT_DIR, wenn gesetzt.

const SHOTS = process.env.SHOT_DIR || "";
// Dazu die schweren Fälle aus ffaGenerated.json (break-ui): 40 Fahrer mit langen Namen, Freilose, gemischt und
// zusammengelegt, Doppel-K.-o. nach der Auslosung.
const WEB_CASES = ["ffa16de_start", "ffa16de_round1", "se8_fixed", "de8_fixed", "ffa8_merged",
  "ffa40", "se6_draw_after", "ffa8_shuffle_merged", "de8_draw_after", "ffa16_draw_after"];

let audit;
test.beforeAll(async () => {
  audit = await import("../src/lib/bracketLineAudit.mjs");
});

async function mockWeb(page, name) {
  const data = CASES[name] || GENERATED[name];
  const tournament = { ...data.tournament, status: "live" };
  const json = (body, status = 200) => (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", json([]));
  await page.route("**/api/auth/me", json({}, 401));
  await page.route("**/api/settings/public", json({}));
  await page.route(`**/api/tournaments/${tournament.slug}`, json(tournament));
  await page.route(`**/api/tournaments/${tournament.id}/bracket**`, json({ ...data, tournament }));
  return tournament;
}

async function shot(page, name) {
  if (!SHOTS) return;
  const size = page.viewportSize();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: size.width, height: Math.min(height, 6000) });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  await page.setViewportSize(size);
  await page.waitForTimeout(300);
}

/** Was im Bild steht - in Koordinaten der Linien (SVG), auch wenn die TV-Kamera vergrößert. */
function collect(page, { root, card, heads }) {
  return page.evaluate(({ root, card, heads }) => {
    return [...document.querySelectorAll(root)].map((scope) => {
      const svg = scope.querySelector("[data-testid='bracket-connectors']");
      const matrix = svg.getScreenCTM();
      const local = (rect) => {
        const left = (rect.left - matrix.e) / matrix.a;
        const top = (rect.top - matrix.f) / matrix.d;
        const width = rect.width / matrix.a;
        const height = rect.height / matrix.d;
        return { left, top, right: left + width, bottom: top + height, width, height };
      };
      const visible = (node) => {
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.05;
      };
      const lines = [...svg.querySelectorAll("path")].filter(visible).map((path) => ({
        id: path.getAttribute("data-id") || `${path.getAttribute("data-from")}>${path.getAttribute("data-to")}`,
        d: path.getAttribute("d"),
        spine: path.getAttribute("data-rail-spine") || undefined,
        focus: path.getAttribute("data-focus") === "1",
      }));
      const markers = [...svg.querySelectorAll("[data-line-marker]")].filter(visible).map((node) => ({ x: Number(node.getAttribute("cx")), y: Number(node.getAttribute("cy")) }));
      const boxes = [...scope.querySelectorAll(card)].map((node) => local(node.getBoundingClientRect())).filter((rect) => rect.width > 0);
      const obstacles = [...scope.querySelectorAll(heads)].map((node) => local(node.getBoundingClientRect())).filter((rect) => rect.width > 0 && rect.height > 0);
      return { lines, markers, boxes, obstacles, bounds: { w: Number(svg.getAttribute("width")), h: Number(svg.getAttribute("height")) } };
    });
  }, { root, card, heads });
}

function check(views, { focusOnly = false } = {}) {
  const problems = [];
  for (const view of views) {
    const lines = view.lines.map((line) => ({ ...line, points: audit.parsePath(line.d) }));
    const found = audit.auditLines({ ...view, lines });
    problems.push(...(focusOnly ? found.filter((text) => !/überlagert|gedrängt/.test(text)) : found));
  }
  return problems;
}

const WEB = { root: "[data-testid='bracket-tree']", card: "[data-node]", heads: "[data-section-head], [data-testid='bracket-round-title']" };

for (const name of WEB_CASES) {
  test(`Web 1440 ${name}: jede Linie hängt an, nichts doppelt, nichts gedrängt, nichts außerhalb`, async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "Die Leinwand mit Linien gibt es am Desktop");
    await page.setViewportSize({ width: 1440, height: 1000 });
    const tournament = await mockWeb(page, name);
    await page.goto(`/tournaments/${tournament.slug}/bracket`);
    await expect(page.getByTestId("bracket-tree").first()).toBeVisible();
    await page.waitForTimeout(1600);
    await shot(page, `web-1440-${name}`);
    const views = await collect(page, WEB);
    expect(views.length).toBeGreaterThan(0);
    expect(check(views)).toEqual([]);
  });
}

test("Web 1440: Abstiege erst beim Zeigen auf die Karte - dann ganz, angeschlossen, in der Leinwand", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "Zeigen gibt es nur mit Maus");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const tournament = await mockWeb(page, "ffa16de_start");
  await page.goto(`/tournaments/${tournament.slug}/bracket`);
  await expect(page.getByTestId("bracket-tree").first()).toBeVisible();
  await page.waitForTimeout(1600);
  const heatA = CASES.ffa16de_start.matches_v2.find((match) => match.match_key === "A");
  const drops = page.locator(`[data-testid='bracket-connectors'] path[data-from='${heatA.id}'][data-flow='L']`);
  expect(await drops.count()).toBeGreaterThan(0);
  for (const opacity of await drops.evaluateAll((nodes) => nodes.map((node) => Number(getComputedStyle(node).opacity)))) expect(opacity).toBeLessThan(0.05);
  // Am Ziel steht ein Eingang (Marker), an der Quelle „Die anderen → LA, LB“.
  expect(await page.locator("[data-testid='bracket-connectors'] [data-line-marker]").count()).toBeGreaterThan(0);
  await expect(page.getByTestId(`bracket-heat-drop-${heatA.id}`)).toHaveText("Die anderen → LA, LB");
  await page.getByTestId(`bracket-heat-${heatA.id}`).hover();
  await expect.poll(() => drops.evaluateAll((nodes) => nodes.filter((node) => Number(getComputedStyle(node).opacity) > 0.5).length)).toBeGreaterThan(0);
  await shot(page, "web-1440-ffa16de_start-zeigen");
  expect(check(await collect(page, WEB), { focusOnly: true })).toEqual([]);
  await page.mouse.move(2, 2);
  await expect.poll(() => drops.evaluateAll((nodes) => nodes.filter((node) => Number(getComputedStyle(node).opacity) > 0.05).length)).toBe(0);
});

test("Web 1440: Namen - Loser Runde 1, Grand Final, Plätze klar und einzeilig", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "Desktop-Leinwand");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const tournament = await mockWeb(page, "ffa16de_start");
  await page.goto(`/tournaments/${tournament.slug}/bracket`);
  await expect(page.getByTestId("bracket-tree").first()).toBeVisible();
  const byKey = new Map(CASES.ffa16de_start.matches_v2.map((match) => [match.match_key, match]));
  const loser = page.getByTestId("bracket-section-lb");
  await expect(loser.getByTestId("bracket-round-title").first()).toHaveText(/^Loser Runde 1/);
  await expect(page.getByTestId("bracket-tree").first()).not.toContainText("Lauf FINAL");
  await expect(page.getByTestId(`bracket-heat-title-${byKey.get("FINAL").id}`)).toHaveText(/^Grand Final/);
  await expect(page.getByTestId(`bracket-heat-cut-${byKey.get("G").id}`)).toHaveText("2 kommen weiter → Grand Final");
  await expect(page.getByTestId("bracket-tree").first()).not.toContainText("Platz aus Runde");
  await expect(page.getByTestId(`bracket-heat-${byKey.get("E").id}`)).toContainText("Weiter aus Runde 1");
  await expect(page.getByTestId(`bracket-heat-${byKey.get("LA").id}`)).toContainText("Verlierer aus Runde 1");
  const lc = page.getByTestId(`bracket-heat-${byKey.get("LC").id}`);
  await expect(lc).toContainText("Weiter aus Loser Runde 1");
  await expect(lc).toContainText("Verlierer aus Runde 2");
  const tall = await page.locator("[data-pending='1']").evaluateAll((nodes) => nodes.filter((node) => node.getBoundingClientRect().height > parseFloat(getComputedStyle(node).lineHeight) * 1.5).map((node) => node.textContent));
  expect(tall).toEqual([]);
  // Einzeilig heißt nicht abgeschnitten: der ganze Text passt.
  const cut = await page.locator("[data-pending='1']").evaluateAll((nodes) => nodes.filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.textContent));
  expect(cut).toEqual([]);
});

// Doppel-K.-o. mit Duellen, gemischt: die längsten Plätze („Verlierer aus Winner Runde 1“) passen in eine Zeile.
for (const width of [1440, 375]) {
  test(`Web ${width} de8 gemischt: lange Plätze ganz und einzeilig`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const tournament = await mockWeb(page, "de8_draw_before");
    await page.goto(`/tournaments/${tournament.slug}/bracket`);
    await expect(page.locator("[data-pending='1']").first()).toBeAttached();
    await expect(page.locator("[data-pending='1']", { hasText: "Verlierer aus Winner Runde 1" }).first()).toBeAttached();
    await page.waitForTimeout(600);
    const bad = await page.locator("[data-pending='1']").evaluateAll((nodes) => nodes.filter((node) => node.offsetParent && (node.scrollWidth > node.clientWidth + 1 || node.getBoundingClientRect().height > parseFloat(getComputedStyle(node).lineHeight) * 1.5)).map((node) => node.textContent));
    expect(bad).toEqual([]);
  });
}

test("Web 375: Plätze einzeilig, kein seitliches Überlaufen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const tournament = await mockWeb(page, "ffa16de_start");
  await page.goto(`/tournaments/${tournament.slug}/bracket`);
  await expect(page.locator("[data-pending='1']").first()).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, "web-375-ffa16de_start");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const tall = await page.locator("[data-pending='1']").evaluateAll((nodes) => nodes.filter((node) => node.offsetParent && node.getBoundingClientRect().height > parseFloat(getComputedStyle(node).lineHeight) * 1.5).map((node) => node.textContent));
  expect(tall).toEqual([]);
  const cut = await page.locator("[data-pending='1']").evaluateAll((nodes) => nodes.filter((node) => node.offsetParent && node.scrollWidth > node.clientWidth + 1).map((node) => node.textContent));
  expect(cut).toEqual([]);
});

for (const name of ["ffa16de_start", "de8_fixed"]) {
  test(`TV 1920 ${name}: dieselben Regeln für die Linien`, async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "TV");
    await page.setViewportSize({ width: 1920, height: 1080 });
    const data = CASES[name];
    await mockTvApi(page, { bracket: { ...data, tournament: { ...data.tournament, id: "t1", status: "live", public_phase: "live" } } });
    await page.goto("/display/bracket/t1?key=tv-schluessel&pixel_shift=0&playlist=tree");
    await expect(page.getByTestId("tv-tree")).toBeVisible();
    await expect(page.getByTestId("tv-viewport")).not.toHaveAttribute("data-camera", "wait");
    await page.waitForTimeout(1500);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/tv-1920-${name}.png` });
    const views = await collect(page, { root: "[data-tv-stage]", card: "[data-tv-card]", heads: ".tv-block__title > *, .tv-ko__round, .tv-tree__phase" });
    expect(views.length).toBeGreaterThan(0);
    expect(check(views)).toEqual([]);
  });
}
