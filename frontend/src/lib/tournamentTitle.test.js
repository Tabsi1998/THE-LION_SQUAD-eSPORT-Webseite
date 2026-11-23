import { splitTournamentTitle } from "@/lib/tournamentTitle";

// Zusammengesetzte Turniertitel (#1314): Event-Teil, Tag, Spiel und der eigentliche Name.

test("mit Event, Spiel und Tag: jeder Teil an seinem Platz", () => {
  const parts = splitTournamentTitle({
    title: "Herbst-LAN • Mario Kart 8 Deluxe • Kleines Turnier | Samstag",
    event: { name: "Herbst-LAN" },
    game: { name: "Mario Kart 8 Deluxe" },
  });
  expect(parts).toEqual({ event: "Herbst-LAN", day: "Samstag", game: "Mario Kart 8 Deluxe", name: "Kleines Turnier" });
});

test("nur ein Name: bleibt ganz, ohne Event, Tag und Spiel", () => {
  expect(splitTournamentTitle({ title: "Kleines Turnier" })).toEqual({ event: "", day: "", game: "", name: "Kleines Turnier" });
  expect(splitTournamentTitle("Winter-Cup 2026")).toEqual({ event: "", day: "", game: "", name: "Winter-Cup 2026" });
});

test("ohne Event und ohne Tag: nur das Spiel fällt weg", () => {
  expect(splitTournamentTitle({ title: "FIFA 26 – Pokal der Löwen", game_name: "FIFA 26" }))
    .toEqual({ event: "", day: "", game: "FIFA 26", name: "Pokal der Löwen" });
});

test("alle Trennzeichen: • | – ·", () => {
  for (const sep of ["•", "|", "–", "·"]) {
    expect(splitTournamentTitle({ title: `Vereinsabend ${sep} Tetris Duell`, event: "Vereinsabend" }).name).toBe("Tetris Duell");
  }
});

test("Tag als Kurzform, „Tag 2“ oder Datum", () => {
  expect(splitTournamentTitle({ title: "Smash Cup | Sa" }).day).toBe("Sa");
  expect(splitTournamentTitle({ title: "Smash Cup · Tag 2" }).day).toBe("Tag 2");
  expect(splitTournamentTitle({ title: "Smash Cup – 23.05." }).day).toBe("23.05.");
});

test("Bindestriche im Wort trennen nicht, ein Wort, das nur wie ein Tag beginnt, bleibt Name", () => {
  expect(splitTournamentTitle({ title: "Herbst-LAN Kleines-Turnier" }).name).toBe("Herbst-LAN Kleines-Turnier");
  expect(splitTournamentTitle({ title: "Sommer-Cup • Sonntagsrunde" }))
    .toEqual({ event: "", day: "", game: "", name: "Sommer-Cup · Sonntagsrunde" });
});

test("Kurzform des Events am Anfang: „Herbst-LAN 2026“ zum Event „Herbst-LAN 2026 im Kulturhaus“", () => {
  const event = { name: "Herbst-LAN 2026 im Kulturhaus Großweikersdorf" };
  expect(splitTournamentTitle({ title: "Herbst-LAN 2026 • Kleines Turnier", event }))
    .toEqual({ event: "Herbst-LAN 2026", day: "", game: "", name: "Kleines Turnier" });
  // nur am Anfang, nur ganze Wörter und nie der ganze Titel
  expect(splitTournamentTitle({ title: "Kleines Turnier • Herbst-LAN 2026", event }).event).toBe("");
  expect(splitTournamentTitle({ title: "Herbst • Kleines Turnier", event: { name: "Herbst-LAN 2026" } }).event).toBe("");
  expect(splitTournamentTitle({ title: "Herbst-LAN 2026", event }).name).toBe("Herbst-LAN 2026");
});

test("besteht der Titel nur aus Event und Spiel, ist das Spiel der Name", () => {
  expect(splitTournamentTitle({ title: "Herbst-LAN • Tetris", event: "Herbst-LAN", game: "Tetris" }))
    .toEqual({ event: "Herbst-LAN", day: "", game: "Tetris", name: "Tetris" });
});

test("leer oder ohne Wert: leerer Name statt Fehler", () => {
  expect(splitTournamentTitle(null).name).toBe("");
  expect(splitTournamentTitle({ title: "  " }).name).toBe("");
});
