import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MemberHelperShiftsScreen, shiftWhen } from "./MemberHelperShiftsScreen";

// Helferdienste (#331): Schichten mit Plätzen und Stand; „Ich helfe“ nur nach Rückfrage; Rücknahme direkt.

const mockGet = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), put: (...args: unknown[]) => mockPut(...args), delete: (...args: unknown[]) => mockDelete(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
// Helfer-Aufruf (#1197): den Knopf sieht nur der Vorstand (Bereich „Verein“).
const mockAuth: { user: Record<string, unknown> } = { user: { id: "u-1", username: "paula", areas: [] } };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
const mockPost = jest.fn();

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

test("Helfer-Aufruf (#1197): der Vorstand sendet mit einem Tipp; aus der Meldung steht die Veranstaltung oben", async () => {
  mockAuth.user = { id: "u-board", username: "vorstand", areas: ["club"] };
  const other = { ...event, id: 6, label: "Winterfest" };
  let calls = { available: true, events: [{ id: 5, label: "Sommerfest 2026", open_shifts: [{ id: 51 }], open_places: 2, text: "Es fehlen noch 2 Helfer: Sa 14–16 Uhr Dienst 51.", called_today: false, can_call: true }] };
  mockGet.mockImplementation((path: string) => Promise.resolve({ data: path === "/membership/helper-calls" ? calls : { available: true, events: [other, event], my_count: 0, open_places: 4 } }));
  mockPost.mockImplementation(() => {
    calls = { ...calls, events: [{ ...calls.events[0], called_today: true, can_call: false }] };
    return Promise.resolve({ data: { recipients: 12 } });
  });
  const confirmCall = jest.fn().mockResolvedValue(true);
  const helperRoute = { key: "helfen", name: "MemberHelperShifts", params: { event: 5 } } as never;
  const { HelperCallCard } = jest.requireActual("../../components/HelperCallCard");
  await render(<HelperCallCard confirmCall={confirmCall} />);
  await waitFor(() => expect(screen.getByTestId("helper-call-text-5")).toHaveTextContent("Es fehlen noch 2 Helfer: Sa 14–16 Uhr Dienst 51."));
  await fireEvent.press(screen.getByTestId("helper-call-send-5"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/membership/helper-calls/5"));
  await waitFor(() => expect(screen.getByText("Aufruf gesendet – an 12 Mitglieder.")).toBeTruthy());
  await waitFor(() => expect(screen.getByText("Heute gesendet")).toBeTruthy());
  await screen.unmount();
  await render(<MemberHelperShiftsScreen navigation={navigation} route={helperRoute} />);
  await waitFor(() => expect(screen.getByTestId("helper-call-card")).toBeTruthy());
  const order = screen.getAllByTestId(/^helper-event-\d+$/).map((node) => node.props.testID);
  expect(order).toEqual(["helper-event-5", "helper-event-6"]);
  mockAuth.user = { id: "u-1", username: "paula", areas: [] };
});

test("ohne Vorstandsposten kein Aufruf-Knopf", async () => {
  mockAuth.user = { id: "u-1", username: "paula", areas: [] };
  mockGet.mockResolvedValue({ data: { available: true, events: [event], my_count: 0, open_places: 2 } });
  await render(<MemberHelperShiftsScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("helper-event-5")).toBeTruthy());
  expect(screen.queryByTestId("helper-call-card")).toBeNull();
  expect(mockGet).not.toHaveBeenCalledWith("/membership/helper-calls");
});
