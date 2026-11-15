import {
  ANNOUNCE_AT, actionWord, boardGroups, cardLabel, countdownAnnouncement, freshCards, historyLine, isOlderVeto, isUrgent, keepNewerVeto,
  mapStatusText, mergeLiveVeto, ownTurnQuestion, plannedRoleLabel, readyText, secondsLeft, stepLabel, timelineLabel, timelineRows,
  VETO_POLL_MS, vetoClockOffset, vetoDeadline, vetoHeadline, vetoPollMs, vetoRingShare, vetoText, vetoVisible,
  type VetoBlock, type VetoCurrent, type VetoGroup, type VetoPlanRow,
} from "./leagueVeto";

// Map-Veto auf der Matchseite (#2173): dieselben Fälle wie im Web (frontend/src/lib/leagueVeto.test.js, leagueVeto.live.test.js,
// leagueVeto.preset.test.js, Teil „Matchseite“). Erfundene Modi und Maps.

describe("Matchseite", () => {
  const current: VetoCurrent = { index: 2, number: 3, total: 11, kind: "pick", mode: "hp", mode_label: "Stellung", name: "Loewen", position: 1, deadline_at: new Date(Date.now() + 30000).toISOString() };

  it("sagt in einem Satz, wer dran ist und was zu tun ist", () => {
    expect(vetoText({ status: "running", own_turn: true, current, step_seconds: 60 })).toBe("Ihr seid am Zug: wählt Map 1 (Stellung). Nach 60 Sekunden wählt das System.");
    expect(vetoText({ status: "running", own_turn: false, current: { ...current, kind: "ban" } })).toBe("Loewen ist am Zug: sperrt eine Map (Stellung).");
    expect(vetoText({ status: "running", current: { ...current, kind: "decider", position: 3 } })).toBe("Die übrige Map wird Map 3 – das setzt das System.");
    expect(vetoText({ status: "paused", paused: { reason: "Störung" } })).toBe("Die Liga-Leitung hat das Veto angehalten – Störung. Es geht weiter, sobald sie es fortsetzt.");
    expect(vetoText({ status: "done" })).toBe("Die Spielreihenfolge steht – Map 1 kann beginnen.");
    expect(vetoText({ status: "skipped", skipped_reason: "Position 4 gibt es bei Best of 3 nicht." })).toContain("läuft kein Veto: Position 4");
    expect(vetoText({ status: "waiting" })).toContain("Sobald beide Seiten eingecheckt sind");
    expect(stepLabel(current)).toBe("Schritt 3 von 11 · Stellung · Loewen wählt Map 1");
    expect(stepLabel({ ...current, kind: "decider", name: null, position: 3 })).toBe("Schritt 3 von 11 · Stellung · Decider für Map 3");
    expect(actionWord("ban")).toBe("Sperren");
    expect(actionWord("pick")).toBe("Wählen");
    expect(ownTurnQuestion({ ...current, kind: "ban" })).toBe("Welche Map sperrt ihr (Stellung)?");
    expect(ownTurnQuestion(current)).toBe("Welche Map spielt ihr als Map 1 (Stellung)?");
  });

  it("Countdown nur im laufenden Schritt, der Ring über die Zeit je Schritt", () => {
    const block: VetoBlock = { status: "running", current, step_seconds: 60 };
    expect(vetoDeadline(block)).toBe(new Date(String(current.deadline_at)).getTime());
    expect(vetoDeadline({ ...block, status: "paused" })).toBeNull();
    expect(vetoRingShare(block, new Date(String(current.deadline_at)).getTime() - 30000)).toBeCloseTo(0.5, 1);
    expect(vetoRingShare({ ...block, status: "done" })).toBe(1);
  });

  it("Zeilen für Maps und Verlauf", () => {
    expect(mapStatusText({ status: "banned", by_name: "Loewen" })).toBe("gesperrt von Loewen");
    expect(mapStatusText({ status: "picked", position: 1, by_name: "Loewen" })).toBe("Map 1 · Loewen");
    expect(mapStatusText({ status: "decider", position: 3 })).toBe("Map 3 · Decider");
    expect(mapStatusText({ status: "elsewhere", position: 1 })).toBe("in anderem Modus gespielt (Map 1)");
    expect(mapStatusText({ status: "open" })).toBe("offen");
    expect(historyLine({ index: 0, kind: "ban", name: "Loewen", map_name: "Glut", mode_label: "Stellung", via: "side" })).toBe("1. Loewen sperrt Glut (Stellung)");
    expect(historyLine({ index: 2, kind: "pick", name: "Loewen", map_name: "Hafen", mode_label: "Stellung", position: 1, via: "auto" }))
      .toBe("3. Loewen wählt Hafen → Map 1 (Stellung) · Zeit abgelaufen, das System hat gewählt");
    expect(historyLine({ index: 10, kind: "decider", map_name: "Hafen", mode_label: "Kontrolle", position: 3, via: "auto" })).toBe("11. Decider: Hafen → Map 3 (Kontrolle)");
  });

  it("nennt die Vorgabe der Woche in Brett, Verlauf, Schritt und Spielreihenfolge", () => {
    expect(mapStatusText({ status: "preset", position: 3 })).toBe("Map 3 · Vorgabe der Woche");
    expect(historyLine({ index: 8, kind: "preset", map_name: "Kai", position: 3, mode_label: "Kontrolle", via: "auto" })).toBe("9. Vorgabe der Woche: Kai → Map 3 (Kontrolle)");
    expect(stepLabel({ number: 9, total: 9, kind: "preset", mode_label: "Kontrolle", position: 3, name: null })).toBe("Schritt 9 von 9 · Kontrolle · Vorgabe der Woche für Map 3");
    expect(vetoText({ status: "running", current: { kind: "preset", position: 3 } })).toBe("Die Vorgabe der Woche wird Map 3 – das setzt das System.");
    expect(plannedRoleLabel("preset")).toBe("Vorgabe der Woche");
    expect(plannedRoleLabel("decider")).toBe("Decider");
    expect(plannedRoleLabel("picked")).toBe("");
  });

  it("sagt klar, wenn das Veto auf die Vorgabe wartet", () => {
    const text = "Für Spielwoche 3 steht die Vorgabe der Woche noch nicht – Kontrolle: Die Vorgabe der Woche fehlt. Das Veto beginnt erst, wenn die Liga-Leitung sie eingetragen hat.";
    const blocked: VetoBlock = { status: "waiting", blocked: { week: 3, text } };
    expect(vetoHeadline(blocked)).toBe("Veto wartet auf die Vorgabe der Woche");
    expect(vetoText(blocked)).toBe(text);
    const waiting: VetoBlock = { status: "waiting", blocked: null };
    expect(vetoHeadline(waiting)).toBe("Vorgabe der Woche");
    expect(vetoText(waiting)).toBe("Sobald beide Seiten eingecheckt sind, beginnt das Map-Veto – danach startet Map 1.");
    expect(vetoHeadline({ status: "running" })).toBe("Veto läuft");
  });

  it("nachgetragen: beide Seiten tippen „Bereit zum Veto“ - der Satz sagt jeder Seite, wer schon bereit ist", () => {
    const sides = (own: boolean, other: boolean) => [{ registration_id: "a", name: "Löwen", ready: own, own: true }, { registration_id: "b", name: "Falken", ready: other, own: false }];
    const start = { sides: sides(false, false), own_ready: false, other_ready: false, can_ready: true, can_withdraw: false };
    const ready: VetoBlock = { status: "waiting", blocked: null, presets: [{ mode: "ctl" }], start };
    expect(vetoHeadline(ready)).toBe("Vorgabe steht – bereit zum Veto?");
    expect(vetoHeadline({ ...ready, presets: [] })).toBe("Bereit zum Veto?");
    expect(vetoText(ready)).toBe("Tippt auf „Bereit zum Veto“, sobald ihr so weit seid. Das Veto beginnt, wenn beide Seiten bereit sind.");
    expect(readyText({ ...start, sides: sides(true, false), own_ready: true, can_ready: false, can_withdraw: true })).toBe("Ihr seid bereit – wartet auf die Gegenseite.");
    expect(readyText({ ...start, sides: sides(false, true), other_ready: true })).toBe("Falken ist bereit – tippt auf „Bereit zum Veto“, dann beginnt es sofort.");
    const watching = sides(true, false).map((row) => ({ ...row, own: false }));
    expect(readyText({ ...start, sides: watching, can_ready: false })).toBe("Löwen ist bereit. Das Veto beginnt, sobald beide Seiten „Bereit zum Veto“ getippt haben.");
    expect(readyText({ ...start, sides: watching.map((row) => ({ ...row, ready: false })), can_ready: false })).toBe("Das Veto beginnt, sobald beide Seiten „Bereit zum Veto“ getippt haben.");
  });

  it("beide bereit, aber die Vorgabe fehlt wieder: die fehlende Vorgabe geht vor", () => {
    const text = "Das Veto beginnt, sobald die Liga-Leitung die Vorgabe für Spielwoche 1 eingetragen hat.";
    const sides = [{ registration_id: "a", name: "Löwen", ready: true, own: true }, { registration_id: "b", name: "Falken", ready: true, own: false }];
    const start = { sides, own_ready: true, other_ready: true, can_ready: false, can_withdraw: true };
    const stuck: VetoBlock = { status: "waiting", blocked: { week: 1, text }, presets: [], start };
    expect(vetoHeadline(stuck)).toBe("Veto wartet auf die Vorgabe der Woche");
    expect(vetoText(stuck)).toBe(text);
    const back: VetoBlock = { ...stuck, blocked: null, presets: [{ mode: "ctl" }] };
    expect(vetoHeadline(back)).toBe("Vorgabe steht – bereit zum Veto?");
    expect(vetoText(back)).toBe("Beide Seiten sind bereit – das Veto beginnt gleich.");
    expect(readyText({ ...start, sides: [sides[0], { ...sides[1], ready: false }], other_ready: false })).toBe("Ihr seid bereit – wartet auf die Gegenseite.");
  });

  it("vor dem Start zeigt der Block nur etwas mit Vorgabe, fehlender Vorgabe oder „bereit zum Veto?“", () => {
    expect(vetoVisible({ status: "waiting" })).toBe(false);
    expect(vetoVisible({ status: "waiting", presets: [{ mode: "ctl" }] })).toBe(true);
    expect(vetoVisible({ status: "waiting", blocked: { text: "fehlt" } })).toBe(true);
    expect(vetoVisible({ status: "waiting", start: { sides: [] } })).toBe(true);
    expect(vetoVisible({ status: "running" })).toBe(true);
    expect(vetoVisible(null)).toBe(false);
  });
});

