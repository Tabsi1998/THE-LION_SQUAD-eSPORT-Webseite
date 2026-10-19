const { test, expect } = require("@playwright/test");
const { ENABLED, state, signIn } = require("./abnahmeSession");

// Abnahme gegen den echten, lokal laufenden Server (docs/entwicklung/abnahme-lokal.md): Sieg-Erfolge aus einem
// eingetragenen Ergebnis (#1796). Die Turnierleitung trägt über POST /api/matches/{id}/result einen Zu-Null-Sieg für
// Spieler 1 ein (nur Platz und Stand, kein „outcome“ - wie Web und App). Danach wertet Spieler 1 seine Erfolge aus:
// „Zu Null“ zählt einen Sieg mehr und Stufe I ist freigeschaltet. Läuft nur mit ABNAHME=1; Konten und Kennungen schreibt
// scripts/seed_abnahme.py nach .local-testing/abnahme/state.json (Turnier „Sofort zufällig“: K.-o. 8, noch ohne Ergebnis).

/** Schreiben wie die Website: mit dem CSRF-Kopf aus dem Cookie der Sitzung. */
async function post(page, url, data) {
  const cookies = await page.context().cookies();
  const csrf = decodeURIComponent(cookies.find((cookie) => cookie.name === "csrf_token")?.value || "");
  return page.request.post(url, { data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
}

test.describe("Abnahme: Zu-Null-Sieg aus eingetragenem Ergebnis", () => {
  test.skip(!ENABLED || !state?.tournaments?.mode_instant, "nur mit ABNAHME=1 und geseedetem Stand");

  async function cleanSheet(page) {
    const evaluated = await post(page, "/api/achievements/evaluate", {});
    expect(evaluated.status(), await evaluated.text()).toBe(200);
    const mine = await page.request.get("/api/achievements/me");
    expect(mine.status(), await mine.text()).toBe(200);
    const body = await mine.json();
    const group = (body.groups || []).find((row) => row.code === "clean_sheet");
    expect(group, "Erfolgsgruppe „Zu Null“ im Katalog").toBeTruthy();
    const ladder = (group.tiers || []).find((tier) => tier.code === "clean_sheet_2");
    const unlocked = (body.awards || []).some((award) => award.code === "clean_sheet_1");
    return { count: ladder ? ladder.current : 0, unlocked };
  }

  test("ein eingetragener Zu-Null-Sieg schaltet „Zu Null I“ frei", async ({ browser }) => {
    const playerContext = await browser.newContext();
    const staffContext = await browser.newContext();
    try {
      const playerPage = await playerContext.newPage();
      await signIn(playerPage, "player");
      const me = await (await playerPage.request.get("/api/auth/me")).json();
      const before = await cleanSheet(playerPage);

      const staffPage = await staffContext.newPage();
      await signIn(staffPage, "admin");
      const tournamentId = state.tournaments.mode_instant;
      const listed = await staffPage.request.get(`/api/tournaments/${tournamentId}/matches-v2`);
      expect(listed.status(), await listed.text()).toBe(200);
      const open = (await listed.json()).filter((row) => !row.is_preview && !(row.results || []).length
        && (row.slots || []).filter((slot) => slot.registration_id).length === 2);
      const match = open.find((row) => row.slots.some((slot) => slot.user_id === me.id));
      expect(match, "offenes Duell von Spieler 1").toBeTruthy();
      const mine = match.slots.find((slot) => slot.user_id === me.id).registration_id;
      const theirs = match.slots.find((slot) => slot.registration_id && slot.registration_id !== mine).registration_id;
      // Best-of des Spiels: der Sieger braucht genau die nötigen Siege, der Gegner hat keinen.
      const bestOf = Number(match.best_of || 1);
      const needed = bestOf > 1 ? Math.floor(bestOf / 2) + 1 : 1;
      const entered = await post(staffPage, `/api/matches/${match.id}/result`, { results: [
        { registration_id: mine, rank: 1, score: needed },
        { registration_id: theirs, rank: 2, score: 0 },
      ] });
      expect(entered.status(), await entered.text()).toBe(200);
      const stored = (await entered.json()).match;
      expect(stored.status).toBe("completed");
      expect(stored.results.every((row) => row.outcome === undefined || row.outcome === null)).toBe(true);

      const after = await cleanSheet(playerPage);
      expect(after.count).toBe(before.count + 1);
      expect(after.unlocked).toBe(true);
    } finally {
      await playerContext.close();
      await staffContext.close();
    }
  });
});
