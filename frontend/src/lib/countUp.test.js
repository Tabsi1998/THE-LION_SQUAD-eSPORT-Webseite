import { COUNT_UP_MS, COUNT_UP_STAGGER_MS, countFrame, countShape, countStart, easeOutCubic, formatShape } from "./countUp";
import { MICRO } from "./motion";

// Hochzählen (#1950): Zeiten, Abstände und Zahlen laufen in der Form ihres Endwerts hoch, Wörter stehen sofort.

describe("countShape", () => {
  it("liest Zeiten, Abstände und Zahlen - mit Komma oder Punkt", () => {
    expect(countShape("31:55,056")).toMatchObject({ sign: "", separator: ",", widths: [2, 2], fraction: 3, total: 1915056 });
    expect(countShape("+1:34.878")).toMatchObject({ sign: "+", separator: ".", widths: [1, 2], total: 94878 });
    expect(countShape("1:32:45.123")).toMatchObject({ widths: [1, 2, 2], total: 5565123 });
    expect(countShape("+0,261")).toMatchObject({ sign: "+", widths: [1], total: 261 });
    expect(countShape("35")).toMatchObject({ separator: "", fraction: 0, total: 35 });
    expect(countShape("95,5")).toMatchObject({ total: 955 });
  });

  it("zählt Wörter, leere Werte und Null nicht", () => {
    for (const text of ["+2 Runden", "Ausfall", "DNF", "–", "", null, undefined, "0", "+0,000", "1:2", "12 s", "1,2,3"]) {
      expect(countShape(text)).toBeNull();
    }
  });
});

describe("countFrame", () => {
  it("behält Stellen und Trennzeichen, damit die Spalte ruhig bleibt", () => {
    const shape = countShape("31:55,056");
    expect(countFrame(shape, 0)).toBe("00:00,000");
    expect(countFrame(shape, 1)).toBe("31:55,056");
    const middle = countFrame(shape, 0.5);
    expect(middle).toMatch(/^\d\d:\d\d,\d\d\d$/);
    expect(middle.length).toBe("31:55,056".length);
    expect(countFrame(countShape("+6,197"), 0)).toBe("+0,000");
    expect(countFrame(countShape("1:32:45.123"), 0)).toBe("0:00:00.000");
  });

  it("läuft schnell an und weich aus", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });

  it("rechnet Minuten und Stunden richtig über", () => {
    const shape = countShape("1:00:00.000");
    expect(formatShape(shape, 3599999)).toBe("0:59:59.999");
    expect(formatShape(countShape("2:00.000"), 61005)).toBe("1:01.005");
  });

  it("dauert etwa 0,9 s und versetzt je Zeile um 25 ms - aus den Bewegungs-Werten (#1969)", () => {
    expect(COUNT_UP_MS).toBe(900);
    expect(COUNT_UP_STAGGER_MS).toBe(25);
    expect(COUNT_UP_MS).toBe(MICRO.count);
    expect(COUNT_UP_STAGGER_MS).toBe(MICRO.countStagger);
  });
});

describe("eine Art zu zählen für alles (#1969)", () => {
  it("Zahlen als Wert zählen in ganzen Schritten und mit eigener Schreibweise", () => {
    const shape = countShape(1234, (value) => value.toLocaleString("de-DE"));
    expect(shape).toMatchObject({ numeric: true, total: 1234, text: "1.234" });
    expect(countFrame(shape, 0)).toBe("0");
    expect(countFrame(shape, 1)).toBe("1.234");
    expect(countFrame(countShape(35), 0.5)).toBe(String(Math.round(35 * easeOutCubic(0.5))));
    expect(countShape(0)).toBeNull();
    expect(countShape(Number.NaN)).toBeNull();
  });

  it("vom alten Wert aus: eine neue Bestzeit läuft von der alten zur neuen, auch abwärts", () => {
    const shape = countShape("1:23.412");
    const start = countStart(shape, "1:23.824");
    expect(start).toBe(83824);
    expect(countFrame(shape, 0, start)).toBe("1:23.824");
    expect(countFrame(shape, 1, start)).toBe("1:23.412");
    // Andere Stellenzahl hinter dem Komma wird umgerechnet, Unlesbares heißt null.
    expect(countStart(countShape("1:23,41"), "1:23.824")).toBe(8382);
    expect(countStart(shape, "DNF")).toBe(0);
    expect(countStart(countShape(40), 35)).toBe(35);
    expect(countStart(shape, undefined)).toBe(0);
  });
});