test("kurzer Abruf: gleicher Stand ersetzt nur den Veto-Block, ein neuer Stand lädt die ganze Seite", () => {
  const page = { match: { id: "m1" }, checkin: { state: "veto", sides: [1], veto: { status: "running", version: 3 } }, veto_view: null };
  const merged = mergeLiveVeto(page, { veto: { status: "running", version: 4 }, state: "veto" });
  expect(merged?.checkin?.veto?.version).toBe(4);
  expect(merged?.checkin?.sides).toBe(page.checkin.sides);
  expect(merged?.match).toBe(page.match);
  expect(mergeLiveVeto(page, { veto: { status: "done", version: 12 }, state: "ready" })).toBeNull();
  expect(mergeLiveVeto(page, { veto: { status: "running", version: 4 }, state: "ready" })).toBeNull();
  expect(mergeLiveVeto(page, { veto: null })).toBeNull();
  const outside = { match: { id: "m1" }, checkin: null, veto_view: { status: "running", version: 3 } };
  expect(mergeLiveVeto(outside, { veto: { status: "running", version: 5 }, state: null })?.veto_view?.version).toBe(5);
  expect(mergeLiveVeto(outside, { veto: { status: "paused", version: 4 }, state: null })).toBeNull();
});

test("volles Neuladen: ein älterer Veto-Block bleibt draußen, der übrige Seitenstand kommt aus der neuen Antwort", () => {
  const newer = { status: "running", version: 6, server_now: "2026-11-15T19:00:12Z" };
  const older = { status: "running", version: 5, server_now: "2026-11-15T19:00:10Z" };
  const shown = { match: { id: "m1" }, checkin: { state: "veto", sides: ["alt"], veto: newer }, veto_view: null };
  const page = { match: { id: "m1", note: "neu" }, checkin: { state: "veto", sides: ["neu"], veto: older }, veto_view: null };
  const next = keepNewerVeto(shown, page);
  expect(next.checkin?.veto).toBe(newer);
  expect(next.checkin?.sides).toEqual(["neu"]);
  expect((next.match as { note?: string }).note).toBe("neu");
  const fresh = { ...page, checkin: { ...page.checkin, veto: { ...newer, version: 7, server_now: "2026-11-15T19:00:13Z" } } };
  expect(keepNewerVeto(shown, fresh)).toBe(fresh);
  expect(keepNewerVeto(null, page)).toBe(page);
});

