import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { SiteBannerTicker } from "./SiteBannerTicker";

// Laufbanner (#245): nur App-Banner werden geladen, der wichtigste läuft oben; Wegwischen merkt
// sich der Banner, ein Tipp mit In-App-Ziel bleibt in der App.

const mockGet = jest.fn();
const mockNavigate = jest.fn();
jest.mock("../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock("../realtime/LiveChangesProvider", () => ({ useLiveRefresh: () => {} }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../navigation/rootNavigation", () => ({
  navigateToNotification: (...args: unknown[]) => mockNavigate(...args),
  targetFromUrl: (url?: string | null) => (url && url.startsWith("/events/") ? { area: "tournaments", screen: "EventDetail", params: { id: "lan" } } : null),
}));

beforeEach(() => {
  jest.clearAllMocks();
  const store = new Map<string, string>();
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string, value: string) => { store.set(key, value); });
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => store.get(key) ?? null);
  mockGet.mockResolvedValue({ data: { items: [
    { id: "a", text: "Anmeldung offen", priority: 10, tone: "success", mode: "static", link_url: "/events/lan", channels: ["web", "app"] },
    { id: "b", text: "Server in Wartung", priority: 50, tone: "warning", mode: "static", channels: ["app"] },
  ] } });
});

test("lädt nur App-Banner, zeigt den wichtigsten, Wegwischen zeigt den nächsten", async () => {
  await render(<SiteBannerTicker />);
  await waitFor(() => expect(screen.getByTestId("site-banner-text")).toBeTruthy());
  expect(mockGet).toHaveBeenCalledWith("/settings/site-banners", { params: { channel: "app" } });
  expect(screen.getByText("Server in Wartung")).toBeTruthy();

  await fireEvent.press(screen.getByTestId("site-banner-dismiss"));
  await waitFor(() => expect(screen.getByText("Anmeldung offen")).toBeTruthy());
  expect(SecureStore.setItemAsync).toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId("site-banner-text"));
  expect(mockNavigate).toHaveBeenCalledWith(expect.objectContaining({ url: "/events/lan" }));
});

test("ohne Banner bleibt die Leiste weg", async () => {
  mockGet.mockResolvedValue({ data: { items: [] } });
  await render(<SiteBannerTicker />);
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
  expect(screen.queryByTestId("site-banner")).toBeNull();
});
