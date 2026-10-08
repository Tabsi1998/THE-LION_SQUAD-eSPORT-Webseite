import fs from "fs";
import path from "path";
import { REPORT_STATE_TEXT, duelResults, fieldNumber, heatResults, rankingMode, type RankingMode } from "./matchReport";

// Ergebnis melden (#1132): dieselben Fälle wie auf der Website - beide lesen frontend/src/lib/matchReport.cases.json.
// Ändert jemand die Rechnung auf einer Seite, wird der Test der anderen rot.
type Case = { name: string; input: Record<string, any>; results?: unknown; error?: string };
const CASES: { duel: Case[]; heat: Case[] } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../frontend/src/lib/matchReport.cases.json"), "utf8"),
);

test.each(CASES.duel)("Duell: $name", ({ input, results, error }) => {
  const outcome = duelResults(input as Parameters<typeof duelResults>[0]);
  expect(outcome).toEqual(error ? { error } : { results });
});

test.each(CASES.heat)("Durchgang: $name", ({ input, results, error }) => {
  const outcome = heatResults(input.rows, input.mode as RankingMode);
  expect(outcome).toEqual(error ? { error } : { results });
});

test("Zahlen aus dem Feld und die Wertung wie im Web", () => {
  expect(fieldNumber("")).toBeNull();
  expect(fieldNumber("1,5")).toBe(1.5);
  expect(fieldNumber("-2")).toBeUndefined();
  expect(rankingMode({ settings: { calculation: "fastest-lap" } })).toBe("time");
  expect(rankingMode({ settings: { score_type: "strokes" } })).toBe("lower_score");
  expect(rankingMode(null)).toBe("higher_score");
  expect(REPORT_STATE_TEXT.waiting).toBe("Deine Meldung ist da – wartet auf die Gegenseite.");
});
