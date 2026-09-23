import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { EventDetailScreen } from "./EventDetailScreen";

// Kostenpflichtige Events (#396) und Teilnehmer für die Verwaltung (#397): Preis vor dem Absenden,
// Kostenhaken als Pflicht, eigener Betrag; die Liste und der Check-in kommen mit den Rechten vom
// Server (`participant_view`, `can_check_in`), nicht aus der Rolle im Client.

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
jest.mock("../../lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
  },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1", username: "paula" } }) }));
jest.mock("../../live", () => ({ isGuestUser: () => false }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("../../components/AddToCalendarButton", () => ({ AddToCalendarButton: () => null }));
jest.mock("../../components/RichText", () => ({ RichText: () => null }));

const navigate = jest.fn();
const navigation = { navigate, getParent: () => ({ navigate }) } as never;
const route = { key: "e", name: "EventDetail", params: { id: "vereinsabend" } } as never;

const OFFER = {
  enabled: true,
  currency: "EUR",
  positions: [
    { key: "beitrag", label: "Kostenbeitrag", amount_cents: 2000, basis: "per_person", optional: false },
    { key: "shirt", label: "Event-Shirt", amount_cents: 1500, basis: "per_registration", optional: true },
  ],
};

const EVENT = {
  id: "e1",
  slug: "vereinsabend",
  name: "Vereinsabend",
  status: "registration_open",
  public_phase: { state: "registration_open", label: "Anmeldung offen" },
  visibility: "members",
  start_date: "2099-10-05T18:00:00Z",
  has_registration: true,
  allow_companions: true,
  max_companions_per_registration: 2,
  offer: OFFER,
  registration_summary: { registered_count: 1, reserved_seats: 2, companion_count: 1, waitlist_count: 1 },
  own_registration: null,
  registrations: [],
  participant_view: "none",
  can_check_in: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockResolvedValue({ data: {} });
  mockPatch.mockResolvedValue({ data: {} });
});

test("Kosten vor dem Absenden: Zusatz per Haken, Summe live, ohne Kostenhaken kein Absenden", async () => {
  mockGet.mockResolvedValue({ data: EVENT });
  await render(<EventDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("event-offer")).toBeTruthy());

  expect(screen.getByText("20,00 € je Person")).toBeTruthy();
  expect(screen.getByText("Vereinsintern")).toBeTruthy();
  expect(screen.getByText("20,00 €")).toBeTruthy();

  await fireEvent.press(screen.getByTestId("event-offer-option-shirt"));
  expect(screen.getByText("35,00 €")).toBeTruthy();

  await fireEvent.press(screen.getByTestId("event-register-submit"));
  expect(mockPost).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId("event-accept-costs"));
  expect(screen.getByText("Verbindlich anmelden · 35,00 €")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("event-register-submit"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/events/e1/registrations", { companion_count: 0, note: null, selected_positions: ["shirt"] }));
});

test("eigener Betrag an der Anmeldung; die Verwaltung klappt die Teilnehmer aus und checkt ein", async () => {
  mockGet.mockResolvedValue({
    data: {
      ...EVENT,
      own_registration: { id: "r1", status: "registered", seat_count: 2, companion_count: 1, price: { total_cents: 4000, billing_status: "pending" } },
      registrations: [
        { id: "r1", display_name: "Paula B.", status: "registered", companion_count: 1, seat_count: 2, note: "komme später", email: "paula@lionsquad-test.at" },
        { id: "r2", display_name: "Max M.", status: "waitlist", companion_count: 0, seat_count: 1 },
      ],
      participant_view: "staff",
      can_check_in: true,
    },
  });
  await render(<EventDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("event-own-price")).toBeTruthy());

  expect(screen.getByText(/Dein Kostenbeitrag: 40,00 €/)).toBeTruthy();
  expect(screen.getByText(/abmelden und neu anmelden/)).toBeTruthy();
  expect(screen.getByText("Teilnehmer (2)")).toBeTruthy();
  expect(screen.queryByText("Max M.")).toBeNull();

  await fireEvent.press(screen.getByTestId("event-participants-toggle"));
  expect(screen.getByText("Max M.")).toBeTruthy();
  expect(screen.getByText("Hinweis: komme später")).toBeTruthy();
  expect(screen.getByText(/paula@lionsquad-test.at/)).toBeTruthy();
  expect(screen.queryByTestId("event-checkin-r2")).toBeNull();

  await fireEvent.press(screen.getByTestId("event-checkin-r1"));
  await waitFor(() => expect(mockPatch).toHaveBeenCalledWith("/events/e1/registrations/r1", { status: "checked_in" }));
  expect(mockGet).toHaveBeenCalledTimes(2);
});

test("ohne Rechte nur die öffentliche Liste mit Namen - kein Check-in, keine Notizen", async () => {
  mockGet.mockResolvedValue({
    data: {
      ...EVENT,
      offer: null,
      registrations: [{ id: "r1", display_name: "Paula B.", status: "registered", seat_count: 2 }],
      participant_view: "public",
    },
  });
  await render(<EventDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("event-participants")).toBeTruthy());

  expect(screen.getByText("Angemeldet")).toBeTruthy();
  expect(screen.getByText("Paula B.")).toBeTruthy();
  expect(screen.queryByTestId("event-participants-toggle")).toBeNull();
  expect(screen.queryByTestId("event-checkin-r1")).toBeNull();
  expect(screen.queryByTestId("event-offer")).toBeNull();
  expect(screen.getByText("Zum Event anmelden")).toBeTruthy();
});
