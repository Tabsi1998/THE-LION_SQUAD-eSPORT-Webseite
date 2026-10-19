import { render, screen } from "@testing-library/react";
import { StationNowNext } from "./StationNowNext";

// Spielplan „Nach Stationen“ (#1824): wie die Stationen der Turnierleitung - Duell „A gegen B“, Lauf mit Namen.
// Namen sind erfunden.

const entry = (extra) => ({ match_id: "m1", match_key: "D", label: "Runde 1", names: [], open_slots: 0, state: "queued", forecast_at: "2026-10-31T16:40:00Z", ...extra });

test("Lauf mit nur noch zwei Spielern: Namen mit „·“, kein „gegen“", () => {
  render(<StationNowNext stationKey="st1" station={{ running: null, next: entry({ heat: true, names: ["NeonFalke", "PixelPanther"] }) }} />);
  const box = screen.getByTestId("schedule-now-st1");
  expect(box).toHaveTextContent("NeonFalke · PixelPanther");
  expect(box).not.toHaveTextContent("gegen");
});

test("Duell unverändert „A gegen B“, Lauf mit vier Namen", () => {
  render(<StationNowNext stationKey="st1" station={{
    running: entry({ match_id: "m0", match_key: "QF1", label: "Viertelfinale", heat: false, names: ["NeonFalke", "PixelPanther"], started_at: "2026-10-31T16:00:00Z" }),
    next: entry({ heat: true, names: ["A1", "A2", "A3", "A4"] }),
  }} />);
  const box = screen.getByTestId("schedule-now-st1");
  expect(box).toHaveTextContent("NeonFalke gegen PixelPanther");
  expect(box).toHaveTextContent("A1 · A2 · A3 · A4");
});
