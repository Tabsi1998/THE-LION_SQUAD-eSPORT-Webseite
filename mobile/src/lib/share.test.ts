import { Share } from "react-native";

// Teilen (#1154): je Seitenart die Adresse der Website - die App öffnet sie wieder im richtigen Screen - und ein kurzer
// Satz „Titel · Datum · THE LION SQUAD“ wie im Web.

jest.mock("../navigation/rootNavigation", () => jest.requireActual("../navigation/rootNavigation"));

const { SHARE_PATHS, shareDateLabel, sharePage, shareText, shareUrl } = require("./share");
const { targetFromUrl } = require("../navigation/rootNavigation");

const NOW = new Date("2026-10-08T10:00:00Z");

test("Datum: ein Tag mit Uhrzeit, mehrere Tage als Spanne, über den Monat, anderes Jahr mit Jahreszahl", () => {
  expect(shareDateLabel("2026-11-14T09:00:00+01:00", "2026-11-16T18:00:00+01:00", NOW)).toBe("14.–16. November");
  expect(shareDateLabel("2026-10-30T09:00:00+01:00", "2026-11-02T18:00:00+01:00", NOW)).toBe("30. Oktober – 2. November");
  expect(shareDateLabel("2027-05-22T16:00:00+02:00", null, NOW)).toBe("Sa 22. Mai 2027 · 16:00");
  expect(shareDateLabel("2026-12-30T10:00:00+01:00", "2027-01-02T18:00:00+01:00", NOW)).toBe("30. Dezember 2026 – 2. Jänner 2027");
  expect(shareDateLabel(null, null, NOW)).toBe("");
});

test("Satz: Titel, Zusatz, Datum, Verein - leere Teile fallen weg", () => {
  expect(shareText({ title: "Herbst-LAN 2026", start: "2026-11-14T09:00:00+01:00", end: "2026-11-16T18:00:00+01:00", now: NOW })).toBe("Herbst-LAN 2026 · 14.–16. November · THE LION SQUAD");
  expect(shareText({ title: "Lions Rocket [LRK]", detail: "Team" })).toBe("Lions Rocket [LRK] · Team · THE LION SQUAD");
  expect(shareText({ title: "Saisonfinale" })).toBe("Saisonfinale · THE LION SQUAD");
});

test("Adresse je Seitenart: die App öffnet sie im richtigen Screen", () => {
  const screens: Record<string, string> = { event: "EventDetail", tournament: "TournamentDetail", fastlap: "FastLapDetail", news: "NewsDetail", team: "TeamDetail", album: "GalleryAlbum" };
  for (const kind of Object.keys(SHARE_PATHS)) {
    const url = shareUrl(kind, "herbst-lan");
    expect(url).toMatch(new RegExp(`/${SHARE_PATHS[kind]}/herbst-lan$`));
    expect(targetFromUrl(url)).toEqual(expect.objectContaining({ kind: "detail", screen: screens[kind], params: expect.objectContaining({ id: "herbst-lan" }) }));
  }
});

test("Teilen öffnet das Teilen-Menü mit Satz und Adresse; Abbrechen ist kein Fehler", async () => {
  const spy = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" });
  await expect(sharePage({ kind: "news", id: "saisonfinale", title: "Saisonfinale" })).resolves.toBe(true);
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ title: "Saisonfinale", url: expect.stringMatching(/\/news\/saisonfinale$/), message: expect.stringMatching(/^Saisonfinale · THE LION SQUAD\n.*\/news\/saisonfinale$/) }));
  spy.mockRejectedValueOnce(new Error("abgebrochen"));
  await expect(sharePage({ kind: "team", id: "t1", title: "Lions" })).resolves.toBe(false);
  spy.mockRestore();
});
