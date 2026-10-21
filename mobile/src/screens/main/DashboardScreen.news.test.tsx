import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { DashboardScreen } from "./DashboardScreen";

// Gesamtpaket zu #1946: auch die News auf „Start“ zeigen nie dasselbe Bild zweimal hintereinander - wie die Startseite
// im Web (HomePage.jsx, withoutRepeatedBanners). Die Wiederholung zeigt das Zeichen der Karte statt des Bildes.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  responseFromCache: () => false,
}));
const mockAuth = { user: { id: "u1", username: "anna", display_name: "Anna" }, refreshMe: jest.fn(async () => undefined) };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../../realtime/LiveChangesProvider", () => ({ useLiveRefresh: () => undefined }));
jest.mock("@react-navigation/native", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    ...jest.requireActual("@react-navigation/native"),
    useFocusEffect: (effect: () => void) => useEffect(() => effect(), [effect]),
    useIsFocused: () => true,
  };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => {
  const { View } = jest.requireActual("react-native");
  return { MediaImage: ({ uri }: { uri?: string | null }) => <View testID={`media-${uri || "ohne"}`} /> };
});
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null, useSeasonOverlay: () => null }));
jest.mock("../../seasons/SeasonStage", () => ({ SeasonBackdropSlot: () => null, SeasonEdgeSlot: () => null, SeasonWidgetSlot: () => null }));
jest.mock("../../advent/entry", () => ({ AdventHint: () => null }));
jest.mock("../../components/YearReviewCard", () => ({ YearReviewCard: () => null }));
jest.mock("../../navigation/rootNavigation", () => ({ openSignIn: jest.fn() }));
jest.mock("../../lib/openLink", () => ({ openLink: jest.fn() }));

const navigation = { navigate: jest.fn() } as never;
const route = { key: "dashboard", name: "Dashboard" } as never;

test("News auf Start: dasselbe Bild nie zweimal hintereinander", async () => {
  const news = [
    { id: "n1", title: "Beitrag 1", banner_url: "/cover.jpg", published_at: "2030-01-03T10:00:00Z" },
    { id: "n2", title: "Beitrag 2", banner_url: "/cover.jpg", published_at: "2030-01-02T10:00:00Z" },
    { id: "n3", title: "Beitrag 3", banner_url: "/anders.jpg", published_at: "2030-01-01T10:00:00Z" },
  ];
  mockGet.mockImplementation(async (path: string) => (path === "/mobile/dashboard"
    ? { data: { me: { tournaments: [], events: [], matches: [], staff_matches: [], actions: [] }, public: { tournaments: [], events: [] }, news, streams: [] } }
    : { data: { open: false } }));
  await render(<DashboardScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Beitrag 3")).toBeTruthy());
  expect(screen.getAllByTestId("media-/cover.jpg")).toHaveLength(1);
  expect(screen.getByTestId("media-/anders.jpg")).toBeTruthy();
  expect(screen.getAllByTestId("media-ohne").length).toBeGreaterThanOrEqual(1);
});
