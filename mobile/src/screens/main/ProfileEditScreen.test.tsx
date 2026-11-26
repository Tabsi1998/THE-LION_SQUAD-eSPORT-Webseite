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
// Die Bildfelder merken sich ihre Props, damit ein fertiger Upload nachgestellt werden kann.
const mockImageFields: Record<string, { onUploaded: (url: string) => Promise<void> | void }> = {};
jest.mock("../../components/ImagePickField", () => ({
  ImagePickField: (props: { testID: string; onUploaded: (url: string) => Promise<void> | void }) => {
    mockImageFields[props.testID] = props;
    return null;
  },
}));
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

// Nach Codex-Prüfung: scheitert nach einem erfolgreichen Upload das Speichern, bleibt die neue Bild-URL als
// ungespeicherte Änderung stehen - „Erneut versuchen“ speichert sie.
test("Bild hochgeladen, Speichern scheitert: Erneut versuchen speichert die neue Bild-URL", async () => {
  mockPatch.mockImplementationOnce(async () => { throw new Error("offline"); });
  await render(<ProfileEditScreen />);
  const url = "https://cdn.example.test/neu.png";
  await act(async () => {
    await expect(Promise.resolve(mockImageFields["profile-avatar"].onUploaded(url))).rejects.toThrow();
  });
  expect(screen.getByTestId("profile-edit-message")).toHaveTextContent("Profil konnte nicht gespeichert werden.");
  await fireEvent.press(screen.getByTestId("profile-edit-retry"));
  await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(2));
  expect((mockPatch.mock.calls[1] as unknown as [string, Record<string, unknown>])[1]).toEqual({ avatar_url: url });
  await waitFor(() => expect(screen.getByTestId("profile-edit-message")).toHaveTextContent("Profil gespeichert."));
});

// Eingabegeräte (#2542, #2126): Mehrfachauswahl `input_devices` wie im Web statt des alten Einzelfelds `input_device`.
test("Eingabegeräte als Mehrfachauswahl: der alte Einzelwert ist vorgewählt, gespeichert wird nur die Liste", async () => {
  mockUser.value = { ...mockUser.value, input_device: "controller" };
  // (Nachbesserung: die alte Kennung „mouse_keyboard“ heißt neu „keyboard_mouse“ - eigener Test unten.)
  await render(<ProfileEditScreen />);
  expect(screen.queryByLabelText("Eingabegerät")).toBeNull();
  expect(screen.getByTestId("profile-input-device-controller").props.accessibilityState).toMatchObject({ checked: true });
  expect(screen.getByTestId("profile-input-device-wheel").props.accessibilityState).toMatchObject({ checked: false });
  await fireEvent.press(screen.getByTestId("profile-input-device-wheel"));
  await fireEvent.press(screen.getByTestId("profile-edit-save"));
  await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
  const payload = mockPatch.mock.calls[0][1] as Record<string, unknown>;
  expect(payload).toEqual({ input_devices: ["controller", "wheel"] });
});

test("Eingabegeräte abwählen: die leere Liste geht raus", async () => {
  mockUser.value = { ...mockUser.value, input_devices: ["keyboard_mouse"] };
  await render(<ProfileEditScreen />);
  expect(screen.getByTestId("profile-input-device-keyboard_mouse").props.accessibilityState).toMatchObject({ checked: true });
  await fireEvent.press(screen.getByTestId("profile-input-device-keyboard_mouse"));
  await fireEvent.press(screen.getByTestId("profile-edit-save"));
  await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
  expect(mockPatch.mock.calls[0][1]).toEqual({ input_devices: [] });
});

// Nachbesserung (#2542): Der alte Einzelwert wird sauber abgebildet - nie unsichtbar vorgewählt. Freitext steht als Hinweis da.
test("alte Kennung mouse_keyboard heißt neu keyboard_mouse; „both“ wählt beide; Freitext wird nicht vorgewählt, nur genannt", async () => {
  mockUser.value = { ...mockUser.value, input_device: "mouse_keyboard" };
  await render(<ProfileEditScreen />);
  expect(screen.getByTestId("profile-input-device-keyboard_mouse").props.accessibilityState).toMatchObject({ checked: true });
  expect(screen.queryByTestId("profile-input-device-legacy")).toBeNull();

  mockUser.value = { ...mockUser.value, input_device: "both" };
  await render(<ProfileEditScreen />);
  expect(screen.getByTestId("profile-input-device-keyboard_mouse").props.accessibilityState).toMatchObject({ checked: true });
  expect(screen.getByTestId("profile-input-device-controller").props.accessibilityState).toMatchObject({ checked: true });

  mockUser.value = { ...mockUser.value, input_device: "PS5-Pad mit Paddles" };
  await render(<ProfileEditScreen />);
  for (const key of ["keyboard_mouse", "controller", "wheel", "fightstick", "mobile_touch", "arcade"]) {
    expect(screen.getByTestId(`profile-input-device-${key}`).props.accessibilityState).toMatchObject({ checked: false });
  }
  expect(screen.getByTestId("profile-input-device-legacy")).toHaveTextContent("Bisher eingetragen: „PS5-Pad mit Paddles“ – bitte oben auswählen.");
  await fireEvent.press(screen.getByTestId("profile-edit-save"));
  expect(mockPatch).not.toHaveBeenCalled();
});
