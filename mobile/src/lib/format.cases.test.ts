import { readFileSync } from "fs";
import path from "path";
import { formatAgo, formatRange, formatWhen } from "./format";

// Ein Datumsformat (#1307): dieselben Fälle wie die Website (docs/date-cases.json, frontend/src/lib/datetime.test.js) -
// Wiener Zeit, Sommerzeit, Mitternacht, Jahreswechsel und Zeiträume über Monatsgrenzen. So schreiben App und Web gleich.

type Row = { note: string; now?: string; expected: string; value?: string; time?: boolean; start?: string; end?: string | null };
const CASES: { now: string; when: Row[]; range: Row[]; ago: Row[] } = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../docs/date-cases.json"), "utf8"),
);
const caseNow = (row: Row) => new Date(row.now || CASES.now);

describe("gemeinsame Datumsfälle (docs/date-cases.json)", () => {
  test.each(CASES.when)("formatWhen: $note", (row) => {
    expect(formatWhen(row.value, { now: caseNow(row), time: row.time !== false })).toBe(row.expected);
  });

  test.each(CASES.range)("formatRange: $note", (row) => {
    expect(formatRange(row.start, row.end, { now: caseNow(row) })).toBe(row.expected);
  });

  test.each(CASES.ago)("formatAgo: $note", (row) => {
    expect(formatAgo(row.value, { now: caseNow(row) })).toBe(row.expected);
  });

  test("ohne gültigen Wert kommt der Platzhalter", () => {
    expect(formatRange(null, null, { fallback: "Termin folgt" })).toBe("Termin folgt");
    expect(formatAgo(undefined)).toBe("");
    expect(formatAgo("kein datum", { fallback: "—" })).toBe("—");
  });
});