test("Reihenfolge: eine ältere Antwort überschreibt nie eine neuere - Serverzeit zuerst, sonst die Version", () => {
  const shown = { status: "running", version: 5, server_now: "2026-11-15T19:00:10Z" };
  const page = { checkin: { state: "veto", veto: shown }, veto_view: null };
  expect(mergeLiveVeto(page, { veto: { ...shown, version: 4, server_now: "2026-11-15T19:00:08Z" }, state: "veto" })).toBe(page);
  expect(mergeLiveVeto(page, { veto: { status: "done", version: 9, server_now: "2026-11-15T19:00:09Z" }, state: "ready" })).toBe(page);
  expect(mergeLiveVeto(page, { veto: { ...shown, version: 4 }, state: "veto" })).toBe(page);
  const newer = mergeLiveVeto(page, { veto: { ...shown, version: 6, server_now: "2026-11-15T19:00:12Z" }, state: "veto" });
  expect(newer).not.toBe(page);
  expect(newer?.checkin?.veto?.version).toBe(6);
  expect(isOlderVeto(shown, { version: 1, server_now: "2026-11-15T19:05:00Z" })).toBe(false);
  expect(isOlderVeto(null, shown)).toBe(false);
});

const AT = Date.parse("2026-11-15T19:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const running = (extra: Partial<VetoBlock> = {}): VetoBlock => ({
  status: "running", step_seconds: 60, current: { kind: "ban", mode: "hp", deadline_at: iso(AT + 40000) }, ...extra,
});

