import { TABLE_SLIDE, isTreeless, tableChampionOf, tvTableColumns, tvTableSections, tvWords, withTableSlide } from "./tvTable";
import { championKey } from "./tvChampion";

// Tabelle am Turnierbaum-TV (#2121) - erfundene Namen.

const rows = [
  { registration_id: "r1", display_name: "Nordlicht", rank: 1, played: 3, won: 3, drawn: 0, lost: 0, score_diff: 5, points: 9, form: ["W"] },
  { registration_id: "r2", display_name: "Steinbock", rank: 2, played: 3, won: 1, drawn: 1, lost: 1, score_diff: 0, points: 4 },
  { registration_id: "r3", display_name: "Wolkenfuchs", rank: 3, played: 3, won: 1, drawn: 0, lost: 2, score_diff: -1, points: 3 },
  { registration_id: "r4", display_name: "Kieselkatze", rank: 4, played: 3, won: 0, drawn: 1, lost: 2, score_diff: -4, points: 1 },
];

test("die Folie Tabelle kommt direkt nach dem Spielplan, genauso lang - nur wenn es eine gibt", () => {
  const list = [{ slide: "tree", seconds: 12 }, { slide: "live", seconds: 8 }];
  expect(withTableSlide(list, true)).toEqual([{ slide: "tree", seconds: 12 }, { slide: TABLE_SLIDE, seconds: 12 }, { slide: "live", seconds: 8 }]);
  expect(withTableSlide(list, false)).toBe(list);
  expect(withTableSlide([{ slide: "calls", seconds: 8 }], true)).toEqual([{ slide: "calls", seconds: 8 }]);
});

test("ohne Baum heißt der TV Tabelle und zeigt im QR-Code die Rangliste", () => {
  const table = (match) => match.stage_type === "league";
  expect(isTreeless({ format: "league" }, [{ stage_type: "league" }], table)).toBe(true);
  expect(isTreeless({ format: "groups" }, [{ stage_type: "league" }, { stage_type: "single_elimination" }], table)).toBe(false);
  expect(isTreeless({ format: "swiss" }, [], table)).toBe(true);
  expect(isTreeless({ format: "single_elim" }, [], table)).toBe(false);
  expect(tvWords(true)).toMatchObject({ kicker: "TABELLE", tree: "Spieltage", path: "standings", qr: "QR scannen und Tabelle öffnen" });
  expect(tvWords(false)).toMatchObject({ kicker: "TURNIERBAUM", tree: "Turnierbaum", path: "bracket" });
});

test("Gruppen sind je eine Tabelle; viele nebeneinander ohne S/U/N; die Form fehlt immer", () => {
  const sections = tvTableSections([{ group: { id: "g1", group_key: "a" }, standings: rows.slice(0, 2) }, { group: { id: "g2", group_key: "b" }, standings: [] }]);
  expect(sections.map((section) => section.label)).toEqual(["Gruppe A"]);
  expect(tvTableColumns(rows).map((column) => column.label)).toEqual(["Sp", "S", "U", "N", "Diff", "Pkt"]);
  expect(tvTableColumns(rows, { compact: true }).map((column) => column.label)).toEqual(["Sp", "Diff", "Pkt"]);
  expect(tvTableSections(undefined)).toEqual([]);
});

test("Sieger aus Platz 1 erst nach dem Ende, nie bei Gleichstand und nie bei Gruppen", () => {
  const champion = tableChampionOf(rows, { status: "completed", format: "league" });
  expect(champion).toMatchObject({ winnerId: "r1", path: [], segments: [], fromTable: true, score: 9 });
  expect(champion.podium).toEqual([{ rank: 1, registrationId: "r1" }, { rank: 2, registrationId: "r2" }, { rank: 3, registrationId: "r3" }]);
  expect(championKey(champion)).toBe("table:r1");
  expect(tableChampionOf(rows, { status: "live", format: "league" })).toBeNull();
  expect(tableChampionOf(rows, { status: "completed", format: "groups" })).toBeNull();
  expect(tableChampionOf([{ ...rows[0] }, { ...rows[1], rank: 1 }], { status: "completed", format: "round_robin" })).toBeNull();
  expect(tableChampionOf(rows.map((row) => ({ ...row, rank: 1, played: 0 })), { status: "completed", format: "swiss" })).toBeNull();
});
