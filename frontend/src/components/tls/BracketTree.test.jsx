import { describe, expect, it } from "vitest";

import { isTableFormat } from "./BracketTree";

describe("isTableFormat", () => {
  it("erkennt Formate, die über Spieltage laufen", () => {
    // Liga, Gruppen und Schweizer System spielen alle gleichzeitig an einem
    // Spieltag - nebeneinander scrollende Runden wären dafür die falsche Form.
    for (const stage_type of ["league", "round_robin_groups", "swiss"]) {
      expect(isTableFormat([{ stage_type }])).toBe(true);
    }
  });

  it("erkennt K.-o.-Bäume, die von links nach rechts fließen", () => {
    for (const stage_type of ["single_elimination", "double_elimination", "custom_bracket", "simple"]) {
      expect(isTableFormat([{ stage_type }])).toBe(false);
    }
  });

  it("fällt auf den Abschnittsnamen zurück, wenn der Typ fehlt", () => {
    expect(isTableFormat([{ section: "group_A" }])).toBe(true);
    expect(isTableFormat([{ section: "LIGA" }])).toBe(true);
    expect(isTableFormat([{ section: "round_robin" }])).toBe(true);
    expect(isTableFormat([{ section: "swiss" }])).toBe(true);
    expect(isTableFormat([{ section: "WB" }])).toBe(false);
    expect(isTableFormat([{ section: "GF" }])).toBe(false);
  });

  it("zieht den Typ dem Abschnittsnamen vor", () => {
    expect(isTableFormat([{ stage_type: "single_elimination", section: "group_A" }])).toBe(false);
  });

  it("kommt mit leeren Angaben zurecht", () => {
    expect(isTableFormat([])).toBe(false);
    expect(isTableFormat()).toBe(false);
    expect(isTableFormat([{}])).toBe(false);
  });
});
