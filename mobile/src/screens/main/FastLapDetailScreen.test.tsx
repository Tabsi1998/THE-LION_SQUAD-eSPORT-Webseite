import React from "react";
import { Alert } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { FastLapDetailScreen } from "./FastLapDetailScreen";
import { expectLateAnswerDiscarded } from "./lateAnswer.testkit";

// Nach dem Ende (#1221): an einer beendeten Fast-Lap-Challenge gibt es keinen Kalender-Knopf mehr - solange sie läuft
// oder kommt, bleibt er. Die Daten sind erfunden.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("../../components/AddToCalendarButton", () => ({
  AddToCalendarButton: ({ item }: { item?: unknown }) => {
    const { createElement } = jest.requireActual("react");
    const { Text } = jest.requireActual("react-native");
    return item ? createElement(Text, { testID: "add-to-calendar" }, "In meinen Kalender") : null;
  },
}));

const route = { params: { id: "hotlap" } };
const CHALLENGE = {
  id: "c1", slug: "hotlap", title: "Spielberg Hotlap", status: "active", start_date: "2099-06-01T10:00:00Z", end_date: "2099-06-30T20:00:00Z",
  tracks: [{ id: "tr1", name: "Spielberg" }], participant_count: 0, allow_club_reference_times: false,
};

