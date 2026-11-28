import { PHASE_TONES, phaseTone } from "./phaseTone";

// Phase → Ton (#1869): Rot nur „läuft“, Grün offen, Cyan angekündigt, Violett Pause zwischen zwei Tagen, Grau vorbei.
// Bis #1306 las dieser Test die Farbtabelle aus PhaseBadge.jsx der Website. Seit den Zustands-Schildern (#1306) ist
// PhaseBadge nur noch eine Hülle um StatusChip, die gemeinsame Quelle ist docs/status-kinds.json. Den Abgleich mit
// dieser Datei bringt das App-Paket zu #1306 (die App bekommt dort dieselben zehn Arten). Bis dahin hält die feste
// Tabelle unten den heutigen App-Stand fest.

test("die App kennt alle Phasen", () => {
  expect(Object.keys(PHASE_TONES).length).toBeGreaterThanOrEqual(13);
});

test.each([
  ["live", "danger"],
  ["day_break", "event"],
  ["registration_open", "success"],
  ["registration_pending", "cyan"],
  ["registration_closed", "default"],
  ["check_in", "success"],
  ["announced", "cyan"],
  ["draft", "default"],
  ["paused", "default"],
  ["completed", "default"],
  ["results_published", "default"],
  ["archived", "default"],
  ["cancelled", "default"],
])("Phase %s → %s", (state, tone) => {
  expect(phaseTone(state)).toBe(tone);
});

test("unbekannte Phase wie im Web: wie angekündigt", () => {
  expect(phaseTone("irgendwas")).toBe("cyan");
});
