import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ProfileEditScreen } from "./ProfileEditScreen";

// Profil bearbeiten (#1061): „Profil speichern“ geht durch dieselbe Speicher-Warteschlange wie die Einstellungen -
// zweimal tippen schickt einen PATCH, ein Fehler lässt die Eingabe stehen und bietet „Erneut versuchen“.

const mockUser: { value: Record<string, unknown> | null } = { value: null };
jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.value, refreshMe: jest.fn(async () => undefined) }),
}));
const mockPatch = jest.fn(async (_path?: string, body?: Record<string, unknown>, _config?: unknown): Promise<{ data: Record<string, unknown> }> => ({
  data: { ...(mockUser.value || {}), ...(body || {}) },
}));
jest.mock("../../lib/api", () => ({
  api: {
    get: jest.fn(async () => ({ data: { links: [], available: {}, disabled: [] } })),
    patch: (...args: unknown[]) => mockPatch(...(args as [])),
    delete: jest.fn(),
  },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock("../../components/ImagePickField", () => ({ ImagePickField: () => null }));
jest.mock("../../components/LinkedAccounts", () => ({ LINKABLE_PLATFORMS: [], PlatformLinkRows: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../seasons/SeasonStage", () => ({ SeasonBackdropSlot: () => null, appNamesSeason: () => true }));
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));
jest.mock("../../navigation/rootNavigation", () => ({ navigateToUrl: () => false }));

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.value = { id: "u-1", username: "neonfalke", display_name: "Neon", bio: "", favorite_games: [] };
});

test("zweimal Speichern tippen schickt genau einen PATCH, nur mit dem Geänderten", async () => {
  let resolveFirst: (value: { data: Record<string, unknown> }) => void = () => {};
  mockPatch.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
  await render(<ProfileEditScreen />);
  await fireEvent.changeText(screen.getByLabelText("Anzeigename"), "Neon Falke");
  await fireEvent.press(screen.getByTestId("profile-edit-save"));
  await fireEvent.press(screen.getByTestId("profile-edit-save"));
  expect(mockPatch).toHaveBeenCalledTimes(1);
  const [path, payload, config] = mockPatch.mock.calls[0] as unknown as [string, Record<string, unknown>, { headers: Record<string, string> }];
  expect(path).toBe("/users/me");
  expect(payload).toEqual({ display_name: "Neon Falke" });
  expect(config.headers["X-Expected-User-Id"]).toBe("u-1");
  await act(async () => { resolveFirst({ data: { ...mockUser.value, display_name: "Neon Falke" } }); });
  await waitFor(() => expect(screen.getByTestId("profile-edit-message")).toHaveTextContent("Profil gespeichert."));
  expect(mockPatch).toHaveBeenCalledTimes(1);
});

test("ein Fehler lässt die Eingabe stehen, Erneut versuchen speichert sie", async () => {
  mockPatch.mockImplementationOnce(async () => { throw new Error("offline"); });
  await render(<ProfileEditScreen />);
  await fireEvent.changeText(screen.getByLabelText("Bio"), "Bleibt da.");
  await fireEvent.press(screen.getByTestId("profile-edit-save"));
  await waitFor(() => expect(screen.getByTestId("profile-edit-message")).toHaveTextContent("Profil konnte nicht gespeichert werden."));
  expect(screen.getByLabelText("Bio").props.value).toBe("Bleibt da.");
  await fireEvent.press(screen.getByTestId("profile-edit-retry"));
  await waitFor(() => expect(screen.getByTestId("profile-edit-message")).toHaveTextContent("Profil gespeichert."));
  expect((mockPatch.mock.calls[1] as unknown as [string, Record<string, unknown>])[1]).toEqual({ bio: "Bleibt da." });
  expect(screen.queryByTestId("profile-edit-retry")).toBeNull();
});
