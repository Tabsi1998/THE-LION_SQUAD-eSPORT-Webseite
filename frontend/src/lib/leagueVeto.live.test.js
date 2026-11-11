import {
  ANNOUNCE_AT, boardGroups, cardLabel, countdownAnnouncement, freshCards, isOlderVeto, isUrgent, mergeLiveVeto, secondsLeft, timelineLabel, timelineRows,
  VETO_POLL_MS, vetoClockOffset, vetoDeadline, vetoPollMs, vetoRingShare,
} from "./leagueVeto";

test("kurzer Abruf: gleicher Stand ersetzt nur den Veto-Block, ein neuer Stand lädt die ganze Seite", () => {
  const page = { match: { id: "m1" }, checkin: { state: "veto", sides: [1], veto: { status: "running", version: 3 } }, veto_view: null };
  const merged = mergeLiveVeto(page, { veto: { status: "running", version: 4 }, state: "veto" });
  expect(merged.checkin.veto.version).toBe(4);
  expect(merged.checkin.sides).toBe(page.checkin.sides);
  expect(merged.match).toBe(page.match);
  // Veto fertig, Stand „ready“: ganz neu laden (Start-Knopf, Meldeformular).
  expect(mergeLiveVeto(page, { veto: { status: "done", version: 12 }, state: "ready" })).toBeNull();
  expect(mergeLiveVeto(page, { veto: { status: "running", version: 4 }, state: "ready" })).toBeNull();
  expect(mergeLiveVeto(page, { veto: null })).toBeNull();
  // Zuschauer: nur `veto_view`.
  const outside = { match: { id: "m1" }, checkin: null, veto_view: { status: "running", version: 3 } };
  expect(mergeLiveVeto(outside, { veto: { status: "running", version: 5 }, state: null }).veto_view.version).toBe(5);
  expect(mergeLiveVeto(outside, { veto: { status: "paused", version: 4 }, state: null })).toBeNull();
});

test("Reihenfolge: eine ältere Antwort überschreibt nie eine neuere - Serverzeit zuerst, sonst die Version", () => {
  const shown = { status: "running", version: 5, server_now: "2026-11-15T19:00:10Z" };
  const page = { checkin: { state: "veto", veto: shown }, veto_view: null };
  // Älter nach Serverzeit (auch mit anderem Status): nichts ändern, nicht neu laden - die Seite selbst kommt zurück.
  expect(mergeLiveVeto(page, { veto: { ...shown, version: 4, server_now: "2026-11-15T19:00:08Z" }, state: "veto" })).toBe(page);
  expect(mergeLiveVeto(page, { veto: { status: "done", version: 9, server_now: "2026-11-15T19:00:09Z" }, state: "ready" })).toBe(page);
  // Gleiche Serverzeit, kleinere Version: ebenfalls älter.
  expect(mergeLiveVeto(page, { veto: { ...shown, version: 4 }, state: "veto" })).toBe(page);
  // Neuer: übernommen.
  const newer = mergeLiveVeto(page, { veto: { ...shown, version: 6, server_now: "2026-11-15T19:00:12Z" }, state: "veto" });
  expect(newer).not.toBe(page);
  expect(newer.checkin.veto.version).toBe(6);
  // Kleinere Version mit neuerer Serverzeit ist ein neues Veto (neuer Termin) - gilt.
  expect(isOlderVeto(shown, { version: 1, server_now: "2026-11-15T19:05:00Z" })).toBe(false);
  expect(isOlderVeto(null, shown)).toBe(false);
  // Zuschauer genauso.
  const outside = { checkin: null, veto_view: shown };
  expect(mergeLiveVeto(outside, { veto: { ...shown, version: 3, server_now: "2026-11-15T19:00:01Z" } })).toBe(outside);
});

// Map-Veto live (D.4, #1651): Takt des Nachfragens, Countdown nach der Serverzeit, Ansage, Zeitleiste, Karten und was aufleuchtet.

const AT = Date.parse("2026-11-15T19:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const running = (extra = {}) => ({
  status: "running", step_seconds: 60, current: { kind: "ban", mode: "hp", deadline_at: iso(AT + 40000) }, ...extra,
});

