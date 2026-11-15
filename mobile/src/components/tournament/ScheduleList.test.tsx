import React from "react";
import { render, screen } from "@testing-library/react-native";
import { ScheduleList } from "./ScheduleList";

// Spielplan (#1563) mit der Spielzeit-Uhr (#1167, #2393): ein laufendes Spiel zählt mit seiner wirksamen Dauer - ab
// 100 % überschritten - und steht in der Turnierpause still. Namen erfunden.

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const LIVE = {
  id: "m1", match_key: "A", round: 1, status: "in_progress", started_at: "2026-11-16T12:00:00Z", station_text: "PC 1",
  effective_duration_minutes: 20, paused_at: null, paused_seconds: 0,
  slots: [{ registration_id: "r1" }, { registration_id: "r2" }],
};
const names: Record<string, string> = { r1: "NeonFalke", r2: "Jo" };

afterEach(() => {
  jest.useRealTimers();
});

test("laufendes Spiel: Uhr mit wirksamer Dauer, in der Pause steht sie", async () => {
  jest.useFakeTimers({ now: new Date("2026-11-16T12:21:00Z") });
  const props = { stages: [], format: "single_elimination", nameOf: (id: string) => names[id] || "", mineId: null, onOpen: jest.fn() };
  const { rerender } = await render(<ScheduleList matches={[LIVE] as never} {...props} />);
  expect(screen.getByLabelText("Spielzeit 21:00 von 20 Min., Zeit überschritten")).toBeTruthy();
  await rerender(<ScheduleList matches={[{ ...LIVE, paused_at: "2026-11-16T12:10:00Z" }] as never} {...props} />);
  expect(screen.getByLabelText("Spielzeit 10:00 von 20 Min., angehalten")).toBeTruthy();
});
