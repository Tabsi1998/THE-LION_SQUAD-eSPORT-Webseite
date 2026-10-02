import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { NewsDetailScreen } from "./NewsDetailScreen";

// Gelesen-Marker (#616): ein Beitrag, den eine angemeldete Person öffnet, meldet sich beim Server -
// Gäste und Fehler bleiben still, der Beitrag wird trotzdem gezeigt.

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockUser: { current: { id: string; username?: string } | null } = { current: { id: "u-1", username: "paula" } };
jest.mock("../../lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: mockUser.current }) }));
jest.mock("../../live", () => ({ isGuestUser: (user?: { id?: string } | null) => user?.id === "guest" }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("../../components/RichText", () => ({ RichText: () => null }));
jest.mock("../../components/ContentCard", () => ({ ContentCard: () => null }));

const navigation = { navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) } as never;
const route = { key: "n", name: "NewsDetail", params: { id: "sommer-cup" } } as never;
const POST = { id: "n1", slug: "sommer-cup", title: "Sommer-Cup", content: "Bald geht es los.", published_at: "2026-09-01T10:00:00Z" };

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.current = { id: "u-1", username: "paula" };
  mockGet.mockResolvedValue({ data: POST });
  mockPost.mockResolvedValue({ data: { read: true, total: 1 } });
});

test("angemeldet: der geöffnete Beitrag wird einmal als gelesen gemeldet - mit seiner Kennung", async () => {
  await render(<NewsDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Sommer-Cup")).toBeTruthy());
  expect(mockGet).toHaveBeenCalledWith("/news/sommer-cup");
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockPost).toHaveBeenCalledWith("/news/n1/read");
});

test("Gast oder ohne Anmeldung: der Beitrag erscheint, gemeldet wird nichts", async () => {
  mockUser.current = { id: "guest" };
  const guest = await render(<NewsDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Sommer-Cup")).toBeTruthy());
  await guest.unmount();
  mockUser.current = null;
  await render(<NewsDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Sommer-Cup")).toBeTruthy());
  expect(mockGet).toHaveBeenCalledTimes(2);
  expect(mockPost).not.toHaveBeenCalled();
});

test("scheitert die Meldung, bleibt der Beitrag trotzdem stehen", async () => {
  mockPost.mockRejectedValue(new Error("offline"));
  await render(<NewsDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Sommer-Cup")).toBeTruthy());
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Beitrag nicht gefunden")).toBeNull();
});

test("nicht sichtbarer Beitrag: Hinweis statt Inhalt, keine Meldung", async () => {
  mockGet.mockRejectedValue(new Error("Nicht sichtbar."));
  await render(<NewsDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Beitrag nicht gefunden")).toBeTruthy());
  expect(mockPost).not.toHaveBeenCalled();
});
