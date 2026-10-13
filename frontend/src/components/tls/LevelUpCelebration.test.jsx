import { isLevelGain, levelUpFrom, readSeen, storeKey } from "./LevelUpCelebration";

// Level-Erkennung (#617): gefeiert wird ein höheres Level oder ein neuer Prestige-Stern - die Rücknahme eines
// Prestiges (ein Stern weniger, wieder Level 60) ist kein Aufstieg.

describe("isLevelGain", () => {
  it("feiert ein höheres Level und einen neuen Stern, nicht die Rücknahme", () => {
    expect(isLevelGain({ level: 11, prestige: 0 }, { level: 12, prestige: 0 })).toBe(true);
    expect(isLevelGain({ level: 12, prestige: 0 }, { level: 12, prestige: 0 })).toBe(false);
    expect(isLevelGain({ level: 60, prestige: 0 }, { level: 1, prestige: 1 })).toBe(true);
    expect(isLevelGain({ level: 1, prestige: 1 }, { level: 60, prestige: 0 })).toBe(false);
    expect(isLevelGain({ level: 3, prestige: 2 }, { level: 40, prestige: 1 })).toBe(false);
    expect(isLevelGain({ level: 5 }, { level: 6 })).toBe(true);
  });
});

// Einmal je Aufstieg (#1456): der Aufstiegs-Moment des Löwen-Rangs hängt am selben Paket. Der gesehene Stand wird je
// Konto gemerkt - derselbe Aufstieg kommt beim nächsten Blick nicht noch einmal.
describe("levelUpFrom und readSeen", () => {
  beforeEach(() => localStorage.clear());

  it("feiert einen Aufstieg genau einmal", () => {
    const key = storeKey("u1");
    localStorage.setItem(key, JSON.stringify({ level: 24, title: "Silbermähne", prestige: 0 }));
    const next = { level: 25, title: "Goldmähne", prestige: 0 };
    expect(levelUpFrom(readSeen(key), next)).toEqual({ level: 25, previous: 24, title: "Goldmähne", titleChanged: true, prestige: 0, prestigeGained: false });
    // Die Seite merkt sich den neuen Stand gleich danach - der nächste Blick findet nichts mehr.
    localStorage.setItem(key, JSON.stringify(next));
    expect(levelUpFrom(readSeen(key), next)).toBeNull();
  });

  it("erster Besuch ohne gemerkten Stand: nichts feiern; alte Fassung (nur die Zahl) wird verstanden", () => {
    expect(levelUpFrom(readSeen(storeKey("neu")), { level: 7 })).toBeNull();
    localStorage.setItem(storeKey("alt"), "11");
    expect(levelUpFrom(readSeen(storeKey("alt")), { level: 12, title: "Rudel" })).toMatchObject({ level: 12, previous: 11 });
    localStorage.setItem(storeKey("kaputt"), "{");
    expect(readSeen(storeKey("kaputt"))).toBeNull();
  });
});
