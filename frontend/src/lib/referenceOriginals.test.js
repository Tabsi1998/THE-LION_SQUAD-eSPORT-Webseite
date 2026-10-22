import {
  defaultOriginalKind, hiddenReason, originalLabel, originalsOf, originalSrc, originalSrcSet, sourceLink, sourceUrlProblem,
} from "./referenceOriginals";

// Original-Bilder des Veranstalters (#1933): Beschriftung, Vorschaubilder, Quellen-Link nur https.

test("Art und Map-Nummer ergeben die Beschriftung", () => {
  expect(originalLabel({ kind: "race" })).toBe("Rennen");
  expect(originalLabel({ kind: "scoreboard", map: 2 })).toBe("Scoreboard · Map 2");
  expect(originalLabel({ kind: "table", map: 3 })).toBe("Tabelle");
  expect(originalLabel({ kind: "erfunden" })).toBe("Original");
});

test("ohne Wahl: der Lauf in einer Rennliga, sonst Sonstiges", () => {
  expect(defaultOriginalKind({ session: "Sprint" }, "racing")).toBe("sprint");
  expect(defaultOriginalKind({ session_kind: "qualifying" }, "racing")).toBe("qualifying");
  expect(defaultOriginalKind({ session: "" }, "racing")).toBe("race");
  expect(defaultOriginalKind({ session: "Sprint" }, "team_league")).toBe("other");
});

test("Vorschaubilder nur kleiner als das Bild", () => {
  const item = { url: "/api/reference-series/public/liga/2026/originals/o1", width: 900 };
  expect(originalSrc(item.url, 400)).toBe(`${item.url}?w=400`);
  expect(originalSrc(item.url)).toBe(item.url);
  expect(originalSrcSet(item)).toBe(`${item.url}?w=160 160w, ${item.url}?w=320 320w, ${item.url}?w=400 400w, ${item.url}?w=800 800w, ${item.url} 900w`);
  expect(originalSrcSet({ url: item.url })).toBeUndefined();
});

test("Quellen-Link nur als https", () => {
  expect(sourceLink({ source_url: "https://veranstalter.example/r1" })).toBe("https://veranstalter.example/r1");
  for (const bad of ["http://veranstalter.example/r1", "javascript:alert(1)", "//veranstalter.example", "", null]) {
    expect(sourceLink({ source_url: bad })).toBe("");
  }
  expect(sourceUrlProblem("")).toBe("");
  expect(sourceUrlProblem("http://veranstalter.example")).toMatch(/https/);
});

test("warum ein Bild öffentlich nicht erscheint", () => {
  expect(hiddenReason({ shown: true })).toBe("");
  expect(hiddenReason({ shown: false, hidden_reason: "admin_only" })).toBe("Nur Verwaltung");
  expect(hiddenReason({ shown: false, hidden_reason: "hidden_name" })).toMatch(/Name ausgeblendet/);
});

test("die Bilder aller Läufe einer Runde in einer Liste, mit Lauf davor", () => {
  const originals = { q: [{ id: "a", kind: "qualifying" }], s: [{ id: "b", kind: "sprint" }, { id: "c", kind: "table" }] };
  const rounds = [{ id: "q", session: "Qualifying" }, { id: "s", session: "Sprint" }, { id: "r", session: "Rennen" }];
  expect(originalsOf(originals, rounds, { withSession: true }).map((item) => [item.id, item.label]))
    .toEqual([["a", "Qualifying"], ["b", "Sprint"], ["c", "Sprint · Tabelle"]]);
  expect(originalsOf(originals, rounds).map((item) => item.label)).toEqual(["Qualifying", "Sprint", "Tabelle"]);
  expect(originalsOf(null, rounds)).toEqual([]);
});
