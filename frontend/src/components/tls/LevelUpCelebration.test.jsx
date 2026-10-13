import { act, render } from "@testing-library/react";
import { LevelUpCelebration, claimLevelUp, isLevelGain, levelUpFrom, readSeen, storeKey } from "./LevelUpCelebration";

const mocks = vi.hoisted(() => ({ get: vi.fn(), user: { id: "a" }, enqueue: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { get: (...args) => mocks.get(...args) } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/components/achievements/ceremony/queue", () => ({ enqueueLevelUp: (...args) => mocks.enqueue(...args) }));

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

// Codex-Prüfung zu #1502: mehrere Tabs desselben Browsers und ein Kontowechsel während der Anfrage.
describe("claimLevelUp", () => {
  beforeEach(() => localStorage.clear());

  /** Eine Web-Locks-Attrappe: Anfragen auf denselben Namen laufen nacheinander, wie zwischen zwei Tabs. */
  function fakeLocks() {
    const chains = new Map();
    return {
      request(name, _options, callback) {
        const prev = chains.get(name) || Promise.resolve();
        const run = prev.then(() => new Promise((resolve) => setTimeout(resolve, 5))).then(() => callback());
        chains.set(name, run.catch(() => {}));
        return run;
      },
    };
  }

  it("zwei Tabs prüfen gleichzeitig: nur einer bekommt den Aufstieg", async () => {
    const key = storeKey("u1");
    localStorage.setItem(key, JSON.stringify({ level: 24, title: "", prestige: 0 }));
    const locks = fakeLocks();
    const next = { level: 25, title: "Goldmähne", prestige: 0 };
    const results = await Promise.all([claimLevelUp(key, next, locks), claimLevelUp(key, next, locks)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(readSeen(key)).toEqual(next);
  });

  it("ohne Web Locks: liest, vergleicht und schreibt in einem Zug", async () => {
    const key = storeKey("u2");
    localStorage.setItem(key, JSON.stringify({ level: 3, title: "", prestige: 0 }));
    expect(await claimLevelUp(key, { level: 4, title: "", prestige: 0 }, undefined)).toMatchObject({ level: 4, previous: 3 });
    expect(await claimLevelUp(key, { level: 4, title: "", prestige: 0 }, undefined)).toBeNull();
  });
});

describe("LevelUpCelebration", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.get.mockReset();
    mocks.enqueue.mockReset();
    mocks.user = { id: "a" };
  });

  it("Kontowechsel während der Anfrage: die Antwort landet nicht im Merker des vorigen Kontos", async () => {
    localStorage.setItem(storeKey("a"), JSON.stringify({ level: 10, title: "", prestige: 0 }));
    localStorage.setItem(storeKey("b"), JSON.stringify({ level: 40, title: "", prestige: 0 }));
    let answerA;
    mocks.get.mockImplementationOnce(() => new Promise((resolve) => { answerA = resolve; }));
    mocks.get.mockResolvedValue({ data: { level: 40, title: "", prestige: 0 } });
    const view = render(<LevelUpCelebration />);
    // Konto B meldet sich an, bevor die Antwort für A da ist - die Antwort kommt mit dem Stand von B.
    mocks.user = { id: "b" };
    view.rerender(<LevelUpCelebration />);
    await act(async () => { answerA({ data: { level: 40, title: "", prestige: 0 } }); });
    expect(readSeen(storeKey("a"))).toMatchObject({ level: 10 });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
