import { describe, expect, it } from "vitest";
import { auditLines, parsePath } from "./bracketLineAudit.mjs";

// Die Prüfung der Linien (#1591) - dieselbe Regel in Vitest (gerechnete Fälle) und Playwright (echtes Layout).
const box = (left, top, width = 100, height = 60) => ({ left, top, right: left + width, bottom: top + height, width, height });

describe("bracketLineAudit", () => {
  const cards = [box(0, 0), box(200, 0)];

  it("liest einen Pfad aus M/L", () => {
    expect(parsePath("M0 10 L50 10 L50 30")).toEqual([{ x: 0, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 30 }]);
  });

  it("eine Linie von Karte zu Karte ist in Ordnung", () => {
    const lines = [{ id: "a", points: [{ x: 100, y: 30 }, { x: 150, y: 30 }, { x: 150, y: 30 }, { x: 200, y: 30 }] }];
    expect(auditLines({ lines, boxes: cards, bounds: { w: 400, h: 200 } })).toEqual([]);
  });

  it("meldet ein Ende im Leeren", () => {
    const lines = [{ id: "a", points: [{ x: 100, y: 30 }, { x: 150, y: 30 }, { x: 150, y: 120 }] }];
    expect(auditLines({ lines, boxes: cards, bounds: { w: 400, h: 200 } })).toEqual([expect.stringContaining("a: Ende im Leeren")]);
  });

  it("ein Ende an einem Marker oder auf einer anderen Linie ist angeschlossen", () => {
    const lines = [
      { id: "spine", points: [{ x: 150, y: 10 }, { x: 150, y: 30 }] },
      { id: "in", points: [{ x: 100, y: 30 }, { x: 150, y: 30 }] },
      { id: "out", points: [{ x: 150, y: 20 }, { x: 200, y: 20 }] },
      { id: "stub", points: [{ x: 136, y: 10 }, { x: 150, y: 10 }] },
    ];
    expect(auditLines({ lines, boxes: cards, markers: [{ x: 136, y: 10 }], bounds: { w: 400, h: 200 } })).toEqual([]);
  });

  it("meldet überlagerte Strecken zweier Linien", () => {
    const lines = [
      { id: "a", points: [{ x: 100, y: 30 }, { x: 200, y: 30 }] },
      { id: "b", points: [{ x: 100, y: 30 }, { x: 160, y: 30 }, { x: 160, y: 50 }, { x: 200, y: 50 }] },
    ];
    expect(auditLines({ lines, boxes: cards, bounds: { w: 400, h: 200 } })).toContainEqual(expect.stringContaining("überlagert"));
  });

  it("meldet dicht gedrängte senkrechte Linien", () => {
    const lines = [
      { id: "a", points: [{ x: 100, y: 10 }, { x: 140, y: 10 }, { x: 140, y: 50 }, { x: 200, y: 50 }] },
      { id: "b", points: [{ x: 100, y: 12 }, { x: 143, y: 12 }, { x: 143, y: 55 }, { x: 200, y: 55 }] },
    ];
    expect(auditLines({ lines, boxes: cards, bounds: { w: 400, h: 200 } })).toContainEqual(expect.stringContaining("gedrängt"));
  });

  it("meldet Linien außerhalb der Leinwand und durch Karten", () => {
    const outside = [{ id: "a", points: [{ x: 0, y: 30 }, { x: -10, y: 30 }, { x: -10, y: 0 }, { x: 0, y: 0 }] }];
    expect(auditLines({ lines: outside, boxes: cards, bounds: { w: 400, h: 200 } })).toContainEqual(expect.stringContaining("außerhalb"));
    const through = [{ id: "b", points: [{ x: 100, y: 30 }, { x: 320, y: 30 }] }];
    expect(auditLines({ lines: through, boxes: [...cards, box(300, 0)], bounds: { w: 500, h: 200 } })).toContainEqual(expect.stringContaining("durch eine Karte"));
  });

  it("zählt Schienen je Gruppe", () => {
    const lines = [
      { id: "s1", spine: "x/WB:2", points: [{ x: 150, y: 10 }, { x: 150, y: 50 }] },
      { id: "s2", spine: "x/WB:2", points: [{ x: 170, y: 10 }, { x: 170, y: 50 }] },
    ];
    expect(auditLines({ lines, boxes: cards, bounds: { w: 400, h: 200 }, endpoints: false })).toContainEqual(expect.stringContaining("Schienen"));
  });
});
