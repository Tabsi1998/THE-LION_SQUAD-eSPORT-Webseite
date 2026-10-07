import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { TeamDayCard } from "./TeamDayCard";
import { lineupLabel, presenceLine, starterLabel } from "../../lib/teamDay";

// Team am Spieltag (#1192) in der App: Auswahl mit Zähler, Speichern nur in passender Größe, „Ich bin da“ am
// Turniertag und Anstupsen für den Kapitän. Erfundene Daten.

const mockGet = jest.fn();
const mockPut = jest.fn();
const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    put: (...args: unknown[]) => mockPut(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: jest.fn(),
  },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));

const MEMBERS = [
  { id: "u-cap", display_name: "NeonFalke", role: "captain" },
  { id: "u-co", display_name: "PixelPanther", role: "co_captain" },
  { id: "u-3", display_name: "LunaByte", role: "player" },
];

function view(overrides: Record<string, unknown> = {}) {
  return {
    applicable: true, team_size: 2, substitutes_allowed: true, members: MEMBERS, lineup: [], substitutes: [], lineup_set: false,
    can_edit: true, is_lead: true, editable_until: null,
    presence: { enabled: false, present: {}, counted: ["u-cap", "u-co", "u-3"], count: 0, total: 3, me_present: false, can_mark: false },
    can_nudge: false, nudge_available_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("Sätze wie im Web", () => {
  expect(starterLabel({ role: "captain" })).toBe("Kapitän");
  expect(lineupLabel({ team_size: 3, can_edit: false, lineup_set: true, lineup: ["a", "b", "c"] })).toBe("Die Turnierleitung sieht die Aufstellung beim Check-in. Aufruf und Spiel-Meldungen gehen an diese drei.");
  expect(presenceLine({ count: 4, total: 5 })).toBe("4 von 5 da");
});

test("Auswahl mit Zähler; gespeichert wird nur in passender Größe", async () => {
  mockGet.mockResolvedValue({ data: view() });
  mockPut.mockResolvedValue({ data: view({ lineup: ["u-cap", "u-3"], substitutes: ["u-co"], lineup_set: true }) });
  await render(<TeamDayCard tournamentId="t-1" />);
  await waitFor(() => expect(screen.getByTestId("team-lineup-count")).toHaveTextContent("0 von 2"));
  await fireEvent.press(screen.getByTestId("team-lineup-member-u-cap"));
  await fireEvent.press(screen.getByTestId("team-lineup-save"));
  expect(mockPut).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId("team-lineup-member-u-3"));
  expect(screen.getByTestId("team-lineup-count")).toHaveTextContent("2 von 2");
  await fireEvent.press(screen.getByTestId("team-lineup-save"));
  await waitFor(() => expect(mockPut).toHaveBeenCalledWith("/team-day/t-1/lineup", { lineup: ["u-cap", "u-3"] }));
  await waitFor(() => expect(screen.getByTestId("team-lineup-note")).toHaveTextContent("Die Turnierleitung sieht die Aufstellung beim Check-in. Aufruf und Spiel-Meldungen gehen an diese zwei."));
});

test("am Turniertag: „Ich bin da“ und Anstupsen", async () => {
  const day = (present: Record<string, string>, extra: Record<string, unknown> = {}) => view({
    lineup_set: true, lineup: ["u-cap", "u-3"], can_nudge: true,
    presence: { enabled: true, present, counted: ["u-cap", "u-co", "u-3"], count: Object.keys(present).length, total: 3, me_present: "u-cap" in present, can_mark: true },
    ...extra,
  });
  mockGet.mockResolvedValue({ data: day({}) });
  mockPost.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith("/presence") ? day({ "u-cap": "2026-10-17T08:20:00Z" }) : { ...day({ "u-cap": "2026-10-17T08:20:00Z" }, { nudge_available_at: "2026-10-17T08:31:00Z" }), nudged: 2 } }));
  await render(<TeamDayCard tournamentId="t-1" />);
  await waitFor(() => expect(screen.getByTestId("team-presence-count")).toHaveTextContent("0 von 3 da"));
  await fireEvent.press(screen.getByTestId("team-presence-here"));
  await waitFor(() => expect(screen.getByTestId("team-presence-count")).toHaveTextContent("1 von 3 da"));
  expect(screen.getByTestId("team-presence-u-cap")).toHaveTextContent("NeonFalkeDA · 10:20");
  await fireEvent.press(screen.getByTestId("team-presence-nudge"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/team-day/t-1/nudge"));
  await waitFor(() => expect(screen.getByText("2 angestupst.")).toBeTruthy());
});

test("bei Einzel-Turnieren steht nichts da", async () => {
  mockGet.mockResolvedValue({ data: { applicable: false } });
  await render(<TeamDayCard tournamentId="t-1" />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/team-day/t-1"));
  expect(screen.queryByTestId("team-day")).toBeNull();
});
