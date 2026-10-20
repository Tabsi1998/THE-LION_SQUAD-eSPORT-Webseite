const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test, expect } = require("@playwright/test");
const { ENABLED, state, signIn, watch } = require("./abnahmeSession");

// Abnahme #1823 gegen den echten Server (docs/entwicklung/abnahme-lokal.md): „nicht erschienen“ im Lauf mit vier
// Spielern (Läufe-Cup live aus dem Seed), zwei fehlen. Die Frist läuft ab, die Turnierleitung tippt nacheinander
// „<Name> nicht erschienen“ - der Fall bleibt für die anderen offen (je Person), der Lauf bleibt offen, nur die zwei
// sind markiert (Leitung, Warteschlange, Baum, TV, Druck). Im Ergebnis-Fenster sind sie schon als nicht erschienen
// gesetzt; die zwei Anwesenden werden in Zielreihenfolge eingetragen und kommen weiter, die zwei Fehlenden teilen sich
// den letzten Platz und gehen ins Loser Bracket. Im Duell (Online-Abend) bleibt es „kampflos“ für den Gegner.
//
// Die Frist („nicht erschienen“ 10 Minuten nach dem Aufruf) prüft am Abend der Job match_deadlines jede Minute; der
// Abnahme-Stand lässt ihn aus. Hier ruft der Test das Spiel deshalb rückdatiert auf und prüft die Frist einmal im
// Backend-Container - mit denselben Bausteinen wie der Job, nur für dieses eine Spiel (wie `probelauf_mitspieler.py
// fristen`). Container: ``<ABNAHME_PROJECT>-backend``. Läuft nur mit ABNAHME=1 auf einem frisch befüllten Stand.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const PROJECT = process.env.ABNAHME_PROJECT || "lsw-abnahme";
const HOLD_WAIT = 40_000;
const TV_WAIT = 60_000;

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

