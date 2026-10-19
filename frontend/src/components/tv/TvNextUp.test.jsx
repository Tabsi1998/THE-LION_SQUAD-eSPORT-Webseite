import { render, screen } from "@testing-library/react";
import { TvNextUp } from "./TvNextUp";

// Fußzeile „Als Nächstes“ am Turnierbaum-TV (#1828): Mit Live-Warteschlange nennt sie dieselbe Station und dieselben
// Spieler wie die Stations-Ansicht - auch nach einem Austritt, wenn der alte Plan noch Station 3 und vier Plätze hat.
// Namen sind erfunden.

const slot = (index, registration) => ({ slot: index, registration_id: registration, status: registration ? "filled" : "pending" });

const heatLA = {
  id: "m-la", tournament_id: "t1", match_key: "LA", section: "LOSERS", round: 1, order: 1, round_label: "Loser Runde 1",
  match_type: "ffa", status: "scheduled", station_id: "st3", scheduled_at: "2026-10-31T21:33:00Z",
  // Der alte Stand im Baum: vier Plätze, einer davon ausgetreten.
  slots: [slot(1, "r1"), slot(2, "r2"), slot(3, "r3"), slot(4, "r4")],
};

const stations = [{ id: "st2", name: "2" }, { id: "st3", name: "3" }];
const names = { r1: "NeonFalke", r2: "PixelPanther", r3: "Kometa", r4: "Tiramisu" };

const queue = {
  applies: true,
  stations: [
    { id: "st2", name: "2", status: "free", running: null, waiting: 1,
      next: { match_id: "m-la", match_key: "LA", label: "Loser Runde 1", heat: true, names: ["NeonFalke", "PixelPanther", "Kometa"], open_slots: 0, state: "queued", forecast_at: "2026-10-31T21:40:00Z" } },
    { id: "st3", name: "3", status: "free", running: null, waiting: 1,
      next: { match_id: "m-lb", match_key: "LB", label: "Loser Runde 1", heat: true, names: ["A", "B", "C", "D"], open_slots: 0, state: "queued", forecast_at: "2026-10-31T21:50:00Z" } },
  ],
};

test("ohne Warteschlange: die Prognose aus dem Baum wie bisher", () => {
  render(<TvNextUp matches={[heatLA]} stations={stations} nameOf={(id) => names[id] || ""} />);
  const next = screen.getByTestId("tv-next-up");
  expect(next).toHaveTextContent("Durchgang LA");
  expect(next).toHaveTextContent("Station 3");
});

test("mit Warteschlange: Station und Spielerzahl aus ihr - nach dem Austritt Station 2 mit drei Spielern (#1828)", () => {
  render(<TvNextUp matches={[heatLA]} stations={stations} nameOf={(id) => names[id] || ""} queue={queue} />);
  const next = screen.getByTestId("tv-next-up");
  expect(next).toHaveTextContent("Durchgang LA · Loser Runde 1");
  expect(next).toHaveTextContent("3 Spieler");
  expect(next).toHaveTextContent("Station 2");
  expect(next).not.toHaveTextContent("Station 3");
  expect(next).not.toHaveTextContent("4 Spieler");
});

test("ein aufgerufenes Spiel geht vor - auch wenn ein anderes früher prognostiziert ist", () => {
  const called = {
    ...queue,
    stations: [queue.stations[0], { ...queue.stations[1], next: { ...queue.stations[1].next, state: "called", report_by: "2026-10-31T21:52:00Z" } }],
  };
  render(<TvNextUp matches={[heatLA]} stations={stations} queue={called} />);
  const next = screen.getByTestId("tv-next-up");
  expect(next).toHaveTextContent("Durchgang LB");
  expect(next).toHaveTextContent("Aufgerufen · Station 3");
});

test("Fußzeile: ein Lauf mit nur noch zwei Spielern zeigt die Namen mit „·“, kein „vs.“ (#1824)", () => {
  const two = {
    applies: true,
    stations: [{ id: "st2", name: "2", status: "free", running: null, waiting: 1,
      next: { match_id: "m-la", match_key: "LA", label: "Loser Runde 1", heat: true, names: ["NeonFalke", "PixelPanther"], open_slots: 0, state: "queued", forecast_at: "2026-10-31T21:40:00Z" } }],
  };
  render(<TvNextUp matches={[heatLA]} stations={stations} queue={two} />);
  const next = screen.getByTestId("tv-next-up");
  expect(next).toHaveTextContent("NeonFalke · PixelPanther");
  expect(next).not.toHaveTextContent("vs.");
});
