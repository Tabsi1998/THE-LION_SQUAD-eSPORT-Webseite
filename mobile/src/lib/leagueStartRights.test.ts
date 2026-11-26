import { declineText, outlookBadge, outlookLine, rightLine, startRightToast, teamBadge, teamBadgeTone, type StartRightCarry } from "./leagueStartRights";

// Startrechte für die nächste Season (#1627, docs/LIGA.md F.2a): dieselben Sätze wie im Web (frontend/src/lib/leagueStartRights.js).
// Gerechnet wird auf dem Server - die App sagt nur, wie es heißt.

const UNTIL = "2026-12-15T17:00:00Z"; // 18:00 Uhr in Wien

const carry = (start_right: StartRightCarry["start_right"], extra: Partial<StartRightCarry> = {}): StartRightCarry => ({
  division_label: "Liga 1", from_label: "Liga 2", movement: "up", ...extra, start_right,
});

describe("rightLine: der Satz unter dem Antrag", () => {
  test("Zusage offen: mit Frist", () => {
    expect(rightLine(carry({ state: "offered", accept_until: UNTIL, can_accept: true }))).toBe(
      "Startrecht für Liga 1: bitte bis 15.12.2026, 18:00 Uhr zusagen. Ohne Zusage verfällt es.",
    );
  });

  test("Startdatum erreicht und Frist vorbei: Die Leitung entscheidet", () => {
    expect(rightLine(carry({ state: "offered", accept_until: UNTIL, waits_for_lead: true }))).toBe(
      "Die Frist für die Zusage zu Liga 1 ist vorbei. Jetzt entscheidet die Liga-Leitung – meldet euch dort.",
    );
  });

  test("Pause: Die Frist ruht, zusagen geht trotzdem", () => {
    expect(rightLine(carry({ state: "offered", accept_until: null, paused: true }))).toBe(
      "Startrecht für Liga 1: Die Frist ruht, solange der Endstand der Vorgänger-Season geprüft wird – danach läuft sie um diese Zeit länger. Zusagen geht trotzdem.",
    );
  });

  test("Pause als Nachrücker: zurück in die eigene Liga ohne Antwort", () => {
    expect(rightLine(carry({ state: "offered", paused: true, fills: { from_label: "Liga 2" } }))).toBe(
      "Nachgerückt: In Liga 1 ist ein Platz frei geworden. Die Frist ruht, solange der Endstand der Vorgänger-Season geprüft wird. Zusagen oder ablehnen geht trotzdem – ohne Antwort bleibt ihr in Liga 2.",
    );
  });

  test("Nachgerückt mit offener eigener Zusage: Restfrist mit Tagen", () => {
    expect(rightLine(carry({ state: "offered", accept_until: UNTIL, fills: { from_label: "Liga 2", own_open: true, rest_days: 3 } }))).toBe(
      "Nachgerückt: In Liga 1 ist ein Platz frei geworden. Bitte bis 15.12.2026, 18:00 Uhr zusagen oder ablehnen. Eure Frist für Liga 2 ruht so lange. Ablehnen gilt als Zusage für Liga 2. Ohne Antwort bleibt ihr in Liga 2 und habt dort noch die restliche Frist, mindestens 3 Tage.",
    );
    expect(rightLine(carry({ state: "offered", accept_until: UNTIL, fills: { from_label: "Liga 2", own_open: true, rest_days: 1 } }))).toContain("mindestens 1 Tag.");
    expect(rightLine(carry({ state: "offered", accept_until: UNTIL, fills: { from_label: "Liga 2", own_open: true, rest_days: 0 } }))).toContain("die restliche Frist.");
  });

  test("Nachgerückt ohne offene eigene Zusage", () => {
    expect(rightLine(carry({ state: "offered", accept_until: UNTIL, fills: { from_label: "Liga 2" } }))).toBe(
      "Nachgerückt: In Liga 1 ist ein Platz frei geworden. Bitte bis 15.12.2026, 18:00 Uhr zusagen oder ablehnen – ohne Antwort bleibt ihr in Liga 2.",
    );
  });

  test("Automatisch dabei als Nachrücker: Ablehnen bis zum Start", () => {
    expect(rightLine(carry({ state: "confirmed", fills: { from_label: "Liga 2" } }))).toBe("Nachgerückt in Liga 1. Wer lieber in Liga 2 bleibt, lehnt bis zum Start ab.");
  });

  test("zugesagt und verfallen", () => {
    expect(rightLine(carry({ state: "accepted" }))).toBe("Zugesagt für Liga 1. Die Staffel teilt die Liga-Leitung noch zu.");
    expect(rightLine(carry({ state: "expired" }))).toBe("Das Startrecht ist verfallen: Die Frist für die Zusage ist vorbei.");
  });

  test("ohne Startrecht (Season ohne die Einstellung) und bei automatisch dabei kein Satz", () => {
    expect(rightLine(null)).toBe("");
    expect(rightLine({ division_label: "Liga 1" })).toBe("");
    expect(rightLine(carry({ state: "confirmed" }))).toBe("");
    expect(rightLine(carry({ state: "declined" }))).toBe("");
  });
});

