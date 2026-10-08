import { bestResultText, comparisonText, countWord, fastlapText, seasonText, yearReviewPages } from "./yearReview";

// Jahresrückblick (#1195): Seitenfolge nur mit Inhalt, höchstens acht Seiten; die Sätze in Alltagssprache.

const FULL = {
  year: 2026, user: { display_name: "Neonfalke" }, club_name: "THE LION SQUAD", image_path: "/api/year-review/me/card.png",
  tournaments: { count: 31, wins: 7, podiums: 12, games: 41, games_won: 26, best: { title: "FC 26 Herbst-Cup", rank: 1, participant_count: 16 }, more_than_of_ten: 9 },
  favorite_game: { name: "EA SPORTS FC 26", tournaments: 19, games: 41 },
  events: { count: 4, items: [{ name: "LAN-Wochenende Herbst", date: "03.10.2026" }] },
  fastlap: { count: 3, best: { time: "2:01,300", track: "Spa", title: "Spa Challenge", rank: 2, participant_count: 14 } },
  achievements: { count: 9, points: 240, top: [{ name: "Spielmacher III", material_name: "Gold", material_color: "#FFD700" }] },
  season: { name: "Jahreswertung 2026", rank: 5, points: 210.5, participants: 48 },
};

test("alle Seiten in fester Reihenfolge - höchstens acht", () => {
  const pages = yearReviewPages(FULL);
  expect(pages).toEqual(["intro", "tournaments", "favorite", "events", "fastlap", "achievements", "season", "share"]);
  expect(pages.length).toBeLessThanOrEqual(8);
});

test("Seiten ohne Inhalt fallen weg; ohne Rückblick keine Seiten", () => {
  const onlyEvents = { ...FULL, tournaments: { count: 0 }, favorite_game: null, fastlap: { count: 0, best: null }, achievements: { count: 0 }, season: null };
  expect(yearReviewPages(onlyEvents)).toEqual(["intro", "events", "share"]);
  expect(yearReviewPages(null)).toEqual([]);
});

test("Sätze für Vergleich, bestes Ergebnis, Bestzeit und Jahreswertung", () => {
  expect(comparisonText(FULL)).toBe("Mehr Turniere als 9 von 10 im Verein.");
  expect(comparisonText({ tournaments: { more_than_of_ten: null } })).toBe("");
  expect(bestResultText(FULL)).toBe("Dein bestes Ergebnis: Platz 1 im FC 26 Herbst-Cup (von 16).");
  expect(fastlapText(FULL)).toBe("Spa · Spa Challenge – Platz 2 von 14");
  expect(seasonText(FULL)).toBe("von 48 · 210,5 Punkte");
  expect(countWord(1, "Turnier", "Turniere")).toBe("1 Turnier");
  expect(countWord(3, "Turnier", "Turniere")).toBe("3 Turniere");
});
