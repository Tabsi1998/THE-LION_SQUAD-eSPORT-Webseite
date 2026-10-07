import React from "react";
import { NavigationContext } from "@react-navigation/native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { GUEST_SETTINGS_GROUPS, SETTINGS_GROUPS, SettingsScreen } from "./SettingsScreen";

// Einstellungen an einem Ort (#1146): eine Seite mit Gruppen in fester Reihenfolge - Darstellung, Benachrichtigungen,
// Sicherheit, Privatsphäre, Konto, Über die App. Gäste sehen nur Darstellung und Über die App. Schalter speichern von selbst.

const mockUser: { value: Record<string, unknown> | null } = { value: null };
const mockLogout = jest.fn(async () => undefined);
jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.value, logout: mockLogout, refreshMe: jest.fn(async () => undefined) }),
}));
jest.mock("../../live", () => ({ isGuestUser: (user: unknown) => !user }));
const mockGet = jest.fn();
const mockPatch = jest.fn(async () => ({ data: {} }));
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), patch: (...args: unknown[]) => mockPatch(...(args as [])), post: jest.fn(), delete: jest.fn() },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock("../../lock/AppLockProvider", () => ({ useAppLock: () => ({ enabled: false, availability: "ready", setEnabled: jest.fn() }) }));
jest.mock("../../components/PasskeysCard", () => ({ PasskeysCard: () => null }));
jest.mock("../../components/BlockedUsersCard", () => ({ BlockedUsersCard: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../seasons/SeasonStage", () => ({ SeasonBackdropSlot: () => null, appNamesSeason: () => true }));
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));
jest.mock("../../navigation/rootNavigation", () => ({ navigateToUrl: () => false }));
const mockWhatsNew = jest.fn();
jest.mock("../../update/AppUpdateProvider", () => ({ useOptionalAppUpdate: () => ({ openWhatsNew: mockWhatsNew }) }));

const navigate = jest.fn();
const navigation = { navigate } as never;

function renderSettings() {
  return render(
    <NavigationContext.Provider value={navigation}>
      <SettingsScreen />
    </NavigationContext.Provider>,
  );
}

const TEST_IDS: Record<string, string> = {
  Darstellung: "settings-group-appearance",
  Benachrichtigungen: "settings-group-notifications",
  Sicherheit: "settings-group-security",
  Privatsphäre: "settings-group-privacy",
  Konto: "settings-group-account",
  "Über die App": "settings-group-about",
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  mockUser.value = { id: "u-1", username: "neonfalke", privacy_public_profile: true, dm_privacy: "everyone", notification_preferences: {} };
  mockGet.mockImplementation((path: string) => Promise.resolve({ data: path === "/auth/sessions" ? [] : { preferences: {}, discord: { linked: false } } }));
});

test("angemeldet: alle Gruppen in der festen Reihenfolge - wie im Web", async () => {
  expect(SETTINGS_GROUPS).toEqual(["Darstellung", "Benachrichtigungen", "Sicherheit", "Privatsphäre", "Konto", "Über die App"]);
  await renderSettings();
  const shown = screen.getAllByRole("header").map((node) => String(node.props.children));
  expect(shown).toEqual([...SETTINGS_GROUPS]);
  for (const group of SETTINGS_GROUPS) expect(screen.getByTestId(TEST_IDS[group])).toBeTruthy();
  // Die Deko steht nur hier (nicht mehr unter „Mehr“).
  expect(screen.getByTestId("season-deco-setting")).toBeTruthy();
});

// Geräteprobe vor 1.4.0: die Überschriften stehen über den Karten - der oberste Schalter einer Karte bekam trotzdem
// seine Trennlinie und stand unter einem leeren Strich. Zwischen zwei Schaltern bleibt die Linie.
test("der oberste Schalter einer Karte hat keine Trennlinie über sich, die folgenden schon", async () => {
  await renderSettings();
  for (const id of ["settings-toggle-newsletter", "settings-toggle-app-lock", "settings-toggle-public-profile"]) {
    expect(screen.getByTestId(id)).toHaveStyle({ borderTopWidth: 0, paddingTop: 0 });
  }
  expect(screen.getByTestId("settings-toggle-achievements-public")).toHaveStyle({ borderTopWidth: 1 });
});

test("Gast: nur Darstellung und Über die App", async () => {
  mockUser.value = null;
  await renderSettings();
  expect(screen.getAllByRole("header").map((node) => String(node.props.children))).toEqual([...GUEST_SETTINGS_GROUPS]);
  expect(mockGet).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId("more-whats-new"));
  expect(mockWhatsNew).toHaveBeenCalledTimes(1);
});

test("Schalter speichern von selbst - nur die Einstellungen, nicht das ganze Profil", async () => {
  jest.useFakeTimers();
  await renderSettings();
  await fireEvent(screen.getByLabelText("Öffentliches Profil"), "valueChange", false);
  await act(async () => {
    jest.advanceTimersByTime(800);
  });
  jest.useRealTimers();
  await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
  const [path, payload] = mockPatch.mock.calls[0] as unknown as [string, Record<string, unknown>];
  expect(path).toBe("/users/me");
  expect(payload.privacy_public_profile).toBe(false);
  expect(payload).not.toHaveProperty("display_name");
});

test("Konto: Profil bearbeiten öffnet die eigene Seite, Abmelden meldet ab", async () => {
  await renderSettings();
  await fireEvent.press(screen.getByTestId("settings-edit-profile"));
  expect(navigate).toHaveBeenCalledWith("ProfileEdit");
  await fireEvent.press(screen.getByTestId("settings-logout"));
  expect(mockLogout).toHaveBeenCalledTimes(1);
});
