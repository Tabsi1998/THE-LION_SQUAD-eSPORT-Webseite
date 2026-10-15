import { act, fireEvent, render, screen } from "@testing-library/react";
import { StationQueueBoard } from "./StationQueueBoard";
import { MatchClock } from "./MatchClock";

// Live vor Ort (#1556): Warteschlange je Station in der Turnierleitung - läuft (mit Spielzeit-Uhr), als Nächstes
// (Aufrufen / Gestartet), danach. Namen sind erfunden.

afterEach(() => vi.useRealTimers());

const entry = (id, extra = {}) => ({
  match_id: id, match_key: id, label: "Viertelfinale", names: ["NeonFalke", "PixelPanther"], open_slots: 0, ready: true,
  state: "queued", position: 1, forecast_at: "2026-10-31T16:40:00Z", planned_at: "2026-10-31T16:30:00Z", delay_minutes: 10,
  duration_minutes: 30, ...extra,
});

function queue(stations, extra = {}) {
  return {
    applies: true, now: "2026-10-31T16:20:00Z", stations,
    summary: { delay_minutes: 11, last: { label: "Finale", forecast_at: "2026-10-31T19:51:00Z" } },
    operate: { all: true, station_ids: [] }, ...extra,
  };
}

test("je Station: läuft mit Uhr, als Nächstes mit „Aufrufen“, danach; oben der Verzug", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T16:20:00Z"));
  const onCall = vi.fn();
  render(<StationQueueBoard
    queue={queue([
      { id: "st1", name: "1", station_text: "Station 1 · Switch 2", status: "busy", waiting: 2,
        running: entry("QF1", { state: "running", position: 0, started_at: "2026-10-31T16:00:00Z" }), next: entry("QF3"), after: entry("SF1", { ready: false, forecast: true, names: [], open_slots: 2 }) },
      { id: "st2", name: "2", station_text: "Station 2 · Switch 2", status: "free", waiting: 1, running: null, next: entry("QF2"), after: null },
    ])}
    onCall={onCall} onStart={vi.fn()}
  />);
  expect(screen.getByTestId("live-summary")).toHaveTextContent("+11 Min. · Finale jetzt ca. 20:51");
  const first = screen.getByTestId("live-station-st1");
  expect(first).toHaveTextContent("Station 1 · Switch 2");
  expect(screen.getByTestId("live-clock-QF1")).toHaveTextContent("20:00");
  expect(screen.getByTestId("live-clock-QF1")).toHaveTextContent("30 Min.");
  expect(first).toHaveTextContent("Danach");
  expect(first).toHaveTextContent("2 Plätze offen");
  // Station 1 spielt noch: das nächste Spiel kommt danach - erst an der freien Station 2 wird aufgerufen.
  expect(screen.queryByTestId("live-call-st1")).toBeNull();
  expect(first).toHaveTextContent("nach dem laufenden Spiel");
  fireEvent.click(screen.getByTestId("live-call-st2"));
  expect(onCall).toHaveBeenCalledWith(expect.objectContaining({ id: "st2" }), expect.objectContaining({ match_id: "QF2" }));
  act(() => { vi.advanceTimersByTime(5000); });
  expect(screen.getByTestId("live-clock-QF1")).toHaveTextContent("20:05");
});

test("aufgerufen: Zeiten zum Antreten und „nicht erschienen“, Knopf „Gestartet“", () => {
  const onStart = vi.fn();
  const called = entry("QF2", { state: "called", called_at: "2026-10-31T16:18:00Z", report_by: "2026-10-31T16:20:00Z", no_show_due_at: "2026-10-31T16:28:00Z" });
  render(<StationQueueBoard queue={queue([{ id: "st2", name: "2", station_text: "Station 2", status: "reserved", waiting: 1, running: null, next: called, after: null }])}
    onCall={vi.fn()} onStart={onStart} />);
  const block = screen.getByTestId("live-next-st2");
  expect(block).toHaveAttribute("data-state", "called");
  expect(block).toHaveTextContent("Aufgerufen 17:18");
  expect(block).toHaveTextContent("antreten bis 17:20");
  expect(block).toHaveTextContent("nicht erschienen ab 17:28");
  fireEvent.click(screen.getByTestId("live-start-st2"));
  expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: "st2" }), expect.objectContaining({ match_id: "QF2" }));
});

test("ohne Stations-Recht keine Knöpfe; Helfer nur an der eigenen Station; Vorspiele offen heißt warten", () => {
  const stations = [
    { id: "st1", name: "1", station_text: "Station 1", status: "free", waiting: 1, running: null, next: entry("QF1") },
    { id: "st2", name: "2", station_text: "Station 2", status: "free", waiting: 1, running: null, next: entry("SF1", { ready: false, forecast: true, names: [], open_slots: 2 }) },
  ];
  const { rerender } = render(<StationQueueBoard queue={queue(stations, { operate: null })} onCall={vi.fn()} onStart={vi.fn()} />);
  expect(screen.queryByTestId("live-call-st1")).toBeNull();
  rerender(<StationQueueBoard queue={queue(stations, { operate: { all: false, station_ids: ["st2"] } })} onCall={vi.fn()} onStart={vi.fn()} />);
  expect(screen.queryByTestId("live-call-st1")).toBeNull();
  expect(screen.queryByTestId("live-call-st2")).toBeNull();
  expect(screen.getByTestId("live-next-st2")).toHaveTextContent("wartet auf die Vorspiele");
});

test("defekte Station und leere Warteschlange sagen es im Klartext", () => {
  render(<StationQueueBoard queue={queue([
    { id: "st1", name: "1", station_text: "Station 1", status: "broken", waiting: 0, running: null, next: null, after: null },
    { id: "st2", name: "2", station_text: "Station 2", status: "free", waiting: 0, running: null, next: null, after: null },
  ])} onCall={vi.fn()} onStart={vi.fn()} />);
  expect(screen.getByTestId("live-station-st1")).toHaveTextContent("Defekt");
  expect(screen.getByTestId("live-station-st2")).toHaveTextContent("Nichts mehr in der Warteschlange");
});

test("Spielzeit-Uhr: Farbe bei 80 % und 100 %, ohne Dauer ohne Balken", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T16:25:00Z"));
  const { rerender } = render(<MatchClock startedAt="2026-10-31T16:00:00Z" durationMinutes={30} testId="clock" />);
  expect(screen.getByTestId("clock")).toHaveAttribute("data-tone", "warn");
  rerender(<MatchClock startedAt="2026-10-31T15:50:00Z" durationMinutes={30} testId="clock" />);
  expect(screen.getByTestId("clock")).toHaveAttribute("data-tone", "over");
  expect(screen.getByTestId("clock")).toHaveTextContent("+5 Min.");
  rerender(<MatchClock startedAt="2026-10-31T16:20:00Z" durationMinutes={null} testId="clock" />);
  expect(screen.getByTestId("clock")).toHaveAttribute("data-tone", "none");
  expect(screen.queryByTestId("clock-bar")).toBeNull();
});
