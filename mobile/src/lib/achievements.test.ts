import {
  achievementIcon, announceAchievementUnlocked, freshTiers, groupProgress, knownIconNames, onAchievementUnlocked,
  type AchievementGroup,
} from "./achievements";

// Erfolge in der App (#218): Symbol je Gruppe, Fortschritt in der zugeklappten Zeile, und was
// seit dem letzten Blick neu ist.

jest.mock("@expo/vector-icons", () => ({ Ionicons: { glyphMap: {} } }));

const group = (tiers: AchievementGroup["tiers"], extra: Partial<AchievementGroup> = {}): AchievementGroup => ({
  code: "g", name: "Turniersiege", category: "tournament", icon: "trophy", tiers, ...extra,
});

test("jede Gruppe bekommt ein Symbol – aus dem Katalog, sonst nach Kategorie, sonst den Pokal", () => {
  expect(achievementIcon({ icon: "flame", category: "match" })).toBe("flame");
  expect(achievementIcon({ icon: "sun" })).toBe("sunny");
  expect(achievementIcon({ icon: "GraduationCap" })).toBe("school");
  expect(achievementIcon({ icon: "gibt-es-nicht", category: "fastlap" })).toBe("speedometer");
  expect(achievementIcon({ icon: null, category: "unbekannt" })).toBe("trophy");
  expect(achievementIcon(null)).toBe("trophy");
});

test("die Symbole des Katalogs sind alle bekannt", () => {
  // Stand des Katalogs (backend/achievement_catalog.py) am 21.09.2026 – kommt ein neues Symbol
  // dazu, zeigt die App sonst nur den Ersatz nach Kategorie.
  const catalogue = ["alert-octagon", "badge-alert", "badge-plus", "ban", "broadcast", "calendar-check", "calendar-plus", "check-check",
    "clapperboard", "cpu", "crown", "dumbbell", "flag", "flame", "flask", "frown", "gauge", "git-branch", "graduation-cap", "hand-heart",
    "hand-helping", "handshake", "heart-handshake", "id-card", "layers", "map", "medal", "message-circle", "messages-square", "moon",
    "radio", "rocket", "server", "shield", "sparkles", "star", "sun", "swords", "timer", "trending-up", "trophy", "tv", "user-check",
    "user-plus", "user-x", "users", "users-round", "users-x", "zap"];
  const known = new Set(knownIconNames());
  expect(catalogue.filter((name) => !known.has(name))).toEqual([]);
});

test("zugeklappt steht der Weg zur nächsten Stufe da: „3 von 10“", () => {
  const progress = groupProgress(group([
    { code: "t1", name: "Erster Sieg", level: 1, earned: true },
    { code: "t2", name: "Seriensieger", level: 2, earned: false, current: 3, target: 10, percent: 30 },
    { code: "t3", name: "Legende", level: 3, earned: false, current: 3, target: 50, percent: 6 },
  ]));
  expect(progress.label).toBe("3 von 10");
  expect(progress.percent).toBe(30);
  expect(progress.next?.name).toBe("Seriensieger");
  expect(progress.highestLevel).toBe(1);
  expect(progress.done).toBe(false);
});

test("alles erreicht, nur von Hand vergeben, geplant – jeweils ein ehrlicher Text", () => {
  expect(groupProgress(group([{ code: "a", name: "A", level: 3, earned: true }])).label).toBe("Alle Stufen erreicht");
  expect(groupProgress(group([{ code: "a", name: "A", level: 3, earned: true }])).percent).toBe(100);
  const manual = groupProgress(group([{ code: "a", name: "A", earned: true, level: 1 }, { code: "b", name: "B", earned: false, manual_only: true }]));
  expect(manual.label).toBe("1 von 2 Stufen");
  expect(manual.percent).toBe(50);
  const planned = groupProgress(group([{ code: "p", name: "P", earned: false, target: 5, current: 1, condition_status: "planned" }]));
  expect(planned.next).toBeNull();
  expect(planned.label).toBe("0 von 1 Stufen");
  expect(groupProgress(group([])).label).toBe("0 von 0 Stufen");
});

test("ein Zähler über dem Ziel wird nicht größer als das Ziel, große Zahlen bekommen Punkte", () => {
  const progress = groupProgress(group([{ code: "t", name: "T", earned: false, current: 12000, target: 10000 }]));
  expect(progress.label).toBe("10.000 von 10.000");
  expect(progress.percent).toBe(100);
});

test("neu ist, was seit dem letzten Blick freigeschaltet wurde – negative Gruppen nie", () => {
  const groups: AchievementGroup[] = [
    group([
      { code: "alt", name: "Alt", earned: true, earned_at: "2026-09-01T10:00:00Z" },
      { code: "neu1", name: "Neu 1", earned: true, earned_at: "2026-09-21T10:00:00Z" },
      { code: "neu2", name: "Neu 2", earned: true, earned_at: "2026-09-21T12:00:00Z" },
      { code: "offen", name: "Offen", earned: false },
    ]),
    group([{ code: "strafe", name: "Strafe", earned: true, earned_at: "2026-09-21T11:00:00Z" }], { code: "n", is_negative: true }),
  ];
  expect(freshTiers(groups, "2026-09-20T00:00:00Z").map((tier) => tier.code)).toEqual(["neu2", "neu1"]);
  expect(freshTiers(groups, null)).toEqual([]);
  expect(freshTiers(groups, "kein Datum")).toEqual([]);
  expect(freshTiers(undefined, "2026-09-20T00:00:00Z")).toEqual([]);
});

test("der Freischalt-Moment lässt sich abonnieren und wieder abbestellen", () => {
  const listener = jest.fn();
  const stop = onAchievementUnlocked(listener);
  announceAchievementUnlocked();
  expect(listener).toHaveBeenCalledTimes(1);
  stop();
  announceAchievementUnlocked();
  expect(listener).toHaveBeenCalledTimes(1);
});
