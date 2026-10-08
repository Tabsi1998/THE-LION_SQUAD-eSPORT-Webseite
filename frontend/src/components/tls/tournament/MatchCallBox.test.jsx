import { act, render, screen } from "@testing-library/react";
import { MatchCallBox } from "./MatchCallBox";

// Aufruf (#1137): Station reserviert - die Matchseite zeigt, wohin es geht und wie lange noch, wie die Tafel am TV.

afterEach(() => vi.useRealTimers());

test("Station, „antreten bis“ und der Countdown, der weiterzählt - bei 0 „Jetzt geht es los“", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T12:30:00Z"));
  render(<MatchCallBox call={{ called_at: "2026-10-10T12:29:00Z", report_by: "2026-10-10T12:31:30Z", station_text: "Station 3 · Switch 2" }} />);
  expect(screen.getByTestId("match-call-station")).toHaveTextContent("Bitte jetzt zu Station 3 · Switch 2");
  expect(screen.getByTestId("match-call")).toHaveTextContent("Antreten bis 14:31");
  expect(screen.getByTestId("match-call-countdown")).toHaveTextContent("noch1:30");
  act(() => { vi.advanceTimersByTime(30000); });
  expect(screen.getByTestId("match-call-countdown")).toHaveTextContent("noch1:00");
  act(() => { vi.advanceTimersByTime(61000); });
  expect(screen.getByTestId("match-call-countdown")).toHaveTextContent("Jetzt geht es los");
});

test("ohne Aufruf nichts", () => {
  const { container } = render(<MatchCallBox call={null} />);
  expect(container).toBeEmptyDOMElement();
});
