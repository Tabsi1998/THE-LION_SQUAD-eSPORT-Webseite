import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { MonthCalendar } from "./MonthCalendar";

// Monatsansicht (#1271, #1190): „Heute“-Knopf, Mehrtägiges als Balken über die Tage statt Punkten, Vereinstermine grün.

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const LAN = { id: "lan", kind: "event" as const, title: "Herbst-LAN", start: "2026-12-17T10:00:00+01:00", end: "2026-12-19T22:00:00+01:00" };
const MEETING = { id: "meeting-7", kind: "club" as const, title: "Generalversammlung", start: "2026-12-05T18:00:00+01:00", end: "2026-12-05T20:00:00+01:00", path: "/members/meetings?meeting=7" };

test("eine dreitägige LAN ist ein Balken, die Versammlung ein grüner Punkt, „Heute“ springt zurück", async () => {
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
  expect(StyleSheet.flatten(screen.getByTestId("calendar-dot-2026-12-05-club").props.style).backgroundColor).toBe("#10B981");

  await fireEvent.press(screen.getByTestId("calendar-today"));
  expect(onToday).toHaveBeenCalledTimes(1);
});
