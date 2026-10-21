import { getStationLabel } from "./BracketCards";

// Turnierbaum (#1941, F5): die Station im Klartext wie überall sonst - „Station 5 · Switch 2“, nie das Gerätekürzel
// („Station 5 - switch2“) und nie eine interne Kennung.

test("der fertige Text vom Server gilt", () => {
  expect(getStationLabel({ station_label: "Station 5 - switch2", station_name: "Station 5", station_text: "Station 5 · Switch 2" })).toBe("Station 5 · Switch 2");
});

test("ältere Antworten ohne fertigen Text: aus Name und Gerät gebaut", () => {
  expect(getStationLabel({ station_label: "Station 5 - switch2" })).toBe("Station 5 · Switch 2");
  expect(getStationLabel({ station_label: "B - pc" })).toBe("Station B · PC");
  expect(getStationLabel({ station_name: "Beamer-Ecke" })).toBe("Beamer-Ecke");
});

test("unbekannte Station oder keine: leer statt Kennung", () => {
  expect(getStationLabel({ station_id: "f3c2a9", station_label: "f3c2a9", station_text: "" })).toBe("");
  expect(getStationLabel({})).toBe("");
  expect(getStationLabel(null)).toBe("");
});
