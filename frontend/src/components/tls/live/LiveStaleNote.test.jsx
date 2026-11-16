import { act, render, screen } from "@testing-library/react";
import { LiveStaleNote, STALE_SPOKEN } from "./LiveStaleNote";

// #2440 (Review): Der Bereich für Screenreader steht von Anfang an da, bei einem Ausfall kommt einmal ein fester Satz
// hinein. Die mitzählende Zeile liegt außerhalb - sie wird nicht jede Sekunde vorgelesen.
const T0 = Date.parse("2026-11-14T15:30:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T0));
});
afterEach(() => { vi.useRealTimers(); });

test("Live-Region von Anfang an da; der Satz erscheint einmal und zählt nicht mit", () => {
  const { rerender } = render(<LiveStaleNote since={0} testId="note" />);
  const live = screen.getByTestId("note-live");
  expect(live).toHaveAttribute("role", "status");
  expect(live).toHaveTextContent("");
  expect(screen.queryByTestId("note")).toBeNull();

  vi.setSystemTime(new Date(T0 + 25000));
  rerender(<LiveStaleNote since={T0} testId="note" />);
  expect(screen.getByTestId("note-live")).toBe(live);
  expect(live).toHaveTextContent(STALE_SPOKEN);
  expect(screen.getByTestId("note")).toHaveTextContent("Letzter Stand vor 25 s");
  // Die Zeile zählt, die Live-Region nicht - und die Zeile liegt nicht in ihr.
  act(() => { vi.advanceTimersByTime(5000); });
  expect(screen.getByTestId("note")).toHaveTextContent("Letzter Stand vor 30 s");
  expect(live).toHaveTextContent(STALE_SPOKEN);
  expect(live.textContent).toBe(STALE_SPOKEN);
  expect(live.contains(screen.getByTestId("note"))).toBe(false);

  rerender(<LiveStaleNote since={0} testId="note" />);
  expect(screen.getByTestId("note-live")).toBe(live);
  expect(live).toHaveTextContent("");
  expect(screen.queryByTestId("note")).toBeNull();
});
