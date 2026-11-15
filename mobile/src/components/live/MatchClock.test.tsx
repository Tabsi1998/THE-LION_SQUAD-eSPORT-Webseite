import React from "react";
import { act, render, screen } from "@testing-library/react-native";
import { InlineMatchClock, MatchClock } from "./MatchClock";

// Spielzeit-Uhr in der App (#1167, #2393): Zeit gegen Dauer mit Balken, knapp ab 80 % (orange), überschritten ab 100 %
// (orange gefüllt mit Warn-Symbol), ohne Dauer nur die Zeit, in der Pause steht sie - gezählt nach der Serverzeit.

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const START = "2026-10-31T16:00:00Z";
const at = (minutes: number, seconds = 0) => new Date(Date.parse(START) + minutes * 60000 + seconds * 1000);

afterEach(() => {
  jest.useRealTimers();
});

test("läuft ruhig: Zeit, Dauer und Balken - jede Sekunde weiter", async () => {
  jest.useFakeTimers({ now: at(10) });
  await render(<MatchClock startedAt={START} durationMinutes={20} testID="clock" />);
  expect(screen.getByTestId("clock-time")).toHaveTextContent("10:00");
  expect(screen.getByTestId("clock")).toHaveTextContent(/\/ 20 Min\./);
  expect(screen.getByLabelText("Spielzeit 10:00 von 20 Min.")).toBeTruthy();
  expect(screen.getByTestId("clock-bar")).toHaveStyle({ transform: [{ scaleX: 0.5 }] });
  expect(screen.queryByTestId("clock-warn")).toBeNull();
  await act(async () => { jest.advanceTimersByTime(3000); });
  expect(screen.getByTestId("clock-time")).toHaveTextContent("10:03");
});

test("ab 80 % knapp, ab 100 % überschritten mit Warn-Symbol und „+N Min.“", async () => {
  jest.useFakeTimers({ now: at(16) });
  const view = await render(<MatchClock startedAt={START} durationMinutes={20} testID="clock" />);
  expect(screen.getByLabelText("Spielzeit 16:00 von 20 Min., knapp")).toBeTruthy();
  expect(screen.queryByTestId("clock-warn")).toBeNull();
  await act(async () => { jest.setSystemTime(at(22, 5)); jest.advanceTimersByTime(1000); });
  expect(screen.getByLabelText(/Zeit überschritten/)).toBeTruthy();
  expect(screen.getByTestId("clock-warn")).toBeTruthy();
  expect(screen.getByTestId("clock")).toHaveTextContent(/\+2 Min\./);
  expect(screen.getByTestId("clock-bar")).toHaveStyle({ transform: [{ scaleX: 1 }] });
  view.unmount();
});

test("ohne Dauer nur die laufende Zeit, über eine Stunde mit Stunden", async () => {
  jest.useFakeTimers({ now: at(65, 12) });
  await render(<MatchClock startedAt={START} durationMinutes={null} testID="clock" />);
  expect(screen.getByTestId("clock-time")).toHaveTextContent("1:05:12");
  expect(screen.queryByTestId("clock-bar")).toBeNull();
  expect(screen.getByLabelText("Spielzeit 1:05:12")).toBeTruthy();
});

test("Turnierpause: die Uhr steht und sagt „Pause“", async () => {
  jest.useFakeTimers({ now: at(40) });
  await render(<MatchClock startedAt={START} durationMinutes={20} pausedAt={at(12, 30).toISOString()} testID="clock" />);
  expect(screen.getByTestId("clock-time")).toHaveTextContent("12:30");
  expect(screen.getByTestId("clock-paused")).toHaveTextContent("PAUSE");
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(screen.getByTestId("clock-time")).toHaveTextContent("12:30");
  expect(screen.getByLabelText("Spielzeit 12:30 von 20 Min., angehalten")).toBeTruthy();
});

test("Serverzeit: ein Handy, das 7 Minuten nachgeht, zeigt mit dem Abstand dieselbe Zeit", async () => {
  jest.useFakeTimers({ now: at(9) });
  await render(<MatchClock startedAt={START} durationMinutes={20} offset={7 * 60000} testID="clock" />);
  expect(screen.getByTestId("clock-time")).toHaveTextContent("16:00");
  expect(screen.getByLabelText(/knapp/)).toBeTruthy();
});

test("ohne Start keine Uhr; die Zeile im Baum färbt sich erst ab 80 %", async () => {
  jest.useFakeTimers({ now: at(21) });
  const { rerender } = await render(<MatchClock startedAt={null} durationMinutes={20} testID="clock" />);
  expect(screen.queryByTestId("clock")).toBeNull();
  await rerender(<InlineMatchClock startedAt={START} durationMinutes={20} style={{ color: "#FF3B30", fontSize: 11 }} testID="inline" />);
  expect(screen.getByTestId("inline")).toHaveTextContent(/21:00/);
  expect(screen.getByLabelText("Spielzeit 21:00 von 20 Min., Zeit überschritten")).toBeTruthy();
});