test("Takt: läuft 2 s, Pause 5 s, Warten auf Bereit oder Vorgabe 3 s nur mit beiden eingecheckt, sonst nie", () => {
  expect(VETO_POLL_MS).toEqual({ running: 2000, paused: 5000, waiting: 3000 });
  expect(vetoPollMs(running())).toBe(2000);
  expect(vetoPollMs({ status: "paused" })).toBe(5000);
  expect(vetoPollMs({ status: "waiting", start: { sides: [] } }, { bothIn: true })).toBe(3000);
  expect(vetoPollMs({ status: "waiting", blocked: { text: "fehlt" } }, { bothIn: true })).toBe(3000);
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
  expect(secondsLeft(vetoDeadline(block, offset), device)).toBe(40);
  expect(vetoRingShare(block, device, offset)).toBeCloseTo(40 / 60, 5);
  expect(secondsLeft(vetoDeadline(block), device)).toBe(640);
  expect(vetoClockOffset(iso(AT), AT + 200, AT - 200)).toBe(0);
  expect(vetoClockOffset("kaputt", AT)).toBe(0);
  expect(vetoDeadline({ status: "paused", current: { deadline_at: iso(AT) } }, offset)).toBeNull();
});

test("die letzten zehn Sekunden sind betont, angesagt wird nur bei 30, 10 und 5 Sekunden und beim Ablauf", () => {
  expect(isUrgent(11)).toBe(false);
  expect(isUrgent(10)).toBe(true);
  expect(isUrgent(null)).toBe(false);
  expect(ANNOUNCE_AT).toEqual([30, 10, 5]);
  const said = new Set<string>();
  for (let seconds = 60; seconds >= 0; seconds -= 1) said.add(countdownAnnouncement(seconds));
  expect([...said]).toEqual(["", "Noch 30 Sekunden.", "Noch 10 Sekunden.", "Noch 5 Sekunden.", "Zeit abgelaufen – das System wählt."]);
  expect(countdownAnnouncement(29)).toBe("Noch 30 Sekunden.");
  expect(countdownAnnouncement(11)).toBe("Noch 30 Sekunden.");
  expect(countdownAnnouncement(null)).toBe("");
  expect(secondsLeft(AT + 1, AT)).toBe(1);
  expect(secondsLeft(AT - 5000, AT)).toBe(0);
});

