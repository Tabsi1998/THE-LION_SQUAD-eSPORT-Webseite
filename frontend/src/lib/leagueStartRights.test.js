// Startrechte für die nächste Season (#1627, docs/LIGA.md „F.2a“): Wörter und Sätze für Verwaltung und Team-Seite.
import { describe, expect, it } from "vitest";
import {
  countsLine, declineText, openRightsQuestion, outlookLine, placeLine, rightLine, settingsForm, settingsPayload, stateLabel, teamBadge, teamBadgeTone,
} from "./leagueStartRights";

const UNTIL = "2026-12-15T17:00:00+00:00";

describe("Zustände bleiben getrennt", () => {
  it("nennt jeden Zustand beim Namen - Zusage ist nicht Teilnahme", () => {
    expect(stateLabel("offered")).toBe("Zusage offen");
    expect(stateLabel("accepted")).toBe("Zugesagt");
    expect(stateLabel("participating")).toBe("Spielt mit");
    expect(stateLabel("confirmed")).toBe("Automatisch dabei");
    expect(stateLabel("expired")).toBe("Verfallen");
    expect(stateLabel("declined")).toBe("Abgemeldet");
    expect(stateLabel("revoked")).toBe("Zurückgenommen");
    expect(stateLabel("rejected")).toBe("Abgelehnt");
    expect(stateLabel("waitlist")).toBe("Warteliste");
    expect(stateLabel("etwas anderes")).toBe("");
  });

  it("zählt für die Übersicht nur, was es gibt, in fester Reihenfolge", () => {
    expect(countsLine({ accepted: 3, offered: 4, expired: 1 })).toBe("4 Zusage offen · 3 zugesagt · 1 verfallen");
    expect(countsLine({ participating: 2, confirmed: 1 })).toBe("1 automatisch dabei · 2 spielen mit");
    expect(countsLine({ rejected: 1, waitlist: 2 })).toBe("1 abgelehnt · 2 auf der Warteliste");
    expect(countsLine({})).toBe("");
  });
});

