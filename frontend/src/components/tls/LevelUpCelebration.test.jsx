import { isLevelGain } from "./LevelUpCelebration";

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
