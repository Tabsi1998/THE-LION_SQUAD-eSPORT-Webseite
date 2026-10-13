import { friendPlaces, friendsSentence, friendsSharing, friendsSharingDefault, numberTiles, ownResultLine, podiumOrder } from "./eventRecap";

// Rückblick (#1187) und Freunde beim Event (#1188): dieselben Texte und Regeln wie auf der Website.

test("Podest: Platz 2 links, 1 in der Mitte, 3 rechts", () => {
  expect(podiumOrder([{ rank: 1, name: "Lena" }, { rank: 2, name: "Noah" }]).map((entry) => entry?.name || null)).toEqual(["Noah", "Lena", null]);
});

test("Zahlen: nur Summen, leere fallen weg", () => {
  expect(numberTiles({ participants: 0, matches: 1, tournaments: 2, fastlaps: 0, photos: 12 }).map((tile) => `${tile.value} ${tile.label}`))
    .toEqual(["0 Teilnehmer", "1 Spiel", "2 Turniere", "12 Fotos"]);
  expect(numberTiles(null)).toEqual([]);
});

test("eigenes Ergebnis wie im Web", () => {
  expect(ownResultLine({ kind: "tournament", id: "t", title: "Cup", rank: 1, of: 4, team_name: "Lions Rocket" })).toBe("Platz 1 von 4 · mit Lions Rocket");
  expect(ownResultLine({ kind: "fastlap", id: "f", title: "Fast Lap Spa", best_lap: "1:31.234", rank: 1, of: 5, track: "Spa" })).toBe("Beste Runde 1:31.234 · Platz 1 von 5 · Spa");
});

test("Freunde: Satz und Orte", () => {
  const friends = ["Finn", "Lea", "Mia", "Olga"].map((name) => ({ id: name, display_name: name, where: [] }));
  expect(friendsSentence(friends.slice(0, 1), { over: true })).toBe("Finn war dabei");
  expect(friendsSentence(friends)).toBe("Finn, Lea und 2 weitere sind dabei");
  expect(friendPlaces({ id: "f", display_name: "Finn", where: [{ kind: "event" }, { kind: "tournament", id: "t", title: "RL 2v2", team_name: "Lions" }] }))
    .toEqual(["Event", "RL 2v2 (Lions)"]);
});

test("Orte je Screen (#1188 Teil 2): Fast Lap mit Titel; Turnier nur Team bzw. „angemeldet“; Fast Lap „Zeit gefahren“", () => {
  const friend = { id: "f", display_name: "Finn", where: [{ kind: "event" as const }, { kind: "fastlap" as const, id: "c", title: "Monza-Hotlap" }] };
  expect(friendPlaces(friend)).toEqual(["Event", "Monza-Hotlap"]);
  expect(friendPlaces({ id: "f", display_name: "Finn", where: [{ kind: "tournament", id: "t", title: "RL", team_name: "Lions" }] }, { scope: "tournament" })).toEqual(["mit Lions"]);
  expect(friendPlaces({ id: "f", display_name: "Finn", where: [{ kind: "tournament", id: "t", title: "MK", team_name: null }] }, { scope: "tournament" })).toEqual(["angemeldet"]);
  expect(friendPlaces({ id: "f", display_name: "Finn", where: [{ kind: "fastlap", id: "c", title: "Monza" }] }, { scope: "fastlap" })).toEqual(["Zeit gefahren"]);
});

test("Schalter: Standard an, unter 14 Jahren aus, eigene Wahl zählt", () => {
  const now = new Date("2026-10-13T10:00:00Z");
  expect(friendsSharingDefault({}, now)).toBe(true);
  expect(friendsSharingDefault({ birth_date: "2012-10-14" }, now)).toBe(false);
  expect(friendsSharingDefault({ birth_date: "2012-10-13" }, now)).toBe(true);
  expect(friendsSharing({ birth_date: "2015-01-01", privacy_friends_see_registrations: true }, now)).toBe(true);
  expect(friendsSharing({ privacy_friends_see_registrations: false }, now)).toBe(false);
});
