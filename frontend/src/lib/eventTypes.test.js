import { eventTypeLabel, normalizeEventType } from "./eventTypes";

describe("Event-Typen", () => {
  test("bekannte Schlüssel bekommen ihren Begriff, die Meta-Liste geht vor", () => {
    expect(eventTypeLabel("club_evening")).toBe("Vereinsabend");
    expect(eventTypeLabel("club_evening", [{ k: "club_evening", l: "Clubabend" }])).toBe("Clubabend");
  });

  test("ältere Schreibweisen ohne Unterstrich landen beim richtigen Begriff", () => {
    expect(normalizeEventType("clubevening")).toBe("club_evening");
    expect(eventTypeLabel("clubevening")).toBe("Vereinsabend");
    expect(eventTypeLabel("LanParty", [{ k: "lan_party", l: "LAN-Party" }])).toBe("LAN-Party");
  });

  test("Unbekanntes wird lesbar statt roh, Leeres bleibt leer", () => {
    expect(eventTypeLabel("board_game_night")).toBe("Board game night");
    expect(eventTypeLabel("")).toBe("");
    expect(eventTypeLabel(null)).toBe("");
  });
});