describe("Abzeichen am Antrag", () => {
  test("offene Zusage ist nicht „Angemeldet“", () => {
    expect(teamBadge({ carry_over: carry({ state: "offered" }) })).toBe("Startrecht – Zusage offen");
    expect(teamBadgeTone({ carry_over: carry({ state: "offered" }) })).toBe("warn");
  });

  test("Leitung entscheidet, zugesagt, verfallen", () => {
    expect(teamBadge({ carry_over: carry({ state: "offered", waits_for_lead: true }) })).toBe("Startrecht – Leitung entscheidet");
    expect(teamBadge({ carry_over: carry({ state: "accepted" }) })).toBe("Zugesagt – Zuteilung folgt");
    expect(teamBadge({ carry_over: carry({ state: "expired" }) })).toBe("Startrecht verfallen");
    expect(teamBadgeTone({ carry_over: carry({ state: "expired" }) })).toBe("quiet");
  });

  test("ohne Startrecht: leer, dann gilt der Stand des Antrags", () => {
    expect(teamBadge({ carry_over: null })).toBe("");
    expect(teamBadge(null)).toBe("");
    expect(teamBadgeTone({ carry_over: carry({ state: "accepted" }) })).toBeNull();
  });
});

test("Rückfrage vor „Nachrücken ablehnen“: mit offener eigener Zusage gilt sie als Zusage", () => {
  expect(declineText(carry({ state: "offered", fills: { from_label: "Liga 2", own_open: true } }))).toBe(
    "Ihr bleibt in Liga 2 – das gilt zugleich als eure Zusage für Liga 2. Der Platz in Liga 1 geht an das nächste Team, zurück geht das nicht.",
  );
  expect(declineText(carry({ state: "offered", fills: {} }))).toBe("Ihr bleibt in eurer Liga. Der Platz in Liga 1 geht an das nächste Team, zurück geht das nicht.");
});

test("Meldung nach Zusage bzw. Ablehnung", () => {
  expect(startRightToast("accept", carry({ state: "offered" }))).toBe("Zugesagt für Liga 1. Die Staffel teilt die Liga-Leitung noch zu.");
  expect(startRightToast("decline", carry({ state: "offered", fills: { from_label: "Liga 2", own_open: true } }))).toBe("Abgelehnt. Ihr bleibt in Liga 2 – das gilt als eure Zusage dort.");
  expect(startRightToast("decline", carry({ state: "offered", fills: { from_label: "Liga 2" } }))).toBe("Abgelehnt. Ihr bleibt in Liga 2.");
});

describe("Ausblick vor der Folge-Season", () => {
  test("Prognose aus der laufenden Tabelle - ohne Liga N", () => {
    expect(outlookLine({ state: "forecast", movement: "up", rank: 2 })).toBe("Prognose nach der laufenden Tabelle: Aufstieg (Platz 2). Fest ist das erst, wenn die Season abgeschlossen ist.");
    expect(outlookLine({ state: "forecast", movement: "stay" })).toBe("Prognose nach der laufenden Tabelle: bleibt in der Liga. Fest ist das erst, wenn die Season abgeschlossen ist.");
    expect(outlookBadge({ state: "forecast" })).toEqual({ label: "Prognose", tone: "quiet" });
  });

  test("bestätigt aus dem Endstand", () => {
    expect(outlookLine({ state: "confirmed", movement: "down", division_label: "Liga 3" })).toBe(
      "Bestätigt: Startrecht für Liga 3 in der nächsten Season (Abstieg). Zusagen geht, sobald die neue Season angelegt ist.",
    );
    expect(outlookLine({ state: "confirmed", movement: "stay", division_label: "Liga 2" })).toBe(
      "Bestätigt: Startrecht für Liga 2 in der nächsten Season. Zusagen geht, sobald die neue Season angelegt ist.",
    );
    expect(outlookBadge({ state: "confirmed" })).toEqual({ label: "Startrecht bestätigt", tone: "ok" });
  });

  test("leer ohne Eintrag", () => {
    expect(outlookLine(null)).toBe("");
  });
});