test("Takt: läuft 2 s, Pause 5 s, Warten auf Bereit oder Vorgabe 3 s nur mit beiden eingecheckt, sonst nie", () => {
  expect(VETO_POLL_MS).toEqual({ running: 2000, paused: 5000, waiting: 3000 });
  expect(vetoPollMs(running())).toBe(2000);
  expect(vetoPollMs({ status: "paused" })).toBe(5000);
  expect(vetoPollMs({ status: "waiting", start: { sides: [] } }, { bothIn: true })).toBe(3000);
  expect(vetoPollMs({ status: "waiting", blocked: { text: "fehlt" } }, { bothIn: true })).toBe(3000);
  // Gegenprobe: vor dem Check-in, ohne Wartegrund, fertig, ohne Block - nichts.
  expect(vetoPollMs({ status: "waiting", start: { sides: [] } })).toBe(0);
  expect(vetoPollMs({ status: "waiting" }, { bothIn: true })).toBe(0);
  expect(vetoPollMs({ status: "done" })).toBe(0);
  expect(vetoPollMs(null)).toBe(0);
});

test("Serverzeit: Geht das Gerät 10 Minuten nach, zählt der Countdown trotzdem die Frist des Servers", () => {
  const device = AT - 10 * 60 * 1000;
  const offset = vetoClockOffset(iso(AT), device);
  expect(offset).toBe(10 * 60 * 1000);
  const block = running();
  // Mit Ausgleich: 40 Sekunden ab „jetzt“ auf dem Gerät.
  expect(secondsLeft(vetoDeadline(block, offset), device)).toBe(40);
  expect(vetoRingShare(block, device, offset)).toBeCloseTo(40 / 60, 5);
  // Gegenprobe ohne Ausgleich: über zehn Minuten.
  expect(secondsLeft(vetoDeadline(block), device)).toBe(640);
  // Die halbe Laufzeit zählt nicht als Abweichung (Anfrage bei -200 ms, Antwort bei +200 ms).
  expect(vetoClockOffset(iso(AT), AT + 200, AT - 200)).toBe(0);
  expect(vetoClockOffset("kaputt", AT)).toBe(0);
  expect(vetoDeadline({ status: "paused", current: { deadline_at: iso(AT) } }, offset)).toBeNull();
});

test("die letzten zehn Sekunden sind betont, angesagt wird nur bei 30, 10 und 5 Sekunden und beim Ablauf", () => {
  expect(isUrgent(11)).toBe(false);
  expect(isUrgent(10)).toBe(true);
  expect(isUrgent(null)).toBe(false);
  expect(ANNOUNCE_AT).toEqual([30, 10, 5]);
  const said = new Set();
  for (let seconds = 60; seconds >= 0; seconds -= 1) said.add(countdownAnnouncement(seconds));
  expect([...said]).toEqual(["", "Noch 30 Sekunden.", "Noch 10 Sekunden.", "Noch 5 Sekunden.", "Zeit abgelaufen – das System wählt."]);
  // Der Satz ändert sich nur an den Marken: 29 bis 11 Sekunden bleibt es bei „30“.
  expect(countdownAnnouncement(29)).toBe("Noch 30 Sekunden.");
  expect(countdownAnnouncement(11)).toBe("Noch 30 Sekunden.");
  expect(countdownAnnouncement(null)).toBe("");
  expect(secondsLeft(AT + 1, AT)).toBe(1);
  expect(secondsLeft(AT - 5000, AT)).toBe(0);
});

const PLAN = [
  { index: 0, number: 1, kind: "ban", mode: "hp", mode_label: "Stellung", side: "A", name: "Löwen", position: null, state: "done",
    map_id: "glut", map_name: "Glut", map_image_url: null, via: "auto" },
  { index: 1, number: 2, kind: "pick", mode: "hp", mode_label: "Stellung", side: "B", name: "Falken", position: 1, state: "current",
    map_id: null, map_name: null, map_image_url: null, via: null },
  { index: 2, number: 3, kind: "decider", mode: "ctl", mode_label: "Kontrolle", side: null, name: null, position: 3, state: "open",
    map_id: null, map_name: null, map_image_url: null, via: null },
  { index: 3, number: 4, kind: "preset", mode: "ctl", mode_label: "Kontrolle", side: null, name: null, position: 2, state: "open",
    map_id: null, map_name: null, map_image_url: null, via: null },
];

