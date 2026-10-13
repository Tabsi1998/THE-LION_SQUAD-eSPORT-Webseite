import { friendPlaces, friendsSentence, friendsSharing, friendsSharingDefault, numberTiles, ownResultLine, podiumOrder } from "@/lib/eventRecap";

// Rückblick (#1187) und Freunde beim Event (#1188): Texte und die Regel für den Standard des Schalters.

test("Podest: Platz 2 links, 1 in der Mitte, 3 rechts - fehlende Plätze bleiben leer", () => {
  const podium = [{ rank: 1, name: "Lena" }, { rank: 2, name: "Noah" }];
  expect(podiumOrder(podium).map((entry) => entry?.name || null)).toEqual(["Noah", "Lena", null]);
  expect(podiumOrder([])).toEqual([null, null, null]);
});

test("Zahlen: nur Summen, leere fallen weg, Einzahl und Mehrzahl", () => {
  expect(numberTiles({ participants: 0, matches: 1, tournaments: 2, fastlaps: 0, photos: 12 })).toEqual([
    { key: "participants", value: 0, label: "Teilnehmer" },
    { key: "matches", value: 1, label: "Spiel" },
    { key: "tournaments", value: 2, label: "Turniere" },
    { key: "photos", value: 12, label: "Fotos" },
  ]);
  expect(numberTiles(null)).toEqual([]);
});

test("eigenes Ergebnis: Platz, Team und beste Runde", () => {
  expect(ownResultLine({ kind: "tournament", rank: 2, of: 8, team_name: null })).toBe("Platz 2 von 8");
  expect(ownResultLine({ kind: "tournament", rank: 1, of: 4, team_name: "Lions Rocket" })).toBe("Platz 1 von 4 · mit Lions Rocket");
  expect(ownResultLine({ kind: "tournament", rank: null, of: 4 })).toBe("Ohne Platzierung");
  expect(ownResultLine({ kind: "fastlap", title: "Fast Lap Spa", best_lap: "1:31.234", rank: 1, of: 5, track: "Spa" })).toBe("Beste Runde 1:31.234 · Platz 1 von 5 · Spa");
});

test("Freunde: ein Satz mit Namen, nach dem Event in der Vergangenheit; Orte mit Teamname", () => {
  const friends = [{ display_name: "Finn" }, { display_name: "Lea" }, { display_name: "Mia" }, { display_name: "Olga" }];
  expect(friendsSentence(friends.slice(0, 1))).toBe("Finn ist dabei");
  expect(friendsSentence(friends.slice(0, 2), { over: true })).toBe("Finn und Lea waren dabei");
  expect(friendsSentence(friends.slice(0, 3))).toBe("Finn, Lea und Mia sind dabei");
  expect(friendsSentence(friends)).toBe("Finn, Lea und 2 weitere sind dabei");
  expect(friendsSentence([])).toBe("");
  expect(friendPlaces({ where: [{ kind: "event" }, { kind: "tournament", title: "Rocket League 2v2", team_name: "Lions Rocket" }] }))
    .toEqual(["Event", "Rocket League 2v2 (Lions Rocket)"]);
});

test("Schalter „Freunde sehen, wo ich angemeldet bin“: Standard an, unter 14 Jahren aus, eigene Wahl zählt", () => {
  const now = new Date("2026-10-13T10:00:00Z");
  expect(friendsSharingDefault({}, now)).toBe(true);
  expect(friendsSharingDefault({ birth_date: "2012-10-14" }, now)).toBe(false);
  expect(friendsSharingDefault({ birth_date: "2012-10-13" }, now)).toBe(true);
  expect(friendsSharing({ birth_date: "2015-01-01", privacy_friends_see_registrations: true }, now)).toBe(true);
  expect(friendsSharing({ privacy_friends_see_registrations: false }, now)).toBe(false);
});
