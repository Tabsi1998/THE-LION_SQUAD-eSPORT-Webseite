import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react-native";
import { SeasonPassScreen } from "./SeasonPassScreen";

// Ecken-Klammern (#1316, Web: SeasonPage): In der Jahreswertung trägt deine Zeile in Podium bzw. Rangliste Winkel und „Du“;
// „Dein Rang“ oben trägt die Winkel ohne Etikett (die Überschrift sagt es). Fremde Zeilen tragen nichts.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
const mockAuth: { user: { id: string; username: string } | null } = { user: { id: "u-4", username: "noah" } };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../navigation/rootNavigation", () => ({ openTab: jest.fn() }));
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));

const row = (rank: number, name: string) => ({ user_id: `u-${rank}`, username: name.toLowerCase(), display_name: name, rank, total_points: 100 - rank, events_count: 3, wins: 0 });
const STANDINGS = [row(1, "Lena"), row(2, "Mira"), row(3, "Kai"), row(4, "Noah"), row(5, "Ida")];
const navigation = { navigate: jest.fn() } as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.user = { id: "u-4", username: "noah" };
  mockGet.mockImplementation((path: string) => {
    if (path === "/seasons/active/featured") return Promise.resolve({ data: { season: { slug: "2026", name: "Jahreswertung 2026" }, standings: [] } });
    if (path === "/seasons/2026/standings") return Promise.resolve({ data: { standings: STANDINGS } });
    return Promise.reject(new Error(`unerwartet ${path}`));
  });
});

test("deine Zeile in der Rangliste: Winkel und „Du“; „Dein Rang“ mit Winkeln ohne Etikett; sonst nichts", async () => {
  await render(<SeasonPassScreen navigation={navigation} route={{ key: "s", name: "SeasonPass" } as never} />);
  await waitFor(() => expect(screen.getByTestId("season-pass-you-u-4")).toBeTruthy());
  expect(within(screen.getByTestId("season-pass-you-u-4")).getAllByTestId("you-corners")).toHaveLength(1);
  expect(screen.getByTestId("season-pass-you-tag-u-4")).toHaveTextContent("Du");
  expect(screen.getAllByTestId(/^season-pass-you-tag-/)).toHaveLength(1);
  // Zwei Stellen mit Winkeln: „Dein Rang“ und die Zeile in der Rangliste - keine fremde Zeile.
  expect(screen.getAllByTestId("you-corners")).toHaveLength(2);
});

test("ohne eigene Zeile: keine Winkel, kein „Du“", async () => {
  mockAuth.user = { id: "u-99", username: "zoe" };
  await render(<SeasonPassScreen navigation={navigation} route={{ key: "s", name: "SeasonPass" } as never} />);
  await waitFor(() => expect(screen.getByText("Lena")).toBeTruthy());
  expect(screen.queryAllByTestId("you-corners")).toHaveLength(0);
  expect(screen.queryAllByTestId(/^season-pass-you/)).toHaveLength(0);
});