test("Zeitleiste: Art, Seite, Ziel und Zustand je Schritt - fertige mit Map, Zufallswahl erkennbar", () => {
  const rows = timelineRows({ plan: PLAN });
  expect(rows.map((row) => [row.key, row.kindLabel, row.who, row.tone, row.target, row.auto])).toEqual([
    ["step-0", "Sperre", "Löwen", "a", "", true],
    ["step-1", "Wahl", "Falken", "b", "Map 1", false],
    ["step-2", "Decider", "System", "system", "Map 3", false],
    ["step-3", "Vorgabe", "Liga-Leitung", "system", "Map 2", false],
  ]);
  expect(timelineLabel(rows[0], 4)).toBe("Schritt 1 von 4: Löwen sperrt eine Map (Stellung) – Glut, das System hat gewählt");
  expect(timelineLabel(rows[1], 4)).toBe("Schritt 2 von 4: Falken wählt Map 1 (Stellung) – läuft");
  expect(timelineLabel(rows[2], 4)).toBe("Schritt 3 von 4: Decider für Map 3 (Kontrolle)");
  expect(timelineRows({})).toEqual([]);
});

const REMAINING = (statuses = {}) => [
  { mode: "hp", label: "Stellung", maps: [
    { map_id: "glut", name: "Glut", status: statuses.glut || "open", side: statuses.glutSide || null, by_name: statuses.glutBy || null, position: null },
    { map_id: "hafen", name: "Hafen", status: statuses.hafen || "open", side: statuses.hafenSide || null, by_name: null, position: statuses.hafenAt || null },
  ] },
  { mode: "ctl", label: "Kontrolle", maps: [{ map_id: "kai", name: "Kai", status: "preset", side: null, by_name: null, position: 3 }] },
];

test("Brett: nur die Karten des laufenden Modus sind die Auswahl, wählbar nur die freigegebenen", () => {
  const block = {
    status: "running", can_pick: true, current: { kind: "ban", mode: "hp" }, remaining: REMAINING({ glut: "banned", glutSide: "B", glutBy: "Falken" }),
    options: [{ map_id: "glut", allowed: false, hint: "Glut ist in diesem Modus schon gesperrt oder gewählt." }, { map_id: "hafen", allowed: true, hint: null }],
  };
  const groups = boardGroups(block);
  expect(groups.map((group) => group.current)).toEqual([true, false]);
  const [glut, hafen] = groups[0].cards;
  expect([glut.key, glut.pickable, glut.selectable, glut.tone, glut.statusText]).toEqual(["hp:glut", true, false, "b", "gesperrt von Falken"]);
  expect([hafen.pickable, hafen.selectable]).toEqual([true, true]);
  expect(cardLabel(hafen, "ban")).toBe("Hafen: offen – antippen zum Sperren");
  expect(cardLabel(glut, "ban")).toBe("Glut: gesperrt von Falken – Glut ist in diesem Modus schon gesperrt oder gewählt.");
  expect(groups[1].cards[0].pickable).toBe(false);
  // Gegenprobe: Ist die Gegenseite am Zug, ist nichts antippbar.
  expect(boardGroups({ ...block, can_pick: false })[0].cards.some((card) => card.pickable)).toBe(false);
});

test("Aufleuchten: jede Wahl und jede Aktion der Gegenseite - nicht die eigene Sperre, nicht der erste Stand", () => {
  const before = REMAINING();
  expect(freshCards(null, before, "A").size).toBe(0);
  expect(freshCards(before, before, "A").size).toBe(0);
  // Die Gegenseite (B) sperrt Glut: leuchtet.
  expect([...freshCards(before, REMAINING({ glut: "banned", glutSide: "B" }), "A")]).toEqual(["hp:glut"]);
  // Die eigene Sperre dimmt nur.
  expect(freshCards(before, REMAINING({ glut: "banned", glutSide: "A" }), "A").size).toBe(0);
  // Eine eigene Wahl leuchtet auch.
  expect([...freshCards(before, REMAINING({ hafen: "picked", hafenSide: "A", hafenAt: 1 }), "A")]).toEqual(["hp:hafen"]);
  // Zuschauer (keine Seite): jede Aktion.
  expect([...freshCards(before, REMAINING({ glut: "banned", glutSide: "A" }), null)]).toEqual(["hp:glut"]);
});
