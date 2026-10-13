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
// Der Server antwortet mit dem ganzen Konto - wie /users/me.
const mockPatch = jest.fn(async (_path?: string, body?: Record<string, unknown>, _config?: unknown): Promise<{ data: Record<string, unknown> }> => ({
  data: { ...(mockUser.value || {}), ...(body || {}) },
}));
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

// Speicher-Warteschlange (#1061): höchstens ein PATCH gleichzeitig, keine ältere Antwort über einen neueren Stand,
// nichts ins falsche Konto, und ein Fehler lässt die Schalterstellung stehen - mit „Erneut versuchen“.
function deferPatch() {
  const call: { resolve: (data: Record<string, unknown>) => void } = { resolve: () => {} };
  mockPatch.mockImplementationOnce(() => new Promise((resolve) => { call.resolve = (data) => resolve({ data }); }));
  return call;
}

test("ein zweiter Schalter während des Speicherns wartet - nie zwei PATCH gleichzeitig", async () => {
  jest.useFakeTimers();
  const first = deferPatch();
  await renderSettings();
  await fireEvent(screen.getByLabelText("Öffentliches Profil"), "valueChange", false);
  await act(async () => { jest.advanceTimersByTime(800); });
  expect(mockPatch).toHaveBeenCalledTimes(1);
  const [, firstPayload, firstConfig] = mockPatch.mock.calls[0] as unknown as [string, Record<string, unknown>, { headers: Record<string, string> }];
  expect(firstPayload).toEqual({ privacy_public_profile: false });
  expect(firstConfig.headers["X-Expected-User-Id"]).toBe("u-1");

  await fireEvent(screen.getByLabelText("Twitch im Profil anzeigen"), "valueChange", true);
  await act(async () => { jest.advanceTimersByTime(800); });
  expect(mockPatch).toHaveBeenCalledTimes(1);

  // Der Server kennt nach der ersten Anfrage das private Profil.
  mockPatch.mockImplementationOnce(async (_path, body) => ({ data: { ...mockUser.value, privacy_public_profile: false, ...body } }));
  await act(async () => { first.resolve({ ...mockUser.value, privacy_public_profile: false }); });
  await act(async () => { jest.advanceTimersByTime(10); });
  expect(mockPatch).toHaveBeenCalledTimes(2);
  expect((mockPatch.mock.calls[1] as unknown as [string, Record<string, unknown>])[1]).toEqual({ show_twitch_embed: true });
  expect(screen.getByLabelText("Öffentliches Profil").props.value).toBe(false);
  expect(screen.getByLabelText("Twitch im Profil anzeigen").props.value).toBe(true);
  jest.useRealTimers();
});

test("eine späte Antwort der Benachrichtigungen überschreibt keinen gerade umgeschalteten Kanal", async () => {
  let resolvePrefs: (value: unknown) => void = () => {};
  mockGet.mockImplementation((path: string) => (path === "/users/me/notification-preferences"
    ? new Promise((resolve) => { resolvePrefs = resolve; })
    : Promise.resolve({ data: [] })));
  await renderSettings();
  await fireEvent(screen.getByLabelText("Push"), "valueChange", false);
  await act(async () => { resolvePrefs({ data: { preferences: { push: true, email: true, in_app: false }, discord: { linked: false } } }); });
  expect(screen.getByLabelText("Push").props.value).toBe(false);
  // Was nicht umgeschaltet war, kommt vom Server.
  expect(screen.getByLabelText("In-App").props.value).toBe(false);
});

test("Kontowechsel: eine offene Änderung wird nicht ins neue Konto geschrieben", async () => {
  jest.useFakeTimers();
  const view = await renderSettings();
  await fireEvent(screen.getByLabelText("Öffentliches Profil"), "valueChange", false);
  mockUser.value = { id: "u-2", username: "zweites", privacy_public_profile: true, dm_privacy: "everyone", notification_preferences: {} };
  await view.rerender(
    <NavigationContext.Provider value={navigation}>
      <SettingsScreen />
    </NavigationContext.Provider>,
  );
  await act(async () => { jest.advanceTimersByTime(800); });
  expect(mockPatch).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Öffentliches Profil").props.value).toBe(true);
  jest.useRealTimers();
});

test("Kontowechsel während des Speicherns: die alte Antwort ändert die Schalter des neuen Kontos nicht", async () => {
  jest.useFakeTimers();
  const first = deferPatch();
  const view = await renderSettings();
  await fireEvent(screen.getByLabelText("Öffentliches Profil"), "valueChange", false);
  await act(async () => { jest.advanceTimersByTime(800); });
  expect(mockPatch).toHaveBeenCalledTimes(1);
  mockUser.value = { id: "u-2", username: "zweites", privacy_public_profile: true, dm_privacy: "everyone", notification_preferences: {} };
  await view.rerender(
    <NavigationContext.Provider value={navigation}>
      <SettingsScreen />
    </NavigationContext.Provider>,
  );
  await act(async () => { first.resolve({ id: "u-1", privacy_public_profile: false }); });
  await act(async () => { jest.advanceTimersByTime(800); });
  expect(screen.getByLabelText("Öffentliches Profil").props.value).toBe(true);
  expect(mockPatch).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

test("Fehler: Hinweis mit Erneut versuchen, die Schalterstellung bleibt", async () => {
  jest.useFakeTimers();
  mockPatch.mockImplementationOnce(async () => { throw new Error("offline"); });
  await renderSettings();
  await fireEvent(screen.getByLabelText("Öffentliches Profil"), "valueChange", false);
  await act(async () => { jest.advanceTimersByTime(800); });
  jest.useRealTimers();
  await waitFor(() => expect(screen.getByTestId("settings-message")).toHaveTextContent("Einstellung konnte nicht gespeichert werden."));
  expect(screen.getByLabelText("Öffentliches Profil").props.value).toBe(false);
  await fireEvent.press(screen.getByTestId("settings-retry"));
  await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(2));
  expect((mockPatch.mock.calls[1] as unknown as [string, Record<string, unknown>])[1]).toEqual({ privacy_public_profile: false });
  await waitFor(() => expect(screen.getByTestId("settings-message")).toHaveTextContent("Gespeichert."));
  expect(screen.queryByTestId("settings-retry")).toBeNull();
});

test("Konto: Profil bearbeiten öffnet die eigene Seite, Abmelden meldet ab", async () => {
  await renderSettings();
  await fireEvent.press(screen.getByTestId("settings-edit-profile"));
  expect(navigate).toHaveBeenCalledWith("ProfileEdit");
  await fireEvent.press(screen.getByTestId("settings-logout"));
  expect(mockLogout).toHaveBeenCalledTimes(1);
});
