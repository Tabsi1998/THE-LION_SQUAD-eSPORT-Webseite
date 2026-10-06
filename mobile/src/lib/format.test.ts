import {
  continuesMessageGroup,
  formatChatTime,
  formatEventType,
  formatMembershipStatus,
  formatMembershipType,
  formatNewsCategory,
  formatRole,
  formatTournamentFormat,
  normalizeEventType,
  placeParts,
} from "./format";

// Texte, die vorher roh aus der Datenbank kamen: "clubevening · Telfs · Telfs",
// News mit Kategorie "events", Chat-Nachrichten nur mit Datum (#211).

// Rohwerte II aus Build 59: "ffacustombracket", "community_user", "active (ordinary)" (#246).
describe("Turnierformat, Rolle, Mitgliedschaft", () => {
  test("Turnierformate heißen wie auf der Webseite, auch in alter Schreibweise", () => {
    expect(formatTournamentFormat("ffa_custom_bracket")).toBe("Mehrspieler freier Turnierbaum");
    expect(formatTournamentFormat("ffacustombracket")).toBe("Mehrspieler freier Turnierbaum");
    expect(formatTournamentFormat("singleelim")).toBe("Single Elimination");
    expect(formatTournamentFormat("Single-Elimination")).toBe("Single Elimination");
    expect(formatTournamentFormat("round_robin")).toBe("Jeder gegen jeden");
    expect(formatTournamentFormat("")).toBe("");
    expect(formatTournamentFormat("irgend_was")).toBe("Irgend was");
  });

  test("Nutzerarten und Rollen als Begriff", () => {
    expect(formatRole("community_user")).toBe("Community");
    expect(formatRole("club_member")).toBe("Vereinsmitglied");
    expect(formatRole("superadmin")).toBe("Superadmin");
    expect(formatRole("player")).toBe("Spieler");
    expect(formatRole(null)).toBe("");
  });

  test("Mitgliedschaft als Begriff statt active (ordinary)", () => {
    expect(formatMembershipStatus("active")).toBe("Aktiv");
    expect(formatMembershipStatus("pending")).toBe("Beantragt");
    expect(formatMembershipType("ordinary")).toBe("Ordentliches Mitglied");
    expect(formatMembershipType("supporting")).toBe("Förderndes Mitglied");
    expect(formatMembershipType("")).toBe("");
  });
});

describe("Event-Typen", () => {
  test("bekannte Schlüssel bekommen den Begriff der Webseite", () => {
    expect(formatEventType("club_evening")).toBe("Vereinsabend");
    expect(formatEventType("lan_party")).toBe("LAN-Party");
    expect(formatEventType("expo")).toBe("Messe / Expo");
  });

  test("ältere Schreibweisen ohne Unterstrich landen beim richtigen Begriff", () => {
    expect(normalizeEventType("clubevening")).toBe("club_evening");
    expect(formatEventType("clubevening")).toBe("Vereinsabend");
    expect(formatEventType("LanParty")).toBe("LAN-Party");
  });

  test("der Standardtyp sagt nichts, Unbekanntes wird lesbar", () => {
    expect(formatEventType("general")).toBe("");
    expect(formatEventType("")).toBe("");
    expect(formatEventType("board_game_night")).toBe("Board game night");
  });
});

describe("News-Kategorien", () => {
  test("Kategorien auf Deutsch, Unbekanntes lesbar", () => {
    expect(formatNewsCategory("events")).toBe("Events");
    expect(formatNewsCategory("announcement")).toBe("Ankündigung");
    expect(formatNewsCategory("recap")).toBe("Rückblick");
    expect(formatNewsCategory("press_release")).toBe("Press release");
    expect(formatNewsCategory(null)).toBe("");
  });
});

describe("Ortsangaben", () => {
  test("Ort und Stadt nur einmal, wenn sie gleich sind", () => {
    expect(placeParts("Telfs", "Telfs")).toEqual(["Telfs"]);
    expect(placeParts("Vereinsheim", "Telfs")).toEqual(["Vereinsheim", "Telfs"]);
    expect(placeParts(" innsbruck ", "Innsbruck", "Österreich")).toEqual(["innsbruck", "Österreich"]);
    expect(placeParts(null, "", undefined)).toEqual([]);
  });
});

describe("Zeit im Chat", () => {
  const now = new Date("2026-09-15T18:30:00+02:00"); // 15.09.2026, 18:30 in Wien

  test("heute nur die Uhrzeit, gestern mit Hinweis, sonst Datum und Uhrzeit", () => {
    expect(formatChatTime("2026-09-15T14:05:00+02:00", now)).toBe("14:05");
    expect(formatChatTime("2026-09-14T23:59:00+02:00", now)).toBe("Gestern, 23:59");
    expect(formatChatTime("2026-05-20T09:00:00+02:00", now)).toBe("20.05.2026, 09:00");
  });

  test("die Tage zählen in Wien: zehn nach Mitternacht ist schon heute", () => {
    expect(formatChatTime("2026-09-15T00:10:00+02:00", now)).toBe("00:10"); // in UTC noch der 14.
    expect(formatChatTime("2026-09-14T00:10:00+02:00", now)).toBe("Gestern, 00:10");
    expect(formatChatTime("2026-09-13T23:50:00+02:00", now)).toBe("13.09.2026, 23:50");
    expect(formatChatTime("2026-09-16T00:10:00+02:00", now)).toBe("16.09.2026, 00:10");
  });

  test("ohne oder mit kaputtem Wert kommt nichts Erfundenes", () => {
    expect(formatChatTime(null, now)).toBe("");
    expect(formatChatTime("kein datum", now)).toBe("kein datum");
  });
});

describe("Nachrichten gruppieren", () => {
  const at = (minute: number) => new Date(2026, 8, 15, 10, minute).toISOString();

  test("kurz aufeinanderfolgende Nachrichten desselben Absenders teilen sich den Kopf", () => {
    expect(continuesMessageGroup({ user_id: "u-1", created_at: at(0) }, { user_id: "u-1", created_at: at(4) })).toBe(true);
    expect(continuesMessageGroup({ sender_id: "u-1", created_at: at(0) }, { sender_id: "u-1", created_at: at(5) })).toBe(true);
  });

  test("anderer Absender, zu große Pause oder fehlende Zeit: eigener Kopf", () => {
    expect(continuesMessageGroup({ user_id: "u-1", created_at: at(0) }, { user_id: "u-2", created_at: at(1) })).toBe(false);
    expect(continuesMessageGroup({ user_id: "u-1", created_at: at(0) }, { user_id: "u-1", created_at: at(6) })).toBe(false);
    expect(continuesMessageGroup({ user_id: "u-1" }, { user_id: "u-1", created_at: at(1) })).toBe(false);
    expect(continuesMessageGroup(null, { user_id: "u-1", created_at: at(1) })).toBe(false);
  });
});