describe("Das eigene Team", () => {
  const carry = { division_label: "Liga 1", from_label: "Liga 2", movement: "up" };

  it("sagt bei offener Zusage, bis wann und was sonst geschieht", () => {
    const line = rightLine({ ...carry, start_right: { state: "offered", accept_until: UNTIL } });
    expect(line).toBe("Startrecht für Liga 1: bitte bis 15.12.2026, 18:00 Uhr zusagen. Ohne Zusage verfällt es.");
  });

  it("sagt dem Nachrücker, dass er ablehnen kann und wohin er zurückfällt - ohne den Namen des anderen Teams", () => {
    const line = rightLine({ ...carry, start_right: { state: "offered", accept_until: UNTIL, fills: { from_label: "Liga 2" } } });
    expect(line).toBe("Nachgerückt: In Liga 1 ist ein Platz frei geworden. Bitte bis 15.12.2026, 18:00 Uhr zusagen oder ablehnen – ohne Antwort bleibt ihr in Liga 2.");
    expect(rightLine({ ...carry, start_right: { state: "confirmed", fills: { from_label: "Liga 2" } } }))
      .toBe("Nachgerückt in Liga 1. Wer lieber in Liga 2 bleibt, lehnt bis zum Start ab.");
  });

  it("sagt dem Nachrücker mit offener eigener Zusage, was Ablehnen und Schweigen bedeuten", () => {
    // Entscheidung 26.11.: Die eigene Frist ruht, Ablehnen gilt als Zusage für die eigene Liga, Schweigen lässt die Restfrist.
    const line = rightLine({ ...carry, start_right: { state: "offered", accept_until: UNTIL, fills: { from_label: "Liga 2", own_open: true, rest_days: 3 } } });
    expect(line).toBe("Nachgerückt: In Liga 1 ist ein Platz frei geworden. Bitte bis 15.12.2026, 18:00 Uhr zusagen oder ablehnen. Eure Frist für Liga 2 ruht so lange. Ablehnen gilt als Zusage für Liga 2. Ohne Antwort bleibt ihr in Liga 2 und habt dort noch die restliche Frist, mindestens 3 Tage.");
    expect(rightLine({ ...carry, start_right: { state: "offered", accept_until: UNTIL, fills: { from_label: "Liga 2", own_open: true, rest_days: 1 } } }))
      .toContain("mindestens 1 Tag.");
    // Hat das Team für die eigene Liga schon zugesagt, bleibt der kurze Satz.
    expect(rightLine({ ...carry, start_right: { state: "offered", accept_until: UNTIL, fills: { from_label: "Liga 2", own_open: false, rest_days: 3 } } }))
      .toBe("Nachgerückt: In Liga 1 ist ein Platz frei geworden. Bitte bis 15.12.2026, 18:00 Uhr zusagen oder ablehnen – ohne Antwort bleibt ihr in Liga 2.");
    expect(declineText({ ...carry, start_right: { state: "offered", fills: { from_label: "Liga 2", own_open: true } } }))
      .toBe("Ihr bleibt in Liga 2 – das gilt zugleich als eure Zusage für Liga 2. Der Platz in Liga 1 geht an das nächste Team, zurück geht das nicht.");
    expect(declineText({ ...carry, start_right: { state: "offered", fills: { from_label: "Liga 2", own_open: false } } }))
      .toBe("Ihr bleibt in Liga 2. Der Platz in Liga 1 geht an das nächste Team, zurück geht das nicht.");
  });

  it("trennt Zusage, Verfall und Teilnahme", () => {
    expect(rightLine({ ...carry, start_right: { state: "accepted" } })).toBe("Zugesagt für Liga 1. Die Staffel teilt die Liga-Leitung noch zu.");
    expect(rightLine({ ...carry, start_right: { state: "expired" } })).toBe("Das Startrecht ist verfallen: Die Frist für die Zusage ist vorbei.");
    expect(rightLine({ ...carry, start_right: { state: "participating" } })).toBe("");
    expect(rightLine(carry)).toBe("");
  });

  it("sagt, wenn die Frist ruht oder nach dem Startdatum die Leitung entscheidet", () => {
    // Pause (Vorgänger wieder geöffnet): Die Frist steht still - zusagen geht trotzdem.
    expect(rightLine({ ...carry, start_right: { state: "offered", accept_until: null, paused: true } }))
      .toBe("Startrecht für Liga 1: Die Frist ruht, solange der Endstand der Vorgänger-Season geprüft wird – danach läuft sie um diese Zeit länger. Zusagen geht trotzdem.");
    expect(rightLine({ ...carry, start_right: { state: "offered", accept_until: null, paused: true, fills: { from_label: "Liga 2" } } }))
      .toBe("Nachgerückt: In Liga 1 ist ein Platz frei geworden. Die Frist ruht, solange der Endstand der Vorgänger-Season geprüft wird. Zusagen oder ablehnen geht trotzdem – ohne Antwort bleibt ihr in Liga 2.");
    // Startdatum erreicht, Frist vorbei: nichts verfällt mehr von selbst.
    expect(rightLine({ ...carry, start_right: { state: "offered", accept_until: UNTIL, waits_for_lead: true } }))
      .toBe("Die Frist für die Zusage zu Liga 1 ist vorbei. Jetzt entscheidet die Liga-Leitung – meldet euch dort.");
    expect(teamBadge({ status: "accepted", carry_over: { start_right: { state: "offered", waits_for_lead: true } } })).toBe("Startrecht – Leitung entscheidet");
  });

  it("zeigt am Abzeichen den Stand des Startrechts statt „Angemeldet“", () => {
    expect(teamBadge({ status: "accepted", carry_over: { start_right: { state: "offered" } } })).toBe("Startrecht – Zusage offen");
    expect(teamBadge({ status: "accepted", carry_over: { start_right: { state: "accepted" } } })).toBe("Zugesagt – Zuteilung folgt");
    expect(teamBadge({ status: "rejected", carry_over: { start_right: { state: "expired" } } })).toBe("Startrecht verfallen");
    // Ohne Startrecht (Season ohne die Einstellung) bleibt alles, wie es war.
    expect(teamBadge({ status: "accepted", carry_over: {} })).toBe("");
    expect(teamBadge({ status: "accepted", staffel: "Staffel A", carry_over: { start_right: { state: "participating" } } })).toBe("");
    // Offen ist noch nicht „grün“: eigene Farbe, sonst die des Antrags.
    expect(teamBadgeTone({ carry_over: { start_right: { state: "offered" } } })).toBe("warn");
    expect(teamBadgeTone({ carry_over: { start_right: { state: "expired" } } })).toBe("quiet");
    expect(teamBadgeTone({ carry_over: { start_right: { state: "accepted" } } })).toBeUndefined();
    expect(teamBadgeTone({ carry_over: {} })).toBeUndefined();
  });

  it("nennt eine Prognose Prognose und ein bestätigtes Startrecht bestätigt", () => {
    expect(outlookLine({ state: "forecast", movement: "up", rank: 1, zone_label: "Aufstieg" }))
      .toBe("Prognose nach der laufenden Tabelle: Aufstieg (Platz 1). Fest ist das erst, wenn die Season abgeschlossen ist.");
    expect(outlookLine({ state: "forecast", movement: "stay", rank: 3 }))
      .toBe("Prognose nach der laufenden Tabelle: bleibt in der Liga (Platz 3). Fest ist das erst, wenn die Season abgeschlossen ist.");
    expect(outlookLine({ state: "confirmed", movement: "up", division_label: "Liga 1", rank: 1 }))
      .toBe("Bestätigt: Startrecht für Liga 1 in der nächsten Season (Aufstieg). Zusagen geht, sobald die neue Season angelegt ist.");
    expect(outlookLine({ state: "confirmed", movement: "stay", division_label: "Liga 2" }))
      .toBe("Bestätigt: Startrecht für Liga 2 in der nächsten Season. Zusagen geht, sobald die neue Season angelegt ist.");
  });
});

