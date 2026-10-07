import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SearchScreen, groupSearchItems } from "./SearchScreen";
import { TabHeader } from "../../components/TabHeader";
import { addRecentSearch, loadRecentSearches } from "../../lib/recentSearches";

// Die Lupe (#1145): dieselbe Suche wie im Web (`/api/search`, ab zwei Buchstaben, Treffer nach Art gruppiert), ein Treffer
// öffnet im aktuellen Tab, die letzten fünf Suchen merkt sich das Gerät. Und die Kopfzeile, die jeder Tab trägt.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("../../seasons/SeasonStage", () => ({ SeasonBackdropSlot: () => null }));
const mockOpenTarget = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({
  ...jest.requireActual("../../navigation/rootNavigation"),
  openTarget: (...args: unknown[]) => mockOpenTarget(...args),
  openDetail: jest.fn(),
}));
const mockUser: { value: unknown } = { value: { id: "u-1", username: "neonfalke" } };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: mockUser.value }) }));
jest.mock("../../live", () => ({ isGuestUser: (user: unknown) => !user }));
const mockUnread = { value: 3 };
jest.mock("../../notifications/NotificationContext", () => ({ useOptionalNotifications: () => ({ unread: mockUnread.value, load: jest.fn() }) }));

const navigate = jest.fn();
const goBack = jest.fn();
const navigation = { navigate, goBack } as never;
const route = { key: "search", name: "Search" } as never;

const ITEMS = [
  { kind: "tournament", title: "Rocket League 2v2", url: "/tournaments/rl-2v2", subtitle: "Herbst-LAN" },
  { kind: "team", title: "Lions Rocket", url: "/teams/t-rocket", subtitle: "5 Mitglieder" },
  { kind: "tournament", title: "Rocket League Liga", url: "/tournaments/rl-liga" },
  { kind: "player", title: "RockRaupe", url: "/u/rockraupe" },
];

async function type(text: string) {
  await fireEvent.changeText(screen.getByTestId("search-input"), text);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260));
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockUser.value = { id: "u-1", username: "neonfalke" };
  mockUnread.value = 3;
  mockGet.mockResolvedValue({ data: { items: ITEMS } });
  const SecureStore = jest.requireMock("expo-secure-store");
  await SecureStore.deleteItemAsync("tls.recent-searches");
});

test("unter zwei Buchstaben: keine Anfrage, nur der Hinweis", async () => {
  await render(<SearchScreen navigation={navigation} route={route} />);
  await type("r");
  expect(mockGet).not.toHaveBeenCalled();
  expect(screen.getByTestId("search-hint")).toBeTruthy();
});

test("ab zwei Buchstaben dieselbe Anfrage wie im Web, Treffer nach Art gruppiert; ein Treffer öffnet im aktuellen Tab", async () => {
  await render(<SearchScreen navigation={navigation} route={route} />);
  await type("rock");
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/search", { params: { q: "rock", limit: 5 } }));
  await waitFor(() => expect(screen.getByTestId("search-group-tournament")).toBeTruthy());
  expect(screen.getByTestId("search-group-team")).toBeTruthy();
  expect(screen.getByTestId("search-group-player")).toBeTruthy();
  expect(screen.getByText("Turniere")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("search-result-/tournaments/rl-2v2"));
  expect(navigate).toHaveBeenCalledWith("TournamentDetail", { id: "rl-2v2" });
  await waitFor(async () => expect(await loadRecentSearches()).toEqual(["rock"]));
});

test("Fehler: ein Satz statt einer leeren Seite", async () => {
  mockGet.mockRejectedValue(new Error("503"));
  await render(<SearchScreen navigation={navigation} route={route} />);
  await type("rock");
  await waitFor(() => expect(screen.getByTestId("search-error")).toHaveTextContent("Suche ist gerade nicht erreichbar."));
});

test("letzte Suchen: erscheinen, lassen sich einzeln und alle löschen", async () => {
  const SecureStore = jest.requireMock("expo-secure-store");
  await SecureStore.setItemAsync("tls.recent-searches", JSON.stringify(["rocket", "fc 26"]));
  await render(<SearchScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("search-recent-rocket")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("search-recent-remove-rocket"));
  await waitFor(() => expect(screen.queryByTestId("search-recent-rocket")).toBeNull());
  expect(await loadRecentSearches()).toEqual(["fc 26"]);
  await fireEvent.press(screen.getByTestId("search-recent-clear"));
  await waitFor(() => expect(screen.getByTestId("search-hint")).toBeTruthy());
  expect(await loadRecentSearches()).toEqual([]);
});

test("höchstens fünf, die neueste oben, doppelte fallen weg", () => {
  let list: string[] = [];
  for (const query of ["a1", "b2", "c3", "d4", "e5", "f6", "B2", " x "]) list = addRecentSearch(list, query);
  expect(list).toEqual(["B2", "f6", "e5", "d4", "c3"]);
  expect(groupSearchItems(ITEMS).map(([kind, rows]) => [kind, rows.length])).toEqual([["tournament", 2], ["team", 1], ["player", 1]]);
});

test("Kopfzeile je Tab: Titel, Lupe und Glocke mit Zahl - Gäste nur die Lupe", async () => {
  const view = await render(<TabHeader title="Community" testID="community-header" />);
  expect(screen.getByTestId("community-header-title")).toHaveTextContent("Community");
  expect(screen.getByTestId("community-header-search")).toBeTruthy();
  expect(screen.getByTestId("community-header-bell-count")).toHaveTextContent("3");
  expect(screen.getByLabelText("3 ungelesene Benachrichtigungen")).toBeTruthy();
  await view.unmount();
  mockUser.value = null;
  await render(<TabHeader title="Verein" testID="verein-header" />);
  expect(screen.getByTestId("verein-header-search")).toBeTruthy();
  expect(screen.queryByTestId("verein-header-bell")).toBeNull();
});
