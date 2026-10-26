import { describe, expect, it } from "vitest";

import { pickSeparatorChar } from "@/lib/pasteSeparator";
import { parseResultPaste, parseSeasonTablePaste, parseTablePaste } from "@/lib/resultPaste";

const lines = (text) => text.split("\n").filter(Boolean).map((line) => ({ text: line }));

describe("pickSeparatorChar (#2024)", () => {
  it("nimmt das Zeichen, das in den meisten Zeilen steht", () => {
    expect(pickSeparatorChar(lines("1;Team A;7;18\n2;ABS|x (ABS|);7;0\n3;Team C;7;3"))).toBe(";");
    expect(pickSeparatorChar(lines("1\tABS|x\t7\n2\tTeam B\t5"))).toBe("\t");
    expect(pickSeparatorChar(lines("| 1 | Team A | 18 |\n| 2 | Team B | 15 |"))).toBe("|");
  });

  it("ein einzelnes „|“ im Namen macht aus Leerzeichen-Spalten keine Tabelle", () => {
    expect(pickSeparatorChar(lines("1. Team A 7 6 0 1 18\n2. ABS|x 7 0 0 7 0\n3. Team C 7 1 0 6 3"))).toBeNull();
  });

  it("bei Gleichstand gewinnt das gleichmäßige Zeichen, dann Tab vor „|“ vor „;“", () => {
    expect(pickSeparatorChar(lines("a;b|c|d\ne;f|g;h"))).toBe("|");
    expect(pickSeparatorChar(lines("a|b;c\nd|e;f"))).toBe("|");
    expect(pickSeparatorChar(lines("eine Zeile ohne Trenner"))).toBeNull();
  });
});

describe("Einfügen mit „|“ im Teamnamen (#2024)", () => {
  it("Tabelle laut Veranstalter mit „;“ bleibt in Spalten", () => {
    const result = parseTablePaste("1;Noctara Vipers (NoC);7;6;0;1;178:102;18\n8;ABS|x (ABS|);7;0;0;7;91:189;0");
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => [row.rank, row.team, row.won, row.points])).toEqual([
      [1, "Noctara Vipers (NoC)", 6, 18], [8, "ABS|x (ABS|)", 0, 0]]);
  });

  it("Ergebnisliste mit „;“ behält das „|“ im Namen", () => {
    const result = parseResultPaste("1;Max|Racing;25\n2;Anna;18\n3;Ben;15");
    expect(result.rows.map((row) => row.name)).toEqual(["Max|Racing", "Anna", "Ben"]);
  });

  it("Saisontabelle mit Tab behält das „|“ im Namen", () => {
    const result = parseSeasonTablePaste("Platz\tFahrer\tR1\tGesamt\n1\tMax|Racing\t25\t25\n2\tAnna\t18\t18");
    expect(result.rows.map((row) => row.cells?.[1] ?? row.name)).toContain("Max|Racing");
  });
});
