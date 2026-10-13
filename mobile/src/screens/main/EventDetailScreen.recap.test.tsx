import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { EventDetailScreen } from "./EventDetailScreen";

// Rückblick (#1187) und Freunde (#1188) im Event-Screen: vor dem Ende Anmeldung und „Was läuft“ wie bisher, ohne
// Rückblick; nach dem letzten Tag (Wiener Tag) der Rückblick, Anmeldung und „Was läuft“ fallen weg.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn(), patch: jest.fn() },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-lena", username: "lena" } }) }));
jest.mock("../../live", () => ({ isGuestUser: () => false }));
jest.mock("../../navigation/rootNavigation", () => ({ openSignIn: jest.fn() }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("../../components/AddToCalendarButton", () => ({ AddToCalendarButton: () => null }));
jest.mock("../../components/RichText", () => ({ RichText: () => null }));

const navigate = jest.fn();
const navigation = { navigate, getParent: () => ({ navigate }), setOptions: jest.fn() } as never;
const route = { key: "e", name: "EventDetail", params: { id: "sommer-lan" } } as never;

const EVENT = {
  id: "e1", slug: "sommer-lan", name: "Sommer-LAN", status: "scheduled", visibility: "public", has_registration: true,
  start_date: "2026-10-10T08:00:00Z", end_date: "2026-10-10T20:00:00Z", registrations: [], participant_view: "none",
  own_registration: { id: "r1", status: "checked_in", seat_count: 1, companion_count: 0 },
  tournaments: [{ id: "t1", slug: "mk", title: "Mario Kart Cup", team_mode: "solo", status: "results_published", start_date: "2026-10-10T10:00:00Z" }],
};
const RECAP = {
  available: true, fastlaps: [], report: null,
  winners: [{ kind: "tournament", id: "t1", slug: "mk", title: "Mario Kart Cup", team: false, podium: [{ rank: 1, name: "Lena", detail: "2 Siege" }] }],
  numbers: { participants: 8, matches: 7, tournaments: 1, fastlaps: 0, photos: 0 },
  mine: { was_there: true, results: [{ kind: "tournament", id: "t1", slug: "mk", title: "Mario Kart Cup", rank: 3, of: 8, team_name: null }] },
};
const FRIENDS = { friends: [{ id: "u-finn", display_name: "Finn", avatar_url: null, username: null, where: [{ kind: "event" }] }], sharing: true, hint: false };

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockImplementation(async (url: string) => {
    if (url === "/events/sommer-lan") return { data: EVENT };
    if (url === "/events/sommer-lan/recap") return { data: RECAP };
    if (url === "/events/sommer-lan/friends") return { data: FRIENDS };
    throw new Error(url);
  });
});
afterEach(() => jest.useRealTimers());

test("am letzten Tag (23:30 in Wien): kein Rückblick, Anmeldung und „Was läuft“ stehen, Freunde „sind dabei“", async () => {
  jest.useFakeTimers({ now: new Date("2026-10-10T21:30:00Z"), doNotFake: ["setTimeout", "setInterval", "setImmediate", "nextTick", "queueMicrotask"] });
  await render(<EventDetailScreen navigation={navigation} route={route} />);
  expect(await screen.findByTestId("event-whatson")).toBeTruthy();
  expect(screen.getByTestId("event-own-seats")).toBeTruthy();
  expect(screen.queryByTestId("event-recap")).toBeNull();
  expect(mockGet).not.toHaveBeenCalledWith("/events/sommer-lan/recap");
  expect(await screen.findByTestId("event-friends")).toHaveTextContent(/Von deinen Freunden dabei/);
});

test("am Tag danach: Rückblick mit „Du warst dabei“, ohne Anmeldung und „Was läuft“", async () => {
  jest.useFakeTimers({ now: new Date("2026-10-10T22:05:00Z"), doNotFake: ["setTimeout", "setInterval", "setImmediate", "nextTick", "queueMicrotask"] });
  await render(<EventDetailScreen navigation={navigation} route={route} />);
  expect(await screen.findByTestId("event-recap")).toBeTruthy();
  expect(screen.getByTestId("event-recap-mine")).toHaveTextContent(/Platz 3 von 8/);
  await waitFor(() => expect(screen.getByTestId("event-friends")).toHaveTextContent(/Deine Freunde waren dabei/));
  expect(screen.queryByTestId("event-whatson")).toBeNull();
  expect(screen.queryByTestId("event-own-seats")).toBeNull();
  expect(screen.queryByTestId("event-register-submit")).toBeNull();
});
