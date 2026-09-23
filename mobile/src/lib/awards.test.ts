import { awardDay, awardLines, awardTone, sortAwards, type Award } from "./awards";

// Auszeichnungen (#230): dieselben Zeilen und Farben wie im Web, Trophäen zuerst.

const cup: Award = { id: "a1", kind: "trophy", rank: 1, rank_label: "1. Platz", participants: 12, record: "4 Siege · 0 Niederlagen", tournament: { id: "t1", title: "Herbst-Cup" }, game: { name: "FIFA 26" }, season: { name: "Saison 2026" }, date: "2026-10-02T17:00:00+02:00" };
const part: Award = { id: "a2", kind: "banner", rank: null, rank_label: "Teilnahme", participants: 8, tournament: { id: "t2", title: "Sommer-Cup" }, date: "2026-11-05T10:00:00+01:00" };
const bronze: Award = { id: "a3", kind: "trophy", rank: 3, rank_label: "3. Platz", tournament: { id: "t3", title: "Winter-Cup" }, date: "2026-01-05T10:00:00+01:00" };

test("Zeilen zum Turnier - nur der Tag, keine Uhrzeit", () => {
  expect(awardLines(cup)).toEqual(["FIFA 26", "2.10.2026", "12 Teilnehmer", "Saison 2026"]);
  expect(awardLines(part)).toEqual(["5.11.2026", "8 Teilnehmer"]);
  expect(awardDay("kaputt")).toBe("");
  expect(awardLines(null)).toEqual([]);
});

test("Gold, Silber, Bronze - sonst Vereinsblau ohne Beschriftung", () => {
  expect(awardTone(cup)).toEqual({ color: "#FFD700", label: "Gold" });
  expect(awardTone({ rank: 2 }).label).toBe("Silber");
  expect(awardTone(bronze).label).toBe("Bronze");
  expect(awardTone(part)).toEqual({ color: "#29B6E8", label: "" });
});

test("Trophäen zuerst, dann das Neueste", () => {
  expect(sortAwards([part, bronze, cup]).map((a) => a.id)).toEqual(["a1", "a3", "a2"]);
  expect(sortAwards(undefined)).toEqual([]);
});
