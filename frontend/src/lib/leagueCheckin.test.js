import { countdownLabel, countdownTarget, remainingText, ringShare, rulesSentences, selectionText, sideStatusText, stateText } from "./leagueCheckin";

// Liga-Check-in (#1652): Sätze, Countdown und Ring aus dem Block des Servers - Wiener Zeit, nie negativ.

const RULES = { opens_minutes_before: 15, closes_minutes_after: 15, min_present: 3, remind_minutes_before_close: 5 };
const WINDOW = { opens_at: "2026-11-14T18:45:00+00:00", closes_at: "2026-11-14T19:15:00+00:00" };
const OWN = { registration_id: "a", name: "Löwen · Rudel A", own: true, checked_in: false, present: [], present_count: 0 };
const OTHER = { registration_id: "b", name: "Falken · Horst", own: false, checked_in: false, present: [], present_count: 0 };

function block(state, extra = {}) {
  return { rules: RULES, state, window: WINDOW, scheduled_at: "2026-11-14T19:00:00+00:00", sides: [OWN, OTHER], min_present: 3, ...extra };
}

test("der Satz sagt je Stand, was jetzt gilt - mit Wiener Zeit", () => {
  expect(stateText(block("waiting"))).toBe("Der Check-in öffnet um Sa 14.11. 19:45 (15 Minuten vor dem Termin) und schließt um Sa 14.11. 20:15.");
  expect(stateText(block("open"))).toBe("Hakt an, wer da ist (mindestens 3), und tippt auf „Einchecken“ – bis Sa 14.11. 20:15.");
  expect(stateText(block("open", { sides: [{ ...OWN, checked_in: true }, OTHER] }))).toContain("jetzt fehlt noch Falken · Horst");
  expect(stateText(block("closed"))).toContain("gewertet wird nichts von selbst");
  expect(stateText(block("ready"))).toContain("Spiel starten");
  expect(stateText(block("running", { started_at: "2026-11-14T19:02:00+00:00" }))).toBe("Das Spiel läuft seit 20:02.");
  expect(stateText(block("no_time", { window: null }))).toContain("15 Minuten vor dem Termin");
});

test("der Countdown zählt bis zur Öffnung oder bis zum Schluss", () => {
  expect(countdownTarget(block("waiting"))).toBe(new Date(WINDOW.opens_at).getTime());
  expect(countdownTarget(block("open"))).toBe(new Date(WINDOW.closes_at).getTime());
  expect(countdownTarget(block("ready"))).toBeNull();
  expect(countdownLabel(block("waiting"))).toBe("öffnet in");
  expect(countdownLabel(block("open"))).toBe("noch");
  const closes = new Date(WINDOW.closes_at).getTime();
  expect(remainingText(closes, closes - 90 * 1000)).toBe("1:30");
  expect(remainingText(closes, closes - 3725 * 1000)).toBe("1:02:05");
  expect(remainingText(closes, closes + 5000)).toBe("0:00");
});

test("der Ring ist voll vor der Öffnung und halb in der Mitte des Fensters", () => {
  expect(ringShare(block("waiting"))).toBe(1);
  const opens = new Date(WINDOW.opens_at).getTime();
  expect(ringShare(block("open"), opens + 15 * 60 * 1000)).toBe(0.5);
  expect(ringShare(block("open"), opens + 40 * 60 * 1000)).toBe(0);
});

test("Zeilen je Seite und zur Auswahl", () => {
  expect(sideStatusText(OTHER)).toBe("noch nicht eingecheckt");
  expect(sideStatusText({ ...OWN, checked_in: true, at: "2026-11-14T18:52:00+00:00", present_count: 3 })).toBe("eingecheckt um 19:52 · 3 Spieler");
  expect(sideStatusText({ ...OWN, checked_in: true, via: "lead", updated_at: "2026-11-14T19:20:00+00:00", present_count: 1 })).toBe("eingetragen von der Liga-Leitung um 20:20 · 1 Spieler");
  expect(selectionText(1, 3)).toBe("1 angehakt – noch 2 Personen bis zur Mindestzahl 3.");
  expect(selectionText(2, 3)).toBe("2 angehakt – noch eine Person bis zur Mindestzahl 3.");
  expect(selectionText(3, 3)).toBe("3 angehakt – das reicht (mindestens 3).");
  expect(rulesSentences(RULES)[0]).toBe("Der Check-in öffnet 15 Minuten vor dem Termin und schließt 15 Minuten danach.");
  expect(rulesSentences(null)).toEqual([]);
});
