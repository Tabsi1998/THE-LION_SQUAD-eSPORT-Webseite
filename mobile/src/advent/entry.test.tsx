import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { AdventHint, calendarEntry, hintText } from "./entry";

// Der Weg zum Adventkalender in der App (#641, #642): dieselben Sätze wie im Web, und der Hinweis erscheint nur,
// wenn der Kalender läuft, Türchen angelegt sind und die Person die Deko nicht abgeschaltet hat.

const mockSeasonState: { byKey: Record<string, unknown> } = { byKey: {} };
jest.mock("../seasons/SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

function season(data: Record<string, unknown>, effective = "normal") {
  return { key: "advent_calendar", label: "Adventkalender", phase: "advent", intensity: "normal", effective, channels: ["app"], texts: {}, starts_at: "", ends_at: "", forced: false, data };
}

afterEach(() => {
  mockSeasonState.byKey = {};
});

test("was das Türchen zeigt und sagt - wie im Web", () => {
  expect(calendarEntry(season({ ready: true, today_door: 12, door_hour: 6 }))).toEqual({ door: 12, label: "Adventkalender – Türchen 12 ist offen", waiting: false, catchUp: false });
  expect(calendarEntry(season({ ready: true, today_door: 0, door_hour: 6 }))).toEqual({ door: 1, label: "Adventkalender – das erste Türchen öffnet sich um 6 Uhr", waiting: true, catchUp: false, hour: 6 });
  expect(calendarEntry(season({ ready: true, today_door: 24, catch_up: true }))).toEqual({ door: 24, label: "Adventkalender – alle Türchen sind offen, nachholen bis 6. Jänner", waiting: false, catchUp: true });
  expect(calendarEntry(season({ ready: true, today_door: 99 }))?.door).toBe(24);
  expect(calendarEntry(season({ ready: true, today_door: "7" }))?.door).toBe(7);
});

test("ohne angelegte Türchen kein Einstieg", () => {
  expect(calendarEntry(season({ ready: false, today_door: 5 }))).toBeNull();
  expect(calendarEntry(season({ today_door: 5 }))).toBeNull();
  expect(calendarEntry(null)).toBeNull();
  expect(calendarEntry(undefined)).toBeNull();
});

test("der Satz im Dashboard", () => {
  expect(hintText(calendarEntry(season({ ready: true, today_door: 12 })))).toBe("Türchen 12 ist offen – schau hinein.");
  expect(hintText(calendarEntry(season({ ready: true, today_door: 0, door_hour: 6 })))).toBe("Das erste Türchen geht heute um 6 Uhr auf.");
  expect(hintText(calendarEntry(season({ ready: true, catch_up: true })))).toBe("Alle 24 Türchen sind offen – nachholen kannst du bis 6. Jänner.");
  expect(hintText(null)).toBe("");
});

test("läuft der Kalender, steht der Weg dorthin da", async () => {
  mockSeasonState.byKey = { advent_calendar: season({ ready: true, today_door: 12, door_hour: 6 }) };
  const onOpen = jest.fn();
  await render(<AdventHint onOpen={onOpen} />);
  expect(screen.getByText("Türchen 12 ist offen – schau hinein.")).toBeTruthy();
  expect(screen.getByLabelText("Adventkalender: Türchen 12 ist offen – schau hinein.")).toBeTruthy();
  expect(screen.getByTestId("advent-glyph")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("advent-hint"));
  expect(onOpen).toHaveBeenCalledTimes(1);
});

test("kein Hinweis ohne Kalender, ohne Türchen oder wenn die Person die Deko abgeschaltet hat", async () => {
  const cases: Array<Record<string, unknown>> = [
    {},
    { advent: season({ ready: true, today_door: 3 }) },
    { advent_calendar: season({ ready: false, today_door: 3 }) },
    { advent_calendar: season({ ready: true, today_door: 3 }, "off") },
  ];
  for (const byKey of cases) {
    mockSeasonState.byKey = byKey;
    const view = await render(<AdventHint onOpen={jest.fn()} />);
    expect(screen.queryByTestId("advent-hint")).toBeNull();
    await view.unmount();
  }
});

test("dezent: der Hinweis bleibt, nur die Deko wird ruhiger", async () => {
  mockSeasonState.byKey = { advent_calendar: season({ ready: true, today_door: 0, door_hour: 6 }, "subtle") };
  await render(<AdventHint onOpen={jest.fn()} />);
  expect(screen.getByText("Das erste Türchen geht heute um 6 Uhr auf.")).toBeTruthy();
});
