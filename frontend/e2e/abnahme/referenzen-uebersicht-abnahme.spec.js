const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");
const { createReferenceWorld, removeReferenceWorld, send, ok } = require("./referenzenDaten");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): die neu gestaltete Referenzen-Übersicht (#1878).
// Der Vorstand legt über die echten Routen Teilnahmen in vier Jahren, eine Rennliga mit Aufstieg, eine Team-Liga und eine
// Turnierserie mit einem Termin heute an (referenzenDaten.js) und wählt die Meister-Saison als Hauptkarte. Ohne Anmeldung
// zeigt /references bei 1440 und 360 px alle Abschnitte - Ehrentafel, Läuft gerade, Vitrine, Serien & Ligen, Chronik,
// Mitmachen -, die Filter der Chronik wirken, nichts läuft seitlich über, kein Name wird abgeschnitten, Touch-Ziele sind
// mindestens 44 px hoch, fremde Namen erscheinen nie; mit „Bewegung reduzieren“ bleibt nur das Einblenden.
// `ABNAHME_SHOTS` legt Bilder ab (optional). Nur erfundene Namen. Läuft nur mit ABNAHME=1.

const SHOTS = process.env.ABNAHME_SHOTS || "";

async function shot(locator, name, options = {}) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  // Die feste Leiste unten (Handy) läge sonst über dem Ausschnitt.
  await locator.page().evaluate(() => {
    for (const element of document.querySelectorAll("body *")) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.position === "fixed" && rect.bottom >= window.innerHeight - 2 && rect.height < 140) element.style.visibility = "hidden";
    }
  });
  await locator.screenshot({ path: path.join(SHOTS, `${name}.png`), ...options });
}