const PLAN: VetoPlanRow[] = [
  { index: 0, number: 1, kind: "ban", mode: "hp", mode_label: "Stellung", side: "A", name: "Löwen", position: null, state: "done", map_id: "glut", map_name: "Glut", via: "auto" },
  { index: 1, number: 2, kind: "pick", mode: "hp", mode_label: "Stellung", side: "B", name: "Falken", position: 1, state: "current", map_id: null, map_name: null, via: null },
  { index: 2, number: 3, kind: "decider", mode: "ctl", mode_label: "Kontrolle", side: null, name: null, position: 3, state: "open", map_id: null, map_name: null, via: null },
  { index: 3, number: 4, kind: "preset", mode: "ctl", mode_label: "Kontrolle", side: null, name: null, position: 2, state: "open", map_id: null, map_name: null, via: null },
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

const REMAINING = (statuses: Record<string, string | number | null> = {}): VetoGroup[] => [
  { mode: "hp", label: "Stellung", maps: [
    { map_id: "glut", name: "Glut", status: String(statuses.glut || "open"), side: (statuses.glutSide as "A" | "B") || null, by_name: (statuses.glutBy as string) || null, position: null },
    { map_id: "hafen", name: "Hafen", status: String(statuses.hafen || "open"), side: (statuses.hafenSide as "A" | "B") || null, by_name: null, position: (statuses.hafenAt as number) || null },
  ] },
  { mode: "ctl", label: "Kontrolle", maps: [{ map_id: "kai", name: "Kai", status: "preset", side: null, by_name: null, position: 3 }] },
];

test("Brett: nur die Karten des laufenden Modus sind die Auswahl, wählbar nur die freigegebenen", () => {
  const block: VetoBlock = {
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
  expect(boardGroups({ ...block, can_pick: false })[0].cards.some((card) => card.pickable)).toBe(false);
});

test("Aufleuchten: jede Wahl und jede Aktion der Gegenseite - nicht die eigene Sperre, nicht der erste Stand", () => {
  const before = REMAINING();
  expect(freshCards(null, before, "A").size).toBe(0);
  expect(freshCards(before, before, "A").size).toBe(0);
  expect([...freshCards(before, REMAINING({ glut: "banned", glutSide: "B" }), "A")]).toEqual(["hp:glut"]);
  expect(freshCards(before, REMAINING({ glut: "banned", glutSide: "A" }), "A").size).toBe(0);
  expect([...freshCards(before, REMAINING({ hafen: "picked", hafenSide: "A", hafenAt: 1 }), "A")]).toEqual(["hp:hafen"]);
  expect([...freshCards(before, REMAINING({ glut: "banned", glutSide: "A" }), null)]).toEqual(["hp:glut"]);
});
