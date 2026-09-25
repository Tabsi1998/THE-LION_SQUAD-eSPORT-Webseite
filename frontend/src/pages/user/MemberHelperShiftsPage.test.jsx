import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Helferdienste (#331): Schichten mit Plätzen und eigenem Stand; „Ich helfe“ nach Rückfrage, Rücknahme nur
// unbestätigt; ohne Weg zur Akte der Grund.

const apiMock = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
let confirmAnswer = true;
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "") }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => confirmAnswer }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: MemberHelperShiftsPage, shiftWhen } = await import("./MemberHelperShiftsPage");

const EVENT = {
  id: 5, label: "Sommerfest 2026", day: "2026-10-10", end_day: "", timezone: "Europe/Vienna", place: "Vereinsheim", status: "planned", status_label: "geplant",
  visibility: "members", visibility_label: "nur für Mitglieder", registration: { kind: "dolibarr", external_ref: "", text: "Anmeldung beim Verein" },
  shifts: [
    { id: 51, label: "Aufbau", day: "2026-10-10", start: "14:00", end: "16:00", capacity: 2, taken: 0, free: 2, full: false, mine: "", mine_label: "", can_request: true, can_withdraw: false },
    { id: 52, label: "Bar", day: "2026-10-10", start: "15:00", end: "20:00", capacity: 1, taken: 1, free: 0, full: true, mine: "", mine_label: "", can_request: false, can_withdraw: false },
    { id: 53, label: "Abbau", day: "2026-10-10", start: "21:00", end: "23:00", capacity: 3, taken: 1, free: 2, full: false, mine: "requested", mine_label: "angefragt – der Vorstand bestätigt", can_request: false, can_withdraw: true },
  ],
  upcoming: true, mine: [], open_places: 4,
};
const VIEW = { available: true, reason: null, text: "", events: [EVENT], my_count: 1, open_places: 4 };

beforeEach(() => {
  vi.clearAllMocks();
  confirmAnswer = true;
  apiMock.get.mockResolvedValue({ data: VIEW });
  apiMock.put.mockResolvedValue({ data: EVENT });
  apiMock.delete.mockResolvedValue({ data: EVENT });
});

test("Schichten mit Plätzen und Stand; „Ich helfe“ nach Rückfrage, Rücknahme direkt", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><MemberHelperShiftsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("helper-event-5")).toBeInTheDocument());
  expect(shiftWhen(EVENT.shifts[0])).toBe("10.10.2026 · 14:00–16:00 Uhr");
  expect(screen.getByTestId("helper-event-5-registration")).toHaveTextContent("Anmeldung beim Verein");
  expect(screen.getByTestId("helper-event-5-open")).toHaveTextContent("4 freie Plätze");
  expect(screen.getByTestId("helper-shifts-mine")).toHaveTextContent("einem Dienst");
  expect(screen.getByTestId("shift-52-places")).toHaveTextContent("1/1 · voll");
  expect(screen.queryByTestId("shift-52-request")).toBeNull();
  expect(screen.getByTestId("shift-53-mine")).toHaveTextContent("angefragt");

  confirmAnswer = false;
  await user.click(screen.getByTestId("shift-51-request"));
  expect(apiMock.put).not.toHaveBeenCalled();
  confirmAnswer = true;
  await user.click(screen.getByTestId("shift-51-request"));
  expect(apiMock.put).toHaveBeenCalledWith("/membership/me/events/5/shifts/51");

  await user.click(screen.getByTestId("shift-53-withdraw"));
  expect(apiMock.delete).toHaveBeenCalledWith("/membership/me/events/5/shifts/53");
});

test("ohne Weg zur Akte steht der Grund", async () => {
  apiMock.get.mockResolvedValue({ data: { available: false, reason: "not_bound", text: "Dafür muss dein Konto verbunden sein.", events: [] } });
  render(<MemoryRouter><MemberHelperShiftsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("helper-shifts-unavailable")).toHaveTextContent("verbunden sein"));
  expect(screen.getByText("Zu Meine Mitgliedschaft")).toBeInTheDocument();
});
