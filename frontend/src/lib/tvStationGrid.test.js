// Stationen auf der Hallen-Tafel (#1126): frei, belegt, aufgerufen, defekt - reserviert zählt nicht als belegt; 6, 12 und
// 24 Stationen: alle sichtbar oder geblättert, keine fehlt still.
import { pageOf, sortStations, stationCounts, stationGrid, stationState } from "./tvStationGrid";

const LEVELS = [{ key: "large", minW: 30, h: 15 }, { key: "small", minW: 24, h: 11 }];
const AREA = { w: 100, h: 50 };

test("der Stand einer Station - reserviert heißt aufgerufen, nicht belegt", () => {
  expect(stationState({ status: "broken" })).toBe("broken");
  expect(stationState({ status: "busy" })).toBe("busy");
  expect(stationState({ status: "reserved" })).toBe("called");
  expect(stationState({ status: "free" })).toBe("free");
  expect(stationState({ status: "available" })).toBe("free");
  // Läuft das Spiel an der Station schon, ist sie belegt - auch wenn die Station es noch nicht weiß.
  expect(stationState({ status: "reserved" }, { status: "running" })).toBe("busy");
  expect(stationCounts(["busy", "busy", "called", "free", "broken"]).text).toBe("1 frei · 2 belegt · 1 aufgerufen · 1 defekt");
  expect(stationCounts(["free"]).text).toBe("1 frei");
});

test("6 und 12 Stationen passen ganz - so wenige Spalten wie möglich", () => {
  expect(stationGrid(6, AREA, LEVELS)).toMatchObject({ level: "large", columns: 2, rows: 3, pages: 1 });
  expect(stationGrid(6, { w: 100, h: 34 }, LEVELS)).toMatchObject({ level: "large", columns: 3, rows: 2, pages: 1 });
  expect(stationGrid(12, AREA, LEVELS)).toMatchObject({ level: "small", pages: 1 });
  const twelve = stationGrid(12, AREA, LEVELS);
  expect(twelve.columns * twelve.rows).toBeGreaterThanOrEqual(12);
});

test("24 Stationen: das Raster blättert - jede Station steht auf einer Seite", () => {
  const layout = stationGrid(24, AREA, LEVELS);
  expect(layout.pages).toBeGreaterThan(1);
  const stations = Array.from({ length: 24 }, (_, index) => ({ id: `s${index + 1}`, name: `PC ${index + 1}` }));
  const seen = new Set();
  for (let page = 0; page < layout.pages; page += 1) pageOf(stations, layout, page).forEach((station) => seen.add(station.id));
  expect(seen.size).toBe(24);
  expect(pageOf(stations, layout, layout.pages).map((station) => station.id)).toEqual(pageOf(stations, layout, 0).map((station) => station.id));
});

test("Stationen nach Namen, Zahlen richtig sortiert", () => {
  expect(sortStations([{ name: "PC 10" }, { name: "PC 2" }, { name: "Switch 1" }, { name: "PC 1" }]).map((station) => station.name)).toEqual(["PC 1", "PC 2", "PC 10", "Switch 1"]);
});
