import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
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
  // Ein 404 des Servers, wie ihn axios liefert (#1152: „nicht gefunden“ ist etwas anderes als „ohne Netz“).
  mockGet.mockRejectedValue(Object.assign(new Error("Nicht sichtbar."), { isAxiosError: true, response: { status: 404, data: { detail: "Nicht sichtbar." } } }));
  await render(<NewsDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Beitrag nicht gefunden")).toBeTruthy());
  expect(mockPost).not.toHaveBeenCalled();
});

// Kennung wechselt im selben Screen (#1000): kein alter Beitrag unter neuer Kennung, keine verspätete Antwort.
const routeFor = (id: string) => ({ key: "n", name: "NewsDetail", params: { id } }) as never;
const notFound = () => Object.assign(new Error("Nicht sichtbar."), { isAxiosError: true, response: { status: 404, data: { detail: "Nicht sichtbar." } } });

test("A → B mit 404: der Beitrag A verschwindet, B zeigt „nicht gefunden“ (#1000)", async () => {
  mockGet.mockImplementation((path: string) => (path === "/news/b" ? Promise.reject(notFound()) : Promise.resolve({ data: { ...POST, id: "a1", slug: "a", title: "Beitrag A" } })));
  const view = await render(<NewsDetailScreen navigation={navigation} route={routeFor("a")} />);
  await waitFor(() => expect(screen.getByText("Beitrag A")).toBeTruthy());
  await view.rerender(<NewsDetailScreen navigation={navigation} route={routeFor("b")} />);
  expect(screen.queryByText("Beitrag A")).toBeNull();
  await waitFor(() => expect(screen.getByText("Beitrag nicht gefunden")).toBeTruthy());
  expect(screen.queryByText("Beitrag A")).toBeNull();
});

test("eine langsame Antwort für A überschreibt das spätere B nicht - und meldet A nicht als gelesen (#1000)", async () => {
  let finishA: (value: unknown) => void = () => undefined;
  mockGet.mockImplementation((path: string) => (path === "/news/a"
    ? new Promise((resolve) => { finishA = resolve; })
    : Promise.resolve({ data: { ...POST, id: "b1", slug: "b", title: "Beitrag B" } })));
  const view = await render(<NewsDetailScreen navigation={navigation} route={routeFor("a")} />);
  await view.rerender(<NewsDetailScreen navigation={navigation} route={routeFor("b")} />);
  await waitFor(() => expect(screen.getByText("Beitrag B")).toBeTruthy());
  await act(async () => {
    finishA({ data: { ...POST, id: "a1", slug: "a", title: "Beitrag A" } });
  });
  expect(screen.getByText("Beitrag B")).toBeTruthy();
  expect(screen.queryByText("Beitrag A")).toBeNull();
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockPost).toHaveBeenCalledWith("/news/b1/read");
});

test("Nochmal versuchen lädt die aktuelle Kennung (#1000)", async () => {
  mockGet.mockRejectedValueOnce(Object.assign(new Error("Network Error"), { isAxiosError: true }));
  await render(<NewsDetailScreen navigation={navigation} route={routeFor("b")} />);
  await waitFor(() => expect(screen.getByTestId("error-state-retry")).toBeTruthy());
  mockGet.mockResolvedValue({ data: { ...POST, id: "b1", slug: "b", title: "Beitrag B" } });
  await fireEvent.press(screen.getByTestId("error-state-retry"));
  await waitFor(() => expect(screen.getByText("Beitrag B")).toBeTruthy());
  expect(mockGet).toHaveBeenLastCalledWith("/news/b");
});
