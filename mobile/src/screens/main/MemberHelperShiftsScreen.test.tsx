import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MemberHelperShiftsScreen, shiftWhen } from "./MemberHelperShiftsScreen";

// Helferdienste (#331): Schichten mit Plätzen und Stand; „Ich helfe“ nur nach Rückfrage; Rücknahme direkt.

const mockGet = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), put: (...args: unknown[]) => mockPut(...args), delete: (...args: unknown[]) => mockDelete(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigation = { navigate: jest.fn() } as never;
const route = { key: "helfen", name: "MemberHelperShifts" } as never;

const shift = (id: number, extra: Record<string, unknown> = {}) => ({
  id, label: `Dienst ${id}`, day: "2026-10-10", start: "14:00", end: "16:00", capacity: 2, taken: 0, free: 2, full: false, mine: "", mine_label: "",
  can_request: true, can_withdraw: false, ...extra,
});
const event = {
  id: 5, label: "Sommerfest 2026", day: "2026-10-10", end_day: "", timezone: "Europe/Vienna", place: "Vereinsheim", status: "planned", status_label: "geplant",
  visibility: "members", visibility_label: "nur für Mitglieder", registration: { kind: "dolibarr", external_ref: "", text: "Anmeldung beim Verein" },
  shifts: [shift(51), shift(53, { mine: "requested", mine_label: "angefragt – der Vorstand bestätigt", can_request: false, can_withdraw: true })],
  upcoming: true, mine: [], open_places: 2,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: { available: true, events: [event], my_count: 1, open_places: 2 } });
  mockPut.mockResolvedValue({ data: event });
  mockDelete.mockResolvedValue({ data: event });
});

test("Schichten mit Stand; Anfrage nach Rückfrage, abgelehnt schickt nichts; Rücknahme direkt", async () => {
  const no = jest.fn(async (_title: string, _message: string) => false);
  const { rerender } = await render(<MemberHelperShiftsScreen navigation={navigation} route={route} confirmShift={no} />);
  await waitFor(() => expect(screen.getByTestId("helper-event-5")).toBeTruthy());
  expect(shiftWhen(shift(51))).toContain("14:00–16:00 Uhr");
  expect(screen.getByTestId("shift-53-mine")).toBeTruthy();
  expect(screen.getByText(/einem Dienst/)).toBeTruthy();

  await fireEvent.press(screen.getByTestId("shift-51-request"));
  await waitFor(() => expect(no).toHaveBeenCalled());
  expect(mockPut).not.toHaveBeenCalled();

  const yes = jest.fn(async (_title: string, _message: string) => true);
  await rerender(<MemberHelperShiftsScreen navigation={navigation} route={route} confirmShift={yes} />);
  await fireEvent.press(screen.getByTestId("shift-51-request"));
  await waitFor(() => expect(mockPut).toHaveBeenCalledWith("/membership/me/events/5/shifts/51"));

  await fireEvent.press(screen.getByTestId("shift-53-withdraw"));
  await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("/membership/me/events/5/shifts/53"));
});

test("ohne Weg zur Akte steht der Grund", async () => {
  mockGet.mockResolvedValue({ data: { available: false, reason: "not_bound", text: "Dafür muss dein Konto verbunden sein.", events: [] } });
  await render(<MemberHelperShiftsScreen navigation={navigation} route={route} confirmShift={async () => true} />);
  await waitFor(() => expect(screen.getByTestId("helper-shifts-unavailable")).toBeTruthy());
  expect(screen.getByText(/verbunden sein/)).toBeTruthy();
});
