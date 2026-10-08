// Jahresrückblick (#1195): dieselbe Seitenfolge und dieselben Sätze wie im Web; das Bild nur mit Anmeldung.

const mockFs = { cacheDirectory: "file:///cache/", downloadAsync: jest.fn() };
const mockSharing = { isAvailableAsync: jest.fn(), shareAsync: jest.fn() };
jest.mock("expo-file-system/legacy", () => mockFs);
jest.mock("expo-sharing", () => mockSharing);
jest.mock("./api", () => ({ resolveMediaUrl: (value?: string | null) => (value ? `https://verein.example${value}` : "") }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { bestResultText, comparisonText, fastlapText, seasonText, shareYearCard, yearCardUrl, yearReviewPages } = require("./yearReview");

const FULL = {
  year: 2026, club_name: "THE LION SQUAD", image_path: "/api/year-review/me/card.png",
  tournaments: { count: 31, wins: 7, podiums: 12, games: 41, best: { title: "FC 26 Herbst-Cup", rank: 1, participant_count: 16 }, more_than_of_ten: 9 },
  favorite_game: { name: "EA SPORTS FC 26", tournaments: 19, games: 41 },
  events: { count: 4, items: [{ name: "LAN-Wochenende Herbst", date: "03.10.2026" }] },
  fastlap: { count: 3, best: { time: "2:01,300", track: "Spa", title: "Spa Challenge", rank: 2, participant_count: 14 } },
  achievements: { count: 9, top: [{ name: "Spielmacher III", material_name: "Gold", material_color: "#FFD700" }] },
  season: { name: "Jahreswertung 2026", rank: 5, points: 210.5, participants: 48 },
};

beforeEach(() => {
  mockFs.downloadAsync.mockReset();
  mockSharing.isAvailableAsync.mockReset();
  mockSharing.shareAsync.mockReset();
});

test("Seitenfolge wie im Web - nur Seiten mit Inhalt, höchstens acht", () => {
  expect(yearReviewPages(FULL)).toEqual(["intro", "tournaments", "favorite", "events", "fastlap", "achievements", "season", "share"]);
  expect(yearReviewPages({ ...FULL, tournaments: { count: 0 }, favorite_game: null, fastlap: { count: 0, best: null }, achievements: { count: 0 }, season: null }))
    .toEqual(["intro", "events", "share"]);
  expect(yearReviewPages(null)).toEqual([]);
});

test("Sätze wie im Web", () => {
  expect(comparisonText(FULL)).toBe("Mehr Turniere als 9 von 10 im Verein.");
  expect(bestResultText(FULL)).toBe("Dein bestes Ergebnis: Platz 1 im FC 26 Herbst-Cup (von 16).");
  expect(fastlapText(FULL)).toBe("Spa · Spa Challenge – Platz 2 von 14");
  expect(seasonText(FULL)).toBe("von 48 · 210,5 Punkte");
});

test("Bild teilen lädt mit Anmeldung und öffnet das Teilen-Menü", async () => {
  expect(yearCardUrl(FULL)).toBe("https://verein.example/api/year-review/me/card.png");
  expect(yearCardUrl({ ...FULL, preview: true })).toBe("https://verein.example/api/year-review/me/card.png?vorschau=true");
  mockSharing.isAvailableAsync.mockResolvedValue(true);
  mockFs.downloadAsync.mockResolvedValue({ uri: "file:///cache/mein-jahr-2026.png", status: 200 });
  expect(await shareYearCard(FULL, "token-1")).toBe("shared");
  expect(mockFs.downloadAsync).toHaveBeenCalledWith("https://verein.example/api/year-review/me/card.png", "file:///cache/mein-jahr-2026.png", { headers: { Authorization: "Bearer token-1" } });
  expect(mockSharing.shareAsync).toHaveBeenCalledWith("file:///cache/mein-jahr-2026.png", { mimeType: "image/png", UTI: "public.png", dialogTitle: "Mein 2026" });
  expect(await shareYearCard(FULL, null)).toBe("failed");
  mockFs.downloadAsync.mockResolvedValue({ uri: "x", status: 404 });
  expect(await shareYearCard(FULL, "token-1")).toBe("failed");
});
