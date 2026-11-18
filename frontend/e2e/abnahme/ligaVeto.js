const { expect } = require("@playwright/test");

// Das Map-Veto (D.3, #1618) für die Liga-Abnahmen, die nicht das Veto selbst prüfen: Neue Seasons haben das Veto an (Nr. 105), es
// beginnt, sobald beide Seiten eingecheckt sind, und erst danach geht Melden (docs/LIGA.md D.2/D.3). Den Ablauf im Browser prüft
// liga-veto-abnahme.spec.js; hier ziehen beide Captains über die API, damit Meldung und Ergebnis an der richtigen Stelle weiterlaufen.

/** Schreibende Aufrufe außerhalb des Browsers (mit CSRF-Kopf) - die Wache zählt sie nicht. */
async function send(page, method, url, data) {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "csrf_token")?.value || "";
  return page.request.fetch(url, { method, headers: { "X-CSRF-Token": decodeURIComponent(csrf) }, data });
}

/** Der Veto-Block der Matchseite, wie ihn die Seite liest. */
async function vetoOf(page, matchId) {
  const response = await page.request.get(`/api/matches/${matchId}/page`);
  expect(response.status()).toBe(200);
  return (await response.json()).checkin?.veto || null;
}

/**
 * Das laufende Veto zu Ende spielen: Die Seite am Zug nimmt die erste zulässige Map, bis die Spielreihenfolge steht.
 * `sides` ordnet jeder registration_id die Person (mit `page`) ihres Captains zu. Antwort: `planned_games` nach Position.
 */
async function playVeto(sides, matchId) {
  const anyone = Object.values(sides)[0];
  let block = await vetoOf(anyone.page, matchId);
  expect(block?.status, "das Veto läuft nach dem Check-in beider Seiten").toBe("running");
  for (let guard = 0; guard < 60 && block.status === "running"; guard += 1) {
    const actor = sides[block.current.registration_id];
    expect(actor, `Schritt ${block.current.number}: eine Seite des Spiels ist am Zug`).toBeTruthy();
    const option = block.options.find((row) => row.allowed);
    expect(option, `Schritt ${block.current.number}: eine wählbare Map`).toBeTruthy();
    const done = await send(actor.page, "POST", `/api/matches/${matchId}/veto/pick`, { map_id: option.map_id, version: block.version });
    expect(done.status(), await done.text()).toBe(200);
    block = await vetoOf(anyone.page, matchId);
  }
  expect(block.status).toBe("done");
  return [...block.planned_games].sort((left, right) => left.position - right.position);
}

module.exports = { playVeto, vetoOf };