/** Sichtbare Elemente mit diesen Test-Kennungen, deren Text abgeschnitten ist (breiter als ihr Kasten). */
async function clipped(page, ids) {
  return page.evaluate((list) => {
    const out = [];
    for (const id of list) {
      for (const node of document.querySelectorAll(`[data-testid="${id}"]`)) {
        if (!node.offsetParent) continue;
        const style = getComputedStyle(node);
        if (node.scrollWidth > node.clientWidth + 1 || style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none") out.push(`${id}: ${node.textContent}`);
      }
    }
    return out;
  }, ids);
}

test.describe("Abnahme #1878: Referenzen - Übersicht neu", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.accounts?.admin, `Kein Seed-Stand: ${STATE_FILE} - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 420_000 });

  test("alle Abschnitte, Filter, kein Überlauf, keine gekürzten Namen, reduzierte Bewegung", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "ein Durchgang genügt");
    const stamp = Date.now().toString(36).slice(-4);
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const wideContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const phoneContext = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    let admin = null;
    let world = null;
    try {
      admin = await adminContext.newPage();
      await signIn(admin, "admin");
      world = await createReferenceWorld(admin, stamp);
      const champion = world.references.champion;
      const racing = world.lineages.racing;
      const cup = world.lineages.cup;
      const league = world.lineages.league;
      const cupNow = world.seasons.cup[2];

      // Die Verwaltung wählt die Meister-Saison der Rennliga als Hauptkarte.
      await admin.goto("/admin/references");
      const select = admin.getByTestId("reference-showcase-select");
      await expect(select.locator(`option[value="${champion.id}"]`)).toHaveCount(1);
      await select.selectOption(champion.id);
      await admin.getByTestId("reference-showcase-save").click();
      await expect.poll(async () => (await (await admin.request.get("/api/references/admin/showcase")).json()).reference_id).toBe(champion.id);
      await shot(admin.getByTestId("reference-showcase"), "referenzen-hauptkarte-verwaltung");

      for (const [context, name] of [[wideContext, "breit"], [phoneContext, "handy"]]) {
        const phone = name === "handy";
        const page = await context.newPage();
        await signIn(page, "anon");
        const problems = watch(page);
        await page.goto("/references");

        // Alle Abschnitte.
        for (const id of ["references-hero", "references-honor", "references-running", "references-trophies", "references-series", "references-timeline", "references-join"]) {
          await expect(page.getByTestId(id), id).toBeVisible();
        }
        await expect(page.getByTestId("references-stat-promotions")).toBeVisible();
        await expect(page.getByTestId("references-jump").getByText("Im Einsatz")).toHaveAttribute("href", "#einsatz");

        // Läuft gerade: die Turnierserie mit Termin heute trägt den goldenen Chip.
        const today = page.getByTestId(`running-card-${cup.slug}-${cupNow.season_slug}`);
        await expect(today).toHaveAttribute("data-today", "true");
        await expect(today.getByTestId("running-today-badge")).toBeVisible();
        await expect(today.getByTestId("running-progress-text")).toHaveText("2 von 5 Turnieren gewertet");
        await expect(today.getByTestId("running-place")).toContainText("5.");
        await expect(page.getByTestId(`running-card-${racing.slug}-${world.seasons.racing[2].season_slug}`).getByTestId("running-progress-text")).toHaveText("6 von 10 Rennen gewertet");

        // Vitrine: die gewählte Hauptkarte führt zur Saison.
        const main = page.getByTestId("references-showcase");
        await expect(main).toHaveAttribute("data-reference-id", champion.id);
        await expect(main).toHaveAttribute("href", `/references/series/${racing.slug}/${world.seasons.racing[1].season_slug}`);
        await expect(main).toContainText("Ausgewählt vom Verein");
        await expect(page.getByTestId(`reference-trophy-${world.references.spring.id}`)).toBeVisible();

        // Serien & Ligen: Liga-Weg mit Aufstieg und laufender Saison.
        const racingCard = page.getByTestId(`references-lineage-${racing.slug}`);
        await expect(racingCard.getByTestId("references-step")).toHaveCount(3);
        await expect(racingCard.locator('[data-note="Aufstieg"]')).toContainText("2025");
        await expect(racingCard.locator('[data-current="true"]')).toContainText("läuft");
        await expect(racingCard).toContainText("3 Saisons · 1 Aufstieg");
        await expect(page.getByTestId(`references-lineage-${league.slug}`).locator('[data-note="Aufstieg"]')).toContainText("Division 3");

        // Chronik: ein Name in zwei Einträgen steht einmal; der lange Name vollständig.
        const autumn = page.getByTestId(`reference-card-${world.references.autumn.id}`);
        const starters = autumn.getByTestId(phone ? "reference-row-starters-phone" : "reference-row-starters");
        await expect(starters).toHaveText(`${world.names.long}, Lions Kart ${stamp}`);

        // Filter: Spiel-Chip, „Nur Podest“, Anzahl „x von y Teilnahmen“.
        const count = page.getByTestId("references-count");
        const total = Number((await count.innerText()).match(/\d+/)[0]);
        await page.getByTestId("references-game-Valorant").click();
        await expect(page.getByTestId(`reference-card-${world.references.community.id}`)).toBeVisible();
        await expect(page.getByTestId(`reference-card-${world.references.spring.id}`)).toHaveCount(0);
        await expect(count).toContainText(`von ${total} Teilnahmen`);
        await page.getByTestId("references-podium").click();
        await expect(page.getByTestId(`reference-card-${world.references.community.id}`)).toHaveCount(0);
        await page.getByTestId("references-game-all").click();
        await expect(page.getByTestId(`reference-card-${world.references.spring.id}`)).toBeVisible();
        await expect(page.getByTestId(`reference-card-${world.references.showdown.id}`)).toHaveCount(0);
        await page.getByTestId("references-podium").click();
        await expect(count).toHaveText(`${total} Teilnahmen`);

        // Nichts läuft seitlich über, kein Name ist abgeschnitten, fremde Namen erscheinen nie.
        await page.waitForTimeout(1200); // Einblenden und Balken fertig
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        expect(await clipped(page, ["running-title", "running-season", "running-next", "references-showcase-title", "references-showcase-starters", "references-lineage-title", "reference-row-title", "reference-row-starters", "reference-row-starters-phone"])).toEqual([]);
        const text = await page.locator("body").innerText();
        expect(text).not.toContain(`Fremd 1 ${stamp}`);
        expect(text).not.toContain(`Fremd Team 1 ${stamp}`);

        // Touch-Ziele am Handy: Sprungmarken, Filter, Knöpfe mindestens 44 px hoch.
        if (phone) {
          const targets = page.locator('[data-testid="references-jump"] a, [data-testid="references-filters"] button, [data-testid="references-join"] a');
          for (const box of await targets.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44);
        }

        // Bilder.
        await shot(page.getByTestId("references-hero"), `referenzen-kopf-${name}`);
        await shot(page.getByTestId("references-running"), `referenzen-laeuft-gerade-${name}`);
        await shot(page.getByTestId("references-trophies"), `referenzen-vitrine-${name}`);
        await shot(page.getByTestId("references-series"), `referenzen-serien-${name}`);
        await shot(page.getByTestId("references-timeline-2025"), `referenzen-chronik-${name}`);

        // Bewegung: „Heute“ pulsiert, die Karte hebt sich unter der Maus (nur breit, nur mit Maus).
        const pulse = today.getByTestId("running-today-badge").locator(".tls-run-pulse");
        expect(await pulse.evaluate((node) => getComputedStyle(node).animationName)).toBe("tls-run-pulse");
        if (!phone) {
          await racingCard.hover();
          await page.waitForTimeout(400);
          expect(await racingCard.evaluate((node) => getComputedStyle(node).transform)).not.toBe("none");
        }

        // „Bewegung reduzieren“: nur Einblenden - kein Puls, kein Füllen, kein Anheben, kein Weg.
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.reload();
        await expect(page.getByTestId("references-running")).toBeVisible();
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tls-motion-on").trim())).toBe("0");
        const reduced = await page.evaluate(() => ({
          rise: getComputedStyle(document.querySelector(".tls-ref-rise")).animationName,
          pulse: getComputedStyle(document.querySelector(".tls-run-pulse")).animationName,
          fill: getComputedStyle(document.querySelector(".tls-ref-fill")).animationName,
        }));
        expect(reduced).toEqual({ rise: "tls-ref-rise", pulse: "none", fill: "none" });
        if (!phone) {
          const card = page.getByTestId(`references-lineage-${racing.slug}`);
          await card.hover();
          await page.waitForTimeout(400);
          expect(await card.evaluate((node) => getComputedStyle(node).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
        }
        await page.emulateMedia({ reducedMotion: "no-preference" });

        // Ganze Seite als Bild, danach der Link der Hauptkarte.
        await shot(page.locator("body"), `referenzen-ganz-${name}`);
        await page.getByTestId("references-showcase").click();
        await expect(page).toHaveURL(new RegExp(`/references/series/${racing.slug}/`));
        expect(problems).toEqual([]);
        await page.close();
      }
    } finally {
      if (admin) {
        await send(admin, "PATCH", "/api/references/admin/showcase", { mode: "auto" }).catch(() => {});
        await removeReferenceWorld(admin, world).catch(() => {});
      }
      await adminContext.close();
      await wideContext.close();
      await phoneContext.close();
    }
  });

  test("Vermerk der Saison (#1898): „Aufstieg“ ohne Zahl im Namen - auf der Übersicht und im Liga-Weg der Team-Liga", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "ein Durchgang genügt");
    const stamp = Date.now().toString(36).slice(-4);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    let admin = null;
    let lineage = null;
    try {
      admin = await context.newPage();
      await signIn(admin, "admin");
      lineage = await ok(await send(admin, "POST", "/api/reference-series/admin/lineages", {
        title: `Probe Medaillenliga ${stamp}`, kind: "team_league", label: "5vs5", organizer: "Probe Verband", tier_order: ["Gold", "Silber", "Bronze"] }));
      const seasons = [];
      for (const [season, tier, status, result] of [["2024", "Bronze", "completed", null], ["2025", "Silber", "completed", "promoted"], ["2026", "Gold", "active", null]]) {
        seasons.push(await ok(await send(admin, "POST", "/api/reference-series/admin/series", {
          lineage_id: lineage.id, season, tier, status, team_name: `Probe Löwen ${stamp}`, season_result: result })));
      }
      const page = await context.newPage();
      await signIn(page, "anon");
      await page.goto("/references");
      const card = page.getByTestId(`references-lineage-${lineage.slug}`);
      // 2024 Bronze → 2025 Silber leitet die Reihenfolge der Spur ab, 2025 trägt den Vermerk.
      await expect(card.locator('[data-note="Aufstieg"]')).toHaveCount(2);
      await expect(card.locator('[data-note="Aufstieg"]').nth(1)).toContainText("Silber");
      await expect(card).toContainText("3 Saisons · 2 Aufstiege");
      await page.waitForTimeout(1200); // Einblenden fertig
      await shot(card, "referenzen-liga-weg-vermerk");

      await page.goto(`/references/series/${lineage.slug}/${seasons[2].season_slug}`);
      const notes = page.getByTestId("team-league-season-note");
      await expect(notes).toHaveText(["Aufstieg", "Aufstieg"]);
      await page.getByTestId("team-league-path").scrollIntoViewIfNeeded();
      await page.waitForTimeout(1200); // Einblenden fertig
      await shot(page.getByTestId("team-league-path"), "serien-team-liga-weg-vermerk");
      await page.close();
    } finally {
      if (admin && lineage) await send(admin, "POST", `/api/reference-series/admin/lineages/${lineage.id}/archive`).catch(() => {});
      await context.close();
    }
  });

  test("ohne gewählte Hauptkarte wählt die Seite selbst - die Einstellung lässt sich lesen", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "ein Durchgang genügt");
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const admin = await context.newPage();
      await signIn(admin, "admin");
      expect(await ok(await admin.request.get("/api/references/admin/showcase"))).toEqual({ mode: "auto", reference_id: null });
      const listing = await ok(await admin.request.get("/api/references"));
      expect(listing.showcase).toEqual({ mode: "auto", reference_id: null });
    } finally {
      await context.close();
    }
  });
});