function answer(challenge: Record<string, unknown>) {
  mockGet.mockImplementation((path: string) => {
    if (path === "/f1/challenges/hotlap") return Promise.resolve({ data: challenge });
    if (path.endsWith("/leaderboard")) return Promise.resolve({ data: { entries: [], track: { id: "tr1", name: "Spielberg" } } });
    return Promise.resolve({ data: [] });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockResolvedValue({ data: { id: "lap-1" } });
});

test("Kalender-Knopf an einer kommenden Challenge, nicht an einer beendeten", async () => {
  answer(CHALLENGE);
  const view = await render(<FastLapDetailScreen route={route} />);
  await waitFor(() => expect(screen.getByTestId("add-to-calendar")).toBeTruthy());
  await view.unmount();

  answer({ ...CHALLENGE, status: "completed", start_date: "2026-05-01T10:00:00Z", end_date: "2026-05-31T20:00:00Z" });
  await render(<FastLapDetailScreen route={route} />);
  await waitFor(() => expect(screen.getByText("Spielberg Hotlap")).toBeTruthy());
  expect(screen.queryByTestId("add-to-calendar")).toBeNull();
});

test("eine verspätete Antwort für die vorige Challenge wird verworfen (#1000)", async () => {
  answer(CHALLENGE);
  await expectLateAnswerDiscarded({
    mockGet,
    renderFor: (id) => <FastLapDetailScreen route={{ params: { id } }} />,
    newId: "hotlap",
    oldPrefix: "/f1/challenges/alt",
    oldAnswer: () => ({ ...CHALLENGE, id: "c0", slug: "alt", title: "Alte Challenge" }),
    newText: "Spielberg Hotlap",
    oldText: "Alte Challenge",
  });
});

// Fahrer über die Personensuche (#1584): Name tippen, Treffer aus /admin/people/search - die ganze Kontoliste
// (assignable-users) lädt die App nicht mehr. Ein Parser für die Zeit (wie Website und Server), Rückfrage bei
// unplausibler Zeit, nach der Veröffentlichung keine Eingabe mehr in der App.
const SEARCH_HIT = { id: "u-7", name: "Max Fahrer", context: "Community" };

function managed(extra: Record<string, unknown> = {}, search: () => Promise<unknown> = () => Promise.resolve({ data: [SEARCH_HIT] })) {
  mockGet.mockImplementation((path: string) => {
    if (path === "/f1/challenges/hotlap") return Promise.resolve({ data: { ...CHALLENGE, can_manage_times: true, ...extra } });
    if (path.endsWith("/leaderboard")) return Promise.resolve({ data: { entries: [], track: { id: "tr1", name: "Spielberg" } } });
    if (path === "/admin/people/search") return search();
    return Promise.resolve({ data: [] });
  });
}

async function chooseDriver() {
  await waitFor(() => expect(screen.getByTestId("fastlap-driver-search")).toBeTruthy());
  await fireEvent.changeText(screen.getByTestId("fastlap-driver-search"), "max");
  await waitFor(() => expect(screen.getByText("Max Fahrer")).toBeTruthy());
  await fireEvent.press(screen.getByText("Max Fahrer"));
}

test("Fahrer über die Personensuche: gesucht wird mit Zweck und Challenge, die Kontoliste wird nie geladen", async () => {
  managed();
  await render(<FastLapDetailScreen route={route} />);
  await chooseDriver();
  const searchCall = mockGet.mock.calls.find(([path]) => path === "/admin/people/search");
  expect(searchCall?.[1]).toEqual({ params: { purpose: "fastlap", context_id: "c1", q: "max" } });
  expect(mockGet.mock.calls.map(([path]) => path).some((path) => String(path).includes("assignable-users"))).toBe(false);
});

test("Suche geht nicht: die Challenge steht, die Karte sagt es statt einer leeren Liste", async () => {
  managed({}, () => Promise.reject(Object.assign(new Error("Network Error"), { isAxiosError: true })));
  await render(<FastLapDetailScreen route={route} />);
  await waitFor(() => expect(screen.getByTestId("fastlap-driver-search")).toBeTruthy());
  await fireEvent.changeText(screen.getByTestId("fastlap-driver-search"), "max");
  await waitFor(() => expect(screen.getByTestId("fastlap-users-partial")).toBeTruthy());
  expect(screen.getByText("Spielberg Hotlap")).toBeTruthy();
});

test("„90“ sind 90 Sekunden, nicht 90 Millisekunden; Komma geht auch", async () => {
  managed();
  await render(<FastLapDetailScreen route={route} />);
  await chooseDriver();
  await fireEvent.changeText(screen.getByTestId("fastlap-time-input"), "90");
  await fireEvent.press(screen.getByText("Zeit speichern"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/f1/challenges/c1/times", expect.objectContaining({ user_id: "u-7", time_ms: 90000 })));
  await fireEvent.changeText(screen.getByTestId("fastlap-time-input"), "1:24,587");
  await fireEvent.press(screen.getByText("Zeit speichern"));
  await waitFor(() => expect(mockPost).toHaveBeenLastCalledWith("/f1/challenges/c1/times", expect.objectContaining({ time_ms: 84587 })));
});

test("unplausible Zeit: erst die Rückfrage, gespeichert wird nur mit Bestätigung", async () => {
  managed();
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  await render(<FastLapDetailScreen route={route} />);
  await chooseDriver();
  await fireEvent.changeText(screen.getByTestId("fastlap-time-input"), "12");
  await fireEvent.press(screen.getByText("Zeit speichern"));
  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(String(alert.mock.calls[0][1])).toContain("0:12.000");
  expect(mockPost).not.toHaveBeenCalled();
  const buttons = (alert.mock.calls[0][2] || []) as Array<{ text?: string; onPress?: () => void }>;
  await act(async () => { buttons.find((button) => button.text === "Trotzdem speichern")?.onPress?.(); });
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/f1/challenges/c1/times", expect.objectContaining({ time_ms: 12000, confirm_implausible: true })));
  alert.mockRestore();
});

test("nach der Veröffentlichung keine Eingabe in der App - ein Satz sagt, wo es weitergeht", async () => {
  managed({ status: "results_published" });
  await render(<FastLapDetailScreen route={route} />);
  await waitFor(() => expect(screen.getByTestId("fastlap-locked")).toBeTruthy());
  expect(screen.queryByTestId("fastlap-driver-search")).toBeNull();
});
