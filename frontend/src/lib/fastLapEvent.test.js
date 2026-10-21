import { describe, expect, it } from "vitest";
import {
  INVALID_REASONS,
  attemptLabel,
  attemptsCell,
  attemptsField,
  attemptsPayload,
  attemptsUsedBy,
  canDriveAgain,
  keypadInput,
  participantKey,
  timePreview,
} from "./fastLapEvent";

describe("Versuche (#1585)", () => {
  it("nennt den Versuch, der gerade gefahren wird - mit der eingestellten Zahl", () => {
    expect(attemptLabel(0, 3)).toBe("Versuch 1 von 3");
    expect(attemptLabel(1, 3)).toBe("Versuch 2 von 3");
    expect(attemptLabel(6, 10)).toBe("Versuch 7 von 10");
  });

  it("sagt, wenn alle Versuche gefahren sind", () => {
    expect(attemptLabel(3, 3)).toBe("Alle 3 Versuche gefahren");
    expect(attemptLabel(4, 3)).toBe("Alle 3 Versuche gefahren");
    expect(attemptLabel(1, 1)).toBe("Versuch gefahren");
  });

  it("zählt ohne Grenze nur hoch", () => {
    expect(attemptLabel(6, null)).toBe("Versuch 7");
    expect(attemptLabel(0, undefined)).toBe("Versuch 1");
  });

  it("zeigt in der Tabelle „2 / 3“ oder nur die Zahl", () => {
    expect(attemptsCell(2, 3)).toBe("2 / 3");
    expect(attemptsCell(2, null)).toBe("2");
    expect(attemptsCell(undefined, 3)).toBe("0 / 3");
  });

  it("weiß, ob jemand noch fahren darf", () => {
    expect(canDriveAgain(2, 3)).toBe(true);
    expect(canDriveAgain(3, 3)).toBe(false);
    expect(canDriveAgain(99, null)).toBe(true);
  });

  it("zählt die Versuche einer Person aus der Zeitenliste - je Gast, nie alle Gäste zusammen", () => {
    const times = [
      { user_id: "u1", score_scope: "official" },
      { user_id: "u1", score_scope: "club_reference" },
      { user_id: null, guest_id: "g1" },
      { user_id: null, guest_id: "g1", is_invalid: true },
      { user_id: null, guest_id: "g2" },
    ];
    expect(attemptsUsedBy(times, { kind: "guest", id: "g1" })).toBe(2);
    expect(attemptsUsedBy(times, { kind: "guest", id: "g2" })).toBe(1);
    expect(attemptsUsedBy(times, { kind: "user", id: "u1" })).toBe(1);
    expect(attemptsUsedBy(times, { kind: "user", id: "u1" }, "club_reference")).toBe(1);
    expect(attemptsUsedBy(times, null)).toBe(0);
  });
});

describe("Schlüssel einer Zeile", () => {
  it("nimmt participant_id, sonst die Kennung des Kontos", () => {
    expect(participantKey({ participant_id: "guest-g1", user_id: null })).toBe("guest-g1");
    expect(participantKey({ user_id: "u1" })).toBe("u1");
    expect(participantKey(null)).toBe("");
  });
});

describe("Ziffernblock", () => {
  const type = (keys) => keys.reduce((text, key) => keypadInput(text, key), "");

  it("baut eine Zeit aus Ziffern, Doppelpunkt und Komma", () => {
    expect(type(["1", ":", "2", "4", ",", "5", "8", "7"])).toBe("1:24,587");
    expect(type(["8", "4", ",", "5"])).toBe("84,5");
  });

  it("nimmt jedes Trennzeichen nur einmal und nie am Anfang", () => {
    expect(type([":", "1"])).toBe("1");
    expect(type([",", "1"])).toBe("1");
    expect(type(["1", ":", ":", "2"])).toBe("1:2");
    expect(type(["1", ",", "2", ",", "3"])).toBe("1,23");
    expect(type(["1", ",", "2", ":", "3"])).toBe("1,23");
  });

  it("hört nach drei Nachkommastellen auf", () => {
    expect(type(["1", ",", "2", "3", "4", "5"])).toBe("1,234");
  });

  it("löscht rückwärts und ganz", () => {
    expect(keypadInput("1:24", "back")).toBe("1:2");
    expect(keypadInput("", "back")).toBe("");
    expect(keypadInput("1:24", "clear")).toBe("");
  });

  it("nimmt einen Punkt wie ein Komma", () => {
    expect(keypadInput("84", ".")).toBe("84,");
  });

  it("lässt Fremdes weg", () => {
    expect(keypadInput("84", "x")).toBe("84");
  });
});

describe("Vorschau der Zeit", () => {
  it("zeigt die gelesene Zeit, „nicht lesbar“ oder nichts", () => {
    expect(timePreview("84,587")).toEqual({ ms: 84587, text: "1:24,587", ok: true });
    expect(timePreview("1:75")).toEqual({ ms: null, text: "nicht lesbar", ok: false });
    expect(timePreview("")).toEqual({ ms: null, text: "", ok: false });
  });
});

describe("Gründe für ungültig", () => {
  it("hat Gründe mit mindestens 5 Zeichen - so viel verlangt der Server", () => {
    expect(INVALID_REASONS.length).toBeGreaterThanOrEqual(3);
    for (const reason of INVALID_REASONS) expect(reason.length).toBeGreaterThanOrEqual(5);
  });
});

describe("Feld „Versuche je Person“ (#1585)", () => {
  it("zeigt die eingestellte Zahl, leer heißt unbegrenzt", () => {
    expect(attemptsField({ unlimited_attempts: false, max_attempts: 3 })).toBe("3");
    expect(attemptsField({ unlimited_attempts: true, max_attempts: 3 })).toBe("");
    expect(attemptsField({ unlimited_attempts: false, max_attempts: 0 })).toBe("");
    expect(attemptsField(undefined)).toBe("3");
  });

  it("macht daraus, was der Server versteht - oder einen Fehler", () => {
    expect(attemptsPayload("10")).toEqual({ unlimited_attempts: false, max_attempts: 10 });
    expect(attemptsPayload(" ")).toEqual({ unlimited_attempts: true, max_attempts: null });
    expect(attemptsPayload("0").error).toMatch(/1 und 100/);
    expect(attemptsPayload("101").error).toMatch(/1 und 100/);
    expect(attemptsPayload("2,5").error).toMatch(/1 und 100/);
  });
});
