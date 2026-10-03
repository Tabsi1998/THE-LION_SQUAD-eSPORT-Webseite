import { MOTIONS, MOTION_KEYS, PHONE_PARTICLE_CAP, SEQUENCE_KEYS, describePackage, particleBudget, particleKind, planCeremony, sortByRank } from "./select";

// Auswahl-Logik der App (E13, #623): dieselben Fälle wie im Web (select.test.js) - welcher Ablauf für welches
// Paket, welche Bewegung für welche Kategorie. Nur das Partikelbudget ist am Handy kleiner.

const tier = (code: string, material: string, rank: number, category: string, extra: Record<string, unknown> = {}) => ({ code, name: code, material, rank, category, points: rank * 10, ...extra });

describe("planCeremony", () => {
  it("nimmt Material und Bewegung von der höchsten Stufe", () => {
    const plan = planCeremony({ tiers: [tier("a", "bronze", 3, "match"), tier("b", "gold", 5, "fastlap"), tier("c", "wood", 1, "team")] })!;
    expect(plan.material).toBe("gold");
    expect(plan.motion).toBe("driveby");
    expect(plan.sequence).toBe("stack");
    expect(plan.tiers.map((t) => t.code)).toEqual(["b", "a", "c"]);
    expect(plan.points).toBe(90);
    expect(plan.autoAdvanceMs).toBe(2500);
    expect(plan.duration).toBe(3000 + 2500 * 3);
    expect(plan.sound).toEqual({ material: "gold", special: null });
  });

  it("kennt elf Bewegungen und acht Abläufe", () => {
    expect(Object.keys(MOTIONS)).toHaveLength(11);
    expect(MOTION_KEYS).toHaveLength(11);
    expect(SEQUENCE_KEYS).toEqual(["single", "stack", "first", "group", "category", "diamond", "legendary", "levelup"]);
  });

  it("wählt die Sonderabläufe in der richtigen Rangfolge", () => {
    expect(planCeremony({ tiers: [tier("a", "silver", 4, "match")] })!.sequence).toBe("single");
    expect(planCeremony({ tiers: [tier("a", "diamond", 7, "match")] })!.sequence).toBe("diamond");
    expect(planCeremony({ tiers: [tier("a", "legendary", 8, "special")] })!.sequence).toBe("legendary");
    expect(planCeremony({ tiers: [tier("a", "legendary", 8, "special")], context: { groupCompleted: "x" } })!.sequence).toBe("group");
    expect(planCeremony({ tiers: [tier("a", "diamond", 7, "match")], context: { groupCompleted: "x", categoryCompleted: "match" } })!.sequence).toBe("category");
    expect(planCeremony({ tiers: [tier("a", "wood", 1, "match")], context: { firstEver: true, categoryCompleted: "match" } })!.sequence).toBe("first");
    expect(planCeremony({ tiers: [], levelUp: { level: 10, title: "Kämpfer" } })!.sequence).toBe("levelup");
    const withLevel = planCeremony({ tiers: [tier("a", "gold", 5, "team")], levelUp: { level: 10 } })!;
    expect(withLevel.sequence).toBe("single");
    expect(withLevel.levelUp).toEqual({ level: 10 });
  });

  it("feiert Negatives nie und leere Pakete auch nicht", () => {
    expect(planCeremony({ tiers: [tier("n", "hidden", 9, "negative", { is_negative: true })] })).toBeNull();
    expect(planCeremony({ tiers: [] })).toBeNull();
    expect(planCeremony(null)).toBeNull();
    const mixed = planCeremony({ tiers: [tier("n", "hidden", 9, "negative", { is_negative: true }), tier("a", "iron", 2, "profile")] })!;
    expect(mixed.tiers.map((t) => t.code)).toEqual(["a"]);
    expect(mixed.motion).toBe("card");
  });

  it("leitet Material und Rang aus alten Leveln ab und erkennt Geheimes", () => {
    const plan = planCeremony({ tiers: [{ code: "old", name: "Alt", level: 3, category: "content", points: 60 }] })!;
    expect(plan.material).toBe("gold");
    expect(plan.motion).toBe("live");
    expect(plan.hidden).toBe(false);
    const secret = planCeremony({ tiers: [tier("s", "hidden", 9, "hidden", { hidden: true, award_id: "aw-9" })] })!;
    expect(secret.hidden).toBe(true);
    expect(secret.motion).toBe("smoke");
    expect(secret.shareId).toBe("aw-9");
    expect(sortByRank([{ code: "x", level: 2 }, { code: "y", level: 4 }]).map((t) => t.code)).toEqual(["y", "x"]);
  });

  it("hält das Partikelbudget und kennt eine Partikelart je Material", () => {
    // Am Handy höchstens 60 Partikel - im selben Verhältnis wie im Web (160 am PC).
    expect(particleBudget("single", "wood")).toBe(15);
    expect(particleBudget("legendary", "legendary")).toBe(PHONE_PARTICLE_CAP);
    expect(particleBudget("diamond", "diamond")).toBe(PHONE_PARTICLE_CAP);
    expect(particleBudget("category", "gold")).toBe(53);
    for (const m of ["wood", "iron", "bronze", "silver", "gold", "platinum", "diamond", "legendary", "hidden"]) expect(typeof particleKind(m)).toBe("string");
  });
});

describe("describePackage", () => {
  const groups = [
    { code: "g1", category: "match", tiers: [{ code: "g1_1", earned: true }, { code: "g1_2", earned: true }, { code: "g1_3", earned: true }] },
    { code: "g2", category: "match", tiers: [{ code: "g2_1", earned: true }, { code: "g2_2", earned: false, current: 1, target: 5 }] },
    { code: "neg", category: "negative", is_negative: true, tiers: [{ code: "neg_1", earned: true }] },
  ];
  it("erkennt den ersten Erfolg, eine abgeschlossene Gruppe und eine abgeschlossene Kategorie", () => {
    expect(describePackage(groups, [{ code: "g1_3" }])).toEqual({ firstEver: false, groupCompleted: "g1", categoryCompleted: null });
    const first = [{ code: "only", category: "team", tiers: [{ code: "only_1", earned: true }, { code: "only_2", earned: false }] }];
    expect(describePackage(first, [{ code: "only_1" }]).firstEver).toBe(true);
    const done = [
      { code: "a", category: "season", tiers: [{ code: "a1", earned: true }, { code: "a2", earned: true }, { code: "a3", earned: true }] },
      { code: "b", category: "season", tiers: [{ code: "b1", earned: true }, { code: "b2", earned: true }, { code: "b3", earned: true }] },
      { code: "c", category: "season", tiers: [{ code: "c1", earned: true }, { code: "c2", earned: true }, { code: "c3", earned: true, manual_only: true }] },
    ];
    expect(describePackage(done, [{ code: "b3" }]).categoryCompleted).toBe("season");
    expect(describePackage(done, [{ code: "b3" }]).groupCompleted).toBe("b");
  });
});
