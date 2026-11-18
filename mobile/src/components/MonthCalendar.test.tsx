import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { MonthCalendar } from "./MonthCalendar";

// Monatsansicht (#1271, #1190): „Heute“-Knopf, Mehrtägiges als Balken über die Tage statt Punkten, Vereinstermine gold (#1305).

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const LAN = { id: "lan", kind: "event" as const, title: "Herbst-LAN", start: "2026-12-17T10:00:00+01:00", end: "2026-12-19T22:00:00+01:00" };
const MEETING = { id: "meeting-7", kind: "club" as const, title: "Generalversammlung", start: "2026-12-05T18:00:00+01:00", end: "2026-12-05T20:00:00+01:00", path: "/members/meetings?meeting=7" };

test("eine dreitägige LAN ist ein Balken, die Versammlung ein goldener Punkt, „Heute“ springt zurück", async () => {
  const onToday = jest.fn();
  await render(
    <MonthCalendar year={2026} month={11} items={[LAN, MEETING]} selected={null} onSelect={jest.fn()} onShift={jest.fn()} onToday={onToday} today={new Date("2026-12-02T10:00:00Z")} />,
  );
  const bars = screen.getAllByTestId("calendar-bar-event-lan");
  expect(bars).toHaveLength(1);
  // Do 17. bis Sa 19.: Spalten 3 bis 5 von 7.
  expect(StyleSheet.flatten(bars[0].props.style)).toMatchObject({ left: `${(3 / 7) * 100}%`, width: `${(3 / 7) * 100}%` });
  expect(screen.getByText("Herbst-LAN")).toBeTruthy();
  expect(screen.queryByTestId("calendar-dot-2026-12-18-event")).toBeNull();
  expect(StyleSheet.flatten(screen.getByTestId("calendar-dot-2026-12-05-club").props.style).backgroundColor).toBe("#FFD700");

  await fireEvent.press(screen.getByTestId("calendar-today"));
  expect(onToday).toHaveBeenCalledTimes(1);
});

// Ecken-Klammern (#1316, Web: CalendarPage): Tage mit eigener Anmeldung tragen Winkel an der Kante und die leichte Fläche,
// andere Tage nichts; der Vorleser sagt „angemeldet“. Die Legende zeigt das kleine Ecken-Zeichen statt des goldenen Rings.
test("Kalender: Ecken nur an deinen Tagen, Legende mit dem Ecken-Zeichen", async () => {
  const CUP = { id: "cup", kind: "tournament" as const, title: "Lions Cup", start: "2026-12-12T15:00:00+01:00", mine: true };
  const OPEN = { id: "open", kind: "tournament" as const, title: "Open Cup", start: "2026-12-13T15:00:00+01:00" };
  await render(<MonthCalendar year={2026} month={11} items={[CUP, OPEN]} selected={null} onSelect={jest.fn()} onShift={jest.fn()} today={new Date("2026-12-02T10:00:00Z")} />);
  expect(screen.getByTestId("calendar-you-2026-12-12")).toHaveStyle({ top: -0, left: -0 });
  expect(screen.queryByTestId("calendar-you-2026-12-13")).toBeNull();
  expect(screen.getAllByTestId(/^calendar-you-2026/)).toHaveLength(1);
  expect(screen.getByTestId("calendar-day-2026-12-12").props.accessibilityLabel).toMatch(/, angemeldet$/);
  expect(screen.getByTestId("calendar-day-2026-12-13").props.accessibilityLabel).not.toMatch(/angemeldet/);
  // Kein goldener Rahmen mehr um deinen Tag - das Zeichen für „du“ sind die Ecken.
  expect(StyleSheet.flatten(screen.getByTestId("calendar-day-2026-12-12").props.style).borderColor).toBe("transparent");
  expect(screen.getByTestId("calendar-legend-you")).toBeTruthy();
});