describe("Verwaltung", () => {
  it("sagt bei einem freien Platz, warum er frei ist und wer nach der Regel dran ist", () => {
    const place = { display_name: "Team Alpha", division_label: "Liga 1", why: "expired", group: "non_promoted", pick: "a2", tied: [],
      candidates: [{ application_id: "a2", display_name: "Team Beta" }] };
    expect(placeLine(place)).toBe("Liga 1: Platz von Team Alpha frei (Frist verfallen). Nach der Regel rückt Team Beta nach – der beste Nicht-Aufsteiger.");
    expect(placeLine({ ...place, why: "declined", group: "relegated" }))
      .toBe("Liga 1: Platz von Team Alpha frei (abgemeldet). Nach der Regel rückt Team Beta nach – der beste Absteiger bleibt.");
    expect(placeLine({ ...place, pick: null, tied: ["a2", "a3"], candidates: [...place.candidates, { application_id: "a3", display_name: "Team Gamma" }] }))
      .toBe("Liga 1: Platz von Team Alpha frei (Frist verfallen). Gleichstand zwischen Team Beta und Team Gamma – ein Los gibt es nicht, bitte wählen.");
    expect(placeLine({ ...place, pick: null, candidates: [], group: null }))
      .toBe("Liga 1: Platz von Team Alpha frei (Frist verfallen). Es gibt keinen Nachrücker – der Platz ist frei für Warteliste und Anmeldungen.");
    // In der Pause und ab dem Startdatum rückt niemand nach - dann verspricht die Zeile auch keinen Vorschlag.
    expect(placeLine(place, { paused: true }))
      .toBe("Liga 1: Platz von Team Alpha frei (Frist verfallen). Solange der Endstand der Vorgänger-Season geprüft wird, rückt niemand nach.");
    expect(placeLine(place, { started: true }))
      .toBe("Liga 1: Platz von Team Alpha frei (Frist verfallen). Das Startdatum ist erreicht: Nachrücken geht nur noch von Hand im Eingang.");
  });

  it("fragt nach, bevor offene Startrechte durch Ausschalten oder Umschalten als zugesagt gelten", () => {
    const accept = { active: true, mode: "accept" };
    expect(openRightsQuestion({ active: false }, 3)).toBe("3 offene Startrechte gelten dann als zugesagt und brauchen keine Zusage mehr.");
    expect(openRightsQuestion({ active: true, mode: "auto" }, 1)).toBe("1 offenes Startrecht gilt dann als zugesagt und braucht keine Zusage mehr.");
    // Bleibt es bei „mit Zusage“ oder ist nichts offen, gibt es nichts zu fragen.
    expect(openRightsQuestion(accept, 3)).toBe("");
    expect(openRightsQuestion({ active: false }, 0)).toBe("");
    expect(settingsPayload({ active: true, mode: "auto", accept_days: 14, successor: "next", remind_hours: 48, announce: true }, true))
      .toEqual({ active: true, mode: "auto", accept_days: 14, successor: "next", remind_hours: 48, announce: true, confirm_open: true });
    expect(settingsPayload({ active: false }, true)).toEqual({ active: false, confirm_open: true });
    // Die Restfrist nach einem verstrichenen Nachrück-Angebot geht mit, wenn die Verwaltung sie kennt.
    expect(settingsPayload({ active: true, mode: "accept", accept_days: 14, successor: "next", remind_hours: 48, announce: true, rest_days: "5" }))
      .toEqual({ active: true, mode: "accept", accept_days: 14, successor: "next", remind_hours: 48, announce: true, rest_days: 5 });
  });

  it("baut das Formular aus Einstellung und Vorgabe und schickt ganze Zahlen", () => {
    const defaults = { mode: "accept", accept_days: 14, successor: "next", remind_hours: 48, announce: true };
    expect(settingsForm(null, defaults)).toEqual({ active: false, ...defaults });
    expect(settingsForm({ ...defaults, accept_days: 7 }, defaults)).toEqual({ active: true, ...defaults, accept_days: 7 });
    expect(settingsPayload({ active: true, mode: "accept", accept_days: "10", successor: "lead", remind_hours: "", announce: false }))
      .toEqual({ active: true, mode: "accept", accept_days: 10, successor: "lead", remind_hours: null, announce: false });
    // Ausgeschaltet: nur das - es bleibt bei „automatisch dabei, wer nicht will, meldet sich ab“.
    expect(settingsPayload({ active: false, mode: "accept", accept_days: 10 })).toEqual({ active: false });
  });
});
