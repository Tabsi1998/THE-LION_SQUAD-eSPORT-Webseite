// Wiedergabeliste (#1121): Reihenfolge und Dauer, leere Folien überspringen, Sponsor und Zahlen nur „zwischendurch“,
// ein Link mit nur einer Folie ohne Wechsel.
import { DEFAULT_PLAYLIST, advance, changesAfter, firstIndex, isDue, onlyMomentSlides, parsePlaylist, playlistLabel, serializePlaylist, validPlaylist } from "./tvPlaylist";

const all = () => true;
const only = (...slides) => (slide) => slides.includes(slide);

test("der Standard aus der Vorschau: Baum 12 s, Live-Spiele 8 s, Aufrufe 8 s, Sponsor 6 s, Zahlen 8 s", () => {
  expect(DEFAULT_PLAYLIST.map((entry) => `${entry.slide}:${entry.seconds}`)).toEqual(["tree:12", "live:8", "calls:8", "sponsor:6", "stats:8"]);
  expect(validPlaylist(DEFAULT_PLAYLIST.map((entry) => ({ ...entry })))).toBe(true);
  expect(playlistLabel(DEFAULT_PLAYLIST)).toBe("Turnierbaum 12 s · Live-Spiele 8 s · Aufrufe 8 s · Sponsor 6 s · Zahlen 8 s");
  expect(parsePlaylist(serializePlaylist(DEFAULT_PLAYLIST))).toEqual(DEFAULT_PLAYLIST.map((entry) => ({ ...entry })));
});

test("Reihenfolge: nach dem Baum die Live-Spiele, dann die Aufrufe, dann wieder der Baum", () => {
  expect(advance(DEFAULT_PLAYLIST, 0, only("tree", "live", "calls"))).toEqual({ index: 1, moments: [] });
  expect(advance(DEFAULT_PLAYLIST, 1, only("tree", "live", "calls"))).toEqual({ index: 2, moments: [] });
  expect(advance(DEFAULT_PLAYLIST, 2, only("tree", "live", "calls"))).toEqual({ index: 0, moments: [] });
});

test("leere Folien werden übersprungen: keine Aufrufe, keine Aufruf-Folie", () => {
  expect(advance(DEFAULT_PLAYLIST, 1, only("tree", "live"))).toEqual({ index: 0, moments: [] });
  expect(advance(DEFAULT_PLAYLIST, 0, only("tree", "calls"))).toEqual({ index: 2, moments: [] });
  // Nichts anderes hat Inhalt: der Baum bleibt - ohne Wechsel und ohne Balken.
  expect(advance(DEFAULT_PLAYLIST, 0, only("tree"))).toEqual({ index: 0, moments: [] });
  expect(changesAfter(DEFAULT_PLAYLIST, 0, only("tree"))).toBe(false);
  expect(changesAfter(DEFAULT_PLAYLIST, 0, only("tree", "live"))).toBe(true);
});

test("Sponsor und Zahlen kommen auf dem Weg als Moment - nur, wenn sie dran sind", () => {
  expect(advance(DEFAULT_PLAYLIST, 2, all)).toEqual({ index: 0, moments: ["sponsor", "stats"] });
  expect(advance(DEFAULT_PLAYLIST, 2, only("tree", "sponsor"))).toEqual({ index: 0, moments: ["sponsor"] });
  expect(advance(DEFAULT_PLAYLIST, 0, all)).toEqual({ index: 1, moments: [] });
  // Steht nur der Baum zur Wahl, kommt ein fälliger Sponsor trotzdem dazwischen - dann gibt es einen Wechsel.
  expect(changesAfter(DEFAULT_PLAYLIST, 0, only("tree", "sponsor"))).toBe(true);
});

test("„höchstens alle … Minuten“: erst nach der eingestellten Zeit wieder dran", () => {
  const start = 1_000_000;
  expect(isDue(null, 3, start)).toBe(true);
  expect(isDue(start, 3, start + 2 * 60000)).toBe(false);
  expect(isDue(start, 3, start + 3 * 60000)).toBe(true);
  expect(isDue(start, 10, start + 9 * 60000 + 59999)).toBe(false);
});

test("ein Link mit nur einer Folie: genau diese, ohne Wechsel und ohne Balken", () => {
  const callsOnly = [{ slide: "calls", seconds: 8 }];
  expect(firstIndex(callsOnly, all)).toBe(0);
  expect(advance(callsOnly, 0, all)).toEqual({ index: 0, moments: [] });
  expect(changesAfter(callsOnly, 0, all)).toBe(false);
});

test("die Liste beginnt bei der ersten Folie mit Inhalt", () => {
  expect(firstIndex(DEFAULT_PLAYLIST, only("calls"))).toBe(2);
  expect(firstIndex(DEFAULT_PLAYLIST, () => false)).toBe(0);
  expect(firstIndex([{ slide: "sponsor", seconds: 6 }, { slide: "live", seconds: 8 }], () => false)).toBe(1);
});

test("ein Bildschirm nur für Sponsor und Zahlen: dann sind sie gewöhnliche Folien und wechseln sich ab", () => {
  const lowOnly = [{ slide: "sponsor", seconds: 6 }, { slide: "stats", seconds: 8 }];
  expect(onlyMomentSlides(lowOnly)).toBe(true);
  expect(onlyMomentSlides(DEFAULT_PLAYLIST)).toBe(false);
  expect(firstIndex(lowOnly, all)).toBe(0);
  expect(advance(lowOnly, 0, all)).toEqual({ index: 1, moments: [] });
  expect(advance(lowOnly, 1, all)).toEqual({ index: 0, moments: [] });
  // Ohne Zahlen bleibt der Sponsor stehen (er wechselt den Sponsor, nicht die Folie).
  expect(advance(lowOnly, 0, only("sponsor"))).toEqual({ index: 0, moments: [] });
});
