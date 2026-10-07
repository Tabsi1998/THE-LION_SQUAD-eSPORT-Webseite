import { DEFAULT_RETURN_PATH, nextQuery, nextTarget, purposeSentence, safeNextPath } from "@/lib/returnPath";

// Eine Prüfregel für das Ziel nach Login, Registrieren, Google und Mail-Link (#1225): nur ein Pfad dieser Website mit
// genau einem „/“ am Anfang - alles andere führt zum Dashboard.

test("nur Pfade dieser Website zählen", () => {
  expect(safeNextPath("/turnier")).toBe("/turnier");
  expect(safeNextPath("/tournaments/mk-cup?access=abc")).toBe("/tournaments/mk-cup?access=abc");
  for (const bad of ["//fremd.example/x", "https://fremd.example", "javascript:alert(1)", "/\\fremd.example", "tournaments/x", " /turnier", "", null, undefined, 42, `/${"x".repeat(600)}`, "/a\nb"]) {
    expect(safeNextPath(bad), String(bad)).toBe(DEFAULT_RETURN_PATH);
  }
  expect(safeNextPath("https://fremd.example", "")).toBe("");
});

test("das Ziel wandert als ?next= mit - das Dashboard und fremde Ziele nicht", () => {
  expect(nextQuery("/tournaments/mk-cup")).toBe("?next=%2Ftournaments%2Fmk-cup");
  expect(nextQuery("/dashboard")).toBe("");
  expect(nextQuery("https://fremd.example")).toBe("");
  expect(nextQuery(null)).toBe("");
});

test("wofür: Turnier, Event oder Mitgliedsantrag - sonst nichts", () => {
  expect(nextTarget("/tournaments/mk-cup")).toEqual({ kind: "tournament", slug: "mk-cup", access: "" });
  expect(nextTarget("/tournaments/mk-cup?access=abc")).toEqual({ kind: "tournament", slug: "mk-cup", access: "abc" });
  expect(nextTarget("/events/herbst-lan")).toEqual({ kind: "event", slug: "herbst-lan", access: "" });
  expect(nextTarget("/membership/apply")).toEqual({ kind: "membership" });
  expect(nextTarget("/tournaments/mk-cup/bracket")).toBeNull();
  expect(nextTarget("/teams")).toBeNull();
  expect(nextTarget("/dashboard")).toBeNull();
  expect(nextTarget("//fremd.example/tournaments/x")).toBeNull();
});

test("der Satz je Ziel - ohne Ziel keiner", () => {
  const cup = { kind: "tournament", slug: "mk-cup", access: "" };
  expect(purposeSentence(cup, "Mario Kart Cup")).toBe("Melde dich an, um dich für „Mario Kart Cup“ anzumelden.");
  expect(purposeSentence(cup, "Mario Kart Cup", "register")).toBe("Erstelle ein Konto, um dich für „Mario Kart Cup“ anzumelden.");
  expect(purposeSentence(cup, "")).toBe("Melde dich an, um dich für das Turnier anzumelden.");
  expect(purposeSentence({ kind: "event", slug: "x", access: "" }, "")).toBe("Melde dich an, um dich für das Event anzumelden.");
  expect(purposeSentence({ kind: "membership" })).toBe("Melde dich an, um deinen Mitgliedsantrag zu stellen.");
  expect(purposeSentence(null, "egal")).toBe("");
});
