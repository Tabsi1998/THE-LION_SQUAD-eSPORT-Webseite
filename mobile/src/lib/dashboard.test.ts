import { isStillRelevant, splitOpenAndPast } from "./dashboard";
import { isLiveOrToday, seasonLine, splitHomeTimeline, type HomeItem } from "./dashboard";

// Die Startseite zeigte Halloween am 15. September unter "Heute und Live" und
// gleich darunter noch einmal unter "Meine nächsten Termine" (#212).

const now = new Date(2026, 8, 15, 18, 0); // 15.09.2026, 18:00 Ortszeit
const item = (overrides: Partial<HomeItem>): HomeItem => ({ id: "x", kind: "event", title: "Termin", ...overrides });

// Der Events-Tab zeigte Beendetes und Abgesagtes zwischen dem, was ansteht (#241).
describe("Offen und vergangen", () => {
  test("beendet, abgesagt oder gestern ist vergangen; heute und später ist offen", () => {
    expect(isStillRelevant({ status: "registration_open", date: "2026-10-31T18:00:00Z" }, now)).toBe(true);
    expect(isStillRelevant({ status: "scheduled", date: "2026-09-15T09:00:00" }, now)).toBe(true);
    expect(isStillRelevant({ status: "cancelled", date: "2026-09-12T18:00:00Z" }, now)).toBe(false);
    expect(isStillRelevant({ status: "completed", date: "2026-10-31T18:00:00Z" }, now)).toBe(false);
    expect(isStillRelevant({ status: "scheduled", date: "2026-09-14T23:00:00" }, now)).toBe(false);
    expect(isStillRelevant({ status: "scheduled", date: "2026-09-10T09:00:00", endDate: "2026-09-16T09:00:00" }, now)).toBe(true);
    expect(isStillRelevant({ status: "scheduled" }, now)).toBe(true);
  });

  test("Vergangenes steht getrennt und neueste zuerst", () => {
    const { open, past } = splitOpenAndPast([
      { id: "a", status: "completed", date: "2026-05-23" },
      { id: "b", status: "registration_open", date: "2026-10-31" },
      { id: "c", status: "cancelled", date: "2026-09-12" },
    ], now);
    expect(open.map((row) => row.id)).toEqual(["b"]);
    expect(past.map((row) => row.id)).toEqual(["c", "a"]);
  });
});

describe("Heute und Live", () => {
  test("eine offene Anmeldung in sechs Wochen ist nicht live", () => {
    expect(isLiveOrToday(item({ date: "2026-10-31T18:00:00Z", status: "registration_open", phaseState: "registration_open", phaseLabel: "Anmeldung offen" }), now)).toBe(false);
  });

  test("live, Check-in oder heute zählen", () => {
    expect(isLiveOrToday(item({ date: "2026-10-31T18:00:00Z", phaseState: "live" }), now)).toBe(true);
    expect(isLiveOrToday(item({ date: "2026-10-31T18:00:00Z", phaseState: "check_in" }), now)).toBe(true);
    expect(isLiveOrToday(item({ date: "2026-10-31T18:00:00Z", status: "in_progress" }), now)).toBe(true);
    expect(isLiveOrToday(item({ date: new Date(2026, 8, 15, 20, 0).toISOString(), status: "registration_open" }), now)).toBe(true);
  });

  test("ohne Datum und ohne Status nicht live", () => {
    expect(isLiveOrToday(item({}), now)).toBe(false);
  });
});

describe("Aufteilen der Termine", () => {
  const halloween = item({ id: "h", title: "Halloween", date: "2026-10-31T18:00:00Z", phaseState: "registration_open" });
  const tonight = item({ id: "t", kind: "tournament", title: "Heute-Cup", date: new Date(2026, 8, 15, 20, 0).toISOString() });
  const xmas = item({ id: "x", title: "Weihnachtsfeier", date: "2026-11-28T15:00:00Z" });

  test("jeder Termin steht nur in einer Liste", () => {
    const { live, next, moreCount } = splitHomeTimeline([tonight, halloween, xmas], now);
    expect(live.map((row) => row.id)).toEqual(["t"]);
    expect(next.map((row) => row.id)).toEqual(["h", "x"]);
    expect(moreCount).toBe(0);
  });

  test("die Liste bleibt kurz, der Rest wird gezählt", () => {
    const many = Array.from({ length: 7 }, (_, index) => item({ id: `n${index}`, date: `2026-11-0${index + 1}T10:00:00Z` }));
    const { next, moreCount } = splitHomeTimeline(many, now, { nextLimit: 4 });
    expect(next).toHaveLength(4);
    expect(moreCount).toBe(3);
  });
});

describe("Zeile zur Jahreswertung", () => {
  test("eigene Platzierung, sonst die Spitze", () => {
    expect(seasonLine({ my_rank: 4, my_points: 120, participant_count: 13 })).toBe("Du: Platz 4 von 13 · 120 Punkte");
    expect(seasonLine({ my_rank: 1, my_points: 1, participant_count: 2 })).toBe("Du: Platz 1 von 2 · 1 Punkt");
    expect(seasonLine({ my_rank: null, leader: { display_name: "bob", points: 200 } })).toBe("Vorn: bob · 200 Punkte");
    expect(seasonLine({ my_rank: null, leader: null })).toBe("Noch keine Punkte vergeben.");
    expect(seasonLine(null)).toBe("");
  });
});