/** Schreiben wie die Website: mit dem CSRF-Kopf aus dem Cookie der Sitzung. */
async function post(page, url, data) {
  const cookies = await page.context().cookies();
  const csrf = decodeURIComponent(cookies.find((cookie) => cookie.name === "csrf_token")?.value || "");
  return page.request.post(url, { data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
}

async function matchesOf(page, tid) {
  const response = await page.request.get(`/api/tournaments/${tid}/matches-v2`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).filter((row) => !row.is_preview);
}

const byKey = (rows) => Object.fromEntries(rows.map((row) => [row.match_key, row]));
const seated = (match) => [...(match.slots || [])].sort((a, b) => Number(a.slot) - Number(b.slot))
  .filter((slot) => slot.registration_id).map((slot) => slot.registration_id);

/**
 * Die Frist eines Spiels ist um: im Backend-Container rückdatiert aufrufen (vor 30 Minuten) und die Frist prüfen wie
 * der Job match_deadlines (services/match_deadline_sweep). Antwort: wie viele Vorschläge entstanden sind.
 */
function deadlinePassed(matchId) {
  const code = `
import asyncio, json, sys
from datetime import timedelta
sys.path.insert(0, "/app")

async def main():
    from database import get_db
    from models import now_utc
    from services import match_deadline_sweep as deadlines
    db = get_db()
    now = now_utc()
    await db.matches_v2.update_one({"id": ${JSON.stringify(matchId)}}, {"$set": {"called_at": (now - timedelta(minutes=30)).isoformat()}})
    match = await db.matches_v2.find_one({"id": ${JSON.stringify(matchId)}}, {"_id": 0})
    tournament = await db.tournaments.find_one({"id": match["tournament_id"]}, {"_id": 0, "creation_key": 0, "billing": 0})
    stage = await db.tournament_stages.find_one({"id": match.get("stage_id")}, {"_id": 0})
    info = deadlines.no_show_deadline(match, tournament, stage)
    proposed = await deadlines._propose_no_show(db, tournament, match, info, now) if info and info["due_at"] <= now else 0
    print(json.dumps({"proposed": proposed, "due_at": info["due_at"].isoformat() if info else None}))

asyncio.run(main())
`;
  const out = execFileSync("docker", ["exec", "-i", `${PROJECT}-backend`, "python", "-"], { input: code, encoding: "utf8" });
  return JSON.parse(out.trim().split("\n").pop());
}

/** Warten, bis das Ergebnis nach den 10 Sekunden „Rückgängig“ gilt. */
async function published(page, tid, matchId) {
  await expect.poll(async () => {
    const row = (await matchesOf(page, tid)).find((match) => match.id === matchId);
    return row?.pending_result ? "hält noch" : row?.status;
  }, { message: "Ergebnis wurde nicht veröffentlicht", timeout: HOLD_WAIT }).toMatch(/^(completed|forfeit)$/);
}

test.describe("Abnahme: nicht erschienen im Lauf (#1823)", () => {
  test.skip(!ENABLED || !state, "nur mit ABNAHME=1 und einem befüllten Abnahme-Stand");
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");
  test.describe.configure({ mode: "serial" });

  test("Lauf zu viert, zwei fehlen: je Person markiert, der Lauf bleibt offen, die zwei Anwesenden werden eingetragen", async ({ browser, page }, testInfo) => {
    test.setTimeout(240_000);
    const tid = state.tournaments.local_live;
    const slug = state.slugs?.local_live || tid;
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, "lead");
    const problems = watch(page);

    const heat = byKey(await matchesOf(page, tid)).D;
    expect(heat, "Lauf D aus dem Seed").toBeTruthy();
    expect(seated(heat)).toHaveLength(4);
    const [first, missing, third, absent] = seated(heat);
    expect(deadlinePassed(heat.id).proposed, "die Frist ist um - genau ein Vorschlag").toBe(1);

    // Turnierleitung: „Braucht Aufmerksamkeit“ - ein Tipp auf den Namen.
    await page.goto(`/tournaments/${slug}/leitung?fall=ns-${heat.id}`);
    const card = page.getByTestId(`lead-case-ns-${heat.id}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("Lauf bleibt offen");
    await expect(card).not.toContainText("kampflos");
    await shot(page, `${testInfo.project.name}-lauf-vorschlag.png`);
    await page.getByTestId(`lead-no-show-${missing}`).click();
    await expect(page.getByText("Als nicht erschienen markiert – der Lauf bleibt offen.")).toBeVisible();
    // Je Person: der Fall bleibt für alle anderen offen - die zweite Fehlende wird genauso markiert.
    await expect(page.getByTestId(`lead-no-show-${missing}`)).toHaveCount(0);
    await page.getByTestId(`lead-no-show-${absent}`).click();
    await expect(page.getByTestId(`lead-no-show-${absent}`)).toHaveCount(0);
    for (const id of [first, third]) await expect(page.getByTestId(`lead-no-show-${id}`)).toBeVisible();

    let stored = (await matchesOf(page, tid)).find((match) => match.id === heat.id);
    expect(stored.status, "der Lauf ist nicht beendet").toMatch(/^(ready|scheduled)$/);
    expect(stored.results || []).toEqual([]);
    expect([...stored.no_show_registration_ids].sort()).toEqual([missing, absent].sort());

    // Warteschlange: der Lauf ist weiter aufgerufen und wartet - nicht beendet.
    const queue = await (await page.request.get(`/api/tournaments/${tid}/live-queue`)).json();
    expect(queue.matches?.[heat.id]?.state, "Warteschlange zeigt den Lauf als aufgerufen").toBe("called");
    expect(queue.matches[heat.id].no_show_names, "wer fehlt, steht in der Warteschlange").toHaveLength(2);

    // Druck: „n. e.“ bei beiden, schon vor dem Eintragen.
    await page.goto(`/print/tournaments/${slug}?teile=baum`);
    const printed = page.getByTestId("print-match").filter({ hasText: "Lauf D" });
    await expect(printed.getByTestId("print-no-show")).toHaveCount(2);

    // Baum: die Person durchgestrichen, die anderen nicht, keine Plätze.
    await page.goto(`/tournaments/${slug}/bracket`);
    const tree = page.getByTestId(`bracket-heat-${heat.id}`);
    await expect(tree).toBeVisible();
    for (const gone of [missing, absent]) await expect(tree.locator(`[data-row='${heat.id}:${gone}']`)).toHaveAttribute("data-out", "1");
    for (const other of [first, third]) await expect(tree.locator(`[data-row='${heat.id}:${other}']`)).not.toHaveAttribute("data-out", "1");
    await tree.scrollIntoViewIfNeeded();
    await shot(page, `${testInfo.project.name}-lauf-baum.png`);

    // TV mit Anzeige-Schlüssel: „nicht angetreten“ nur bei der Person.
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signIn(admin, "admin");
    const created = await post(admin, "/api/tv/keys", { tournament_id: tid, label: "Abnahme-TV #1823" });
    expect(created.status(), await created.text()).toBe(200);
    const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const tv = await tvContext.newPage();
    await signIn(tv, "anon");
    await tv.goto((await created.json()).path);
    const tvCard = tv.getByTestId(`tv-match-${heat.id}`);
    await expect(tvCard.locator(`[data-tv-reg='${missing}']`)).toContainText("nicht angetreten", { timeout: TV_WAIT });
    await expect(tvCard.locator(".tv-row--gone")).toHaveCount(2);
    await shot(tv, `${testInfo.project.name}-lauf-tv.png`);
    await tvContext.close();
    await adminContext.close();

    // Ergebnis-Fenster: „Nicht erschienen“ schon gesetzt - die drei Anwesenden in Zielreihenfolge.
    await page.goto(`/tournaments/${slug}/leitung?spiel=${heat.id}`);
    await expect(page.getByTestId("result-window")).toBeVisible();
    for (const gone of [missing, absent]) await expect(page.getByTestId(`result-flag-${gone}-no_show`)).toHaveAttribute("aria-pressed", "true");
    for (const id of [third, first]) await page.getByTestId(`result-order-${id}`).click();
    await shot(page, `${testInfo.project.name}-lauf-fenster.png`);
    await page.getByTestId("result-save").click();
    await published(page, tid, heat.id);

    stored = (await matchesOf(page, tid)).find((match) => match.id === heat.id);
    // Die zwei Fehlenden teilen sich den letzten Platz (Reihenfolge nach Setzplatz).
    expect(stored.results.slice(0, 2).map((row) => [row.registration_id, row.rank, Boolean(row.forfeit)])).toEqual([[third, 1, false], [first, 2, false]]);
    expect(stored.results.slice(2).map((row) => [row.rank, Boolean(row.forfeit)])).toEqual([[3, true], [3, true]]);
    expect(stored.results.slice(2).map((row) => row.registration_id).sort()).toEqual([missing, absent].sort());
    await page.goto(`/print/tournaments/${slug}?teile=baum`);
    await expect(page.getByTestId("print-match").filter({ hasText: "Lauf D" }).getByTestId("print-no-show")).toHaveCount(2);
    await shot(page, `${testInfo.project.name}-lauf-druck.png`);

    // Weiterkommen: Lauf C (läuft seit dem Seed) eintragen - die Runde ist fertig und wird gelost. Die zwei Besten aus D
    // stehen in Runde 2, die zwei Fehlenden nicht (nur auf dem Verlierer-Weg, wie im Duell).
    const running = byKey(await matchesOf(page, tid)).C;
    const saved = await post(page, `/api/matches/${running.id}/result`, {
      results: seated(running).map((registration, index) => ({ registration_id: registration, rank: index + 1 })) });
    expect(saved.status(), await saved.text()).toBe(200);
    await published(page, tid, running.id);
    await expect.poll(async () => {
      const rows = byKey(await matchesOf(page, tid));
      // Läufe-Cup (seed_abnahme.CUP_SCHEMA): Runde 2 im Winner Bracket E und F, Runde 1 im Loser Bracket LA und LB.
      const winners = ["E", "F"].flatMap((key) => seated(rows[key] || {}));
      const losers = ["LA", "LB"].flatMap((key) => seated(rows[key] || {}));
      return {
        third: winners.includes(third), first: winners.includes(first),
        missingUp: winners.includes(missing) || winners.includes(absent), missingDown: losers.includes(missing) && losers.includes(absent),
      };
    }, { message: "Weiterkommen aus Lauf D", timeout: HOLD_WAIT }).toEqual({ third: true, first: true, missingUp: false, missingDown: true });
    expect(problems).toEqual([]);
  });

  test("Duell (Online-Abend): nicht erschienen bleibt kampflos für den Gegner", async ({ page }) => {
    test.setTimeout(120_000);
    const tid = state.tournaments.online;
    const slug = state.slugs?.online || tid;
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, "lead");
    const problems = watch(page);

    const duel = (await matchesOf(page, tid))
      .filter((row) => seated(row).length === 2 && /^(ready|scheduled)$/.test(row.status || ""))
      .sort((a, b) => Number(a.round) - Number(b.round) || String(a.match_key).localeCompare(String(b.match_key)))[0];
    expect(duel, "ein offenes Duell im Online-Abend").toBeTruthy();
    const [winner, loser] = seated(duel);
    expect(deadlinePassed(duel.id).proposed).toBe(1);

    await page.goto(`/tournaments/${slug}/leitung?fall=ns-${duel.id}`);
    await expect(page.getByTestId(`lead-case-ns-${duel.id}`)).toContainText("kampflos werten");
    await page.getByTestId(`lead-no-show-${loser}`).click();
    await expect(page.getByText("Kampflos gewertet – beide Seiten bekommen Bescheid.")).toBeVisible();

    const rows = await matchesOf(page, tid);
    const stored = rows.find((row) => row.id === duel.id);
    expect(stored.status).toBe("forfeit");
    expect(stored.results.map((row) => [row.registration_id, row.rank, Boolean(row.forfeit)])).toEqual([[winner, 1, false], [loser, 2, true]]);
    expect(rows.some((row) => Number(row.round) > Number(duel.round) && seated(row).includes(winner)), "der Gegner rückt weiter").toBe(true);
    expect(problems).toEqual([]);
  });
});
