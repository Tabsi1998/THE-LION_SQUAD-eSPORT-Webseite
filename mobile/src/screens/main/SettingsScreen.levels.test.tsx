import React from "react";
import { NavigationContext } from "@react-navigation/native";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { LEVEL_TOPIC_KEYS, levelPatch, type NotificationLevel } from "../../lib/notificationLevels";
import { SettingsScreen } from "./SettingsScreen";

// Benachrichtigungen in Stufen, Themen und Ruhezeit (#2444, wie das Web #1204/#1206): drei Stufen mit „Eigene Auswahl“, je
// Thema Push / Nur App / Aus, Ruhezeit von–bis mit Ausnahmen und 15 Minuten Lücke, „Weitere Wege“ eingeklappt. Ein älterer
// Server ohne die Felder zeigt die bisherige Ansicht (SettingsScreen.test.tsx).

const mockUser: { value: Record<string, unknown> | null } = { value: null };
jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.value, logout: jest.fn(), refreshMe: jest.fn(async () => undefined) }),
}));
jest.mock("../../live", () => ({ isGuestUser: (user: unknown) => !user }));
const mockGet = jest.fn();
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
jest.mock("../../update/AppUpdateProvider", () => ({ useOptionalAppUpdate: () => ({ openWhatsNew: jest.fn() }) }));

const PUSHED: Record<string, string[]> = {
  all: LEVEL_TOPIC_KEYS,
  important: ["match_reminders", "tournament_updates", "billing_updates", "membership_updates", "community_messages", "helper_shifts"],
  few: ["match_reminders", "billing_updates"],
};
const LEVELS: NotificationLevel[] = [
  { key: "all", label: "Alles", description: "Jedes Thema per Push – nichts verpasst." },
  { key: "important", label: "Wichtiges", description: "Spiele, Turniere, Rechnungen, Mitgliedschaft, Nachrichten an dich und Helferdienste per Push. Der Rest liegt in der Glocke." },
  { key: "few", label: "Wenig", description: "Nur Spiele und Aufrufe sowie Rechnungen per Push. Alles andere liegt in der Glocke." },
].map((level) => ({ ...level, modes: Object.fromEntries(LEVEL_TOPIC_KEYS.map((topic) => [topic, PUSHED[level.key].includes(topic) ? "push" : "app"])) as NotificationLevel["modes"] }));
const EXCEPTIONS = [
  "Aufruf zu deinem Spiel und „Match startet jetzt“",
  "Liga: Check-in offen und Veto – ihr seid am Zug, für dein eigenes Spiel",
  "Für die Turnierleitung: „Braucht Aufmerksamkeit“, solange dein Turnier läuft",
];

function serverAnswer(patch: Record<string, unknown> = {}) {
  return {
    newsletter_consent: true,
    preferences: { email: true, push: true, in_app: true, discord: false, ...levelPatch(LEVELS[0]) },
    level: "all",
    topics: LEVEL_TOPIC_KEYS,
    levels: LEVELS,
    quiet_hours: { enabled: false, start: "22:00", end: "07:00" },
    quiet_hours_suggestion: { start: "22:00", end: "07:00" },
    quiet_hours_exceptions: EXCEPTIONS,
    discord: { linked: false },
    ...patch,
  };
}

function answerWith(data: unknown) {
  mockGet.mockImplementation((path: string) => Promise.resolve({ data: path === "/users/me/notification-preferences" ? data : [] }));
}

async function renderSettings() {
  const view = await render(
    <NavigationContext.Provider value={{ navigate: jest.fn() } as never}>
      <SettingsScreen />
    </NavigationContext.Provider>,
  );
  await waitFor(() => expect(screen.getByTestId("notification-levels")).toBeTruthy());
  return view;
}

/** Wartet den Autosave ab und gibt den letzten PATCH zurück. */
async function lastPatch() {
  await act(async () => { jest.advanceTimersByTime(800); });
  await act(async () => {});
  const call = mockPatch.mock.calls.at(-1) as unknown as [string, Record<string, any>] | undefined;
  return call?.[1];
}

const checked = (id: string) => screen.getByTestId(id).props.accessibilityState?.checked;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockUser.value = { id: "u-1", username: "neonfalke", privacy_public_profile: true, dm_privacy: "everyone", newsletter_consent: true, notification_preferences: {} };
  answerWith(serverAnswer());
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Stufen", () => {
  test("drei Stufen wie im Web; die passende ist gewählt, darunter ihr Text", async () => {
    await renderSettings();
    expect(within(screen.getByTestId("notification-level-all")).getByText("Alles")).toBeTruthy();
    expect(within(screen.getByTestId("notification-level-important")).getByText("Wichtiges")).toBeTruthy();
    expect(within(screen.getByTestId("notification-level-few")).getByText("Wenig")).toBeTruthy();
    expect(checked("notification-level-all")).toBe(true);
    expect(checked("notification-level-few")).toBe(false);
    expect(screen.getByTestId("notification-level-description")).toHaveTextContent("Jedes Thema per Push – nichts verpasst.");
    expect(screen.queryByTestId("notification-level-custom")).toBeNull();
    expect(screen.queryByTestId("notification-legacy")).toBeNull();
  });

  test("eine Stufe antippen stellt alle Themen um - ein PATCH", async () => {
    await renderSettings();
    await fireEvent.press(screen.getByTestId("notification-level-few"));
    expect(checked("notification-level-few")).toBe(true);
    expect(checked("notification-topic-news_events-app")).toBe(true);
    expect(checked("notification-topic-match_reminders-push")).toBe(true);
    const payload = await lastPatch();
    expect(mockPatch).toHaveBeenCalledTimes(1);
    expect(payload?.notification_preferences).toEqual(expect.objectContaining({
      "push:news_events": false, "in_app:news_events": true, "browser:news_events": false, "push:match_reminders": true, "push:billing_updates": true,
    }));
    expect(payload).not.toHaveProperty("quiet_hours");
  });

  test("ein Thema selbst stellen zeigt „Eigene Auswahl“", async () => {
    await renderSettings();
    await fireEvent.press(screen.getByTestId("notification-topic-achievements-off"));
    expect(screen.getByTestId("notification-level-custom")).toHaveTextContent("Eigene Auswahl");
    expect(checked("notification-level-all")).toBe(false);
    expect(screen.getByTestId("notification-level-description")).toHaveTextContent(/^Du hast einzelne Themen selbst gestellt./);
    const payload = await lastPatch();
    expect(payload?.notification_preferences).toEqual(expect.objectContaining({ "in_app:achievements": false, "push:achievements": false, "browser:achievements": false }));
  });

  test("Themen mit den Wörtern wie im Web; Push / Nur App / Aus als Tippflächen mit mindestens 48 Punkten", async () => {
    await renderSettings();
    expect(within(screen.getByTestId("notification-topic-match_reminders")).getByText("Spiele & Aufrufe")).toBeTruthy();
    expect(within(screen.getByTestId("notification-topic-tournament_updates")).getByText("Anmeldung, Status, Hinweise der Turnierleitung, Liga-Rundnachrichten und Belohnungen der Liga.")).toBeTruthy();
    expect(screen.getByLabelText("Spiele & Aufrufe: Nur App")).toBeTruthy();
    expect(screen.getByTestId("notification-topic-match_reminders-app")).toHaveStyle({ minHeight: 48 });
  });

  test("Push ganz aus: Hinweis mit „Push einschalten“", async () => {
    answerWith(serverAnswer({ preferences: { email: true, push: false, in_app: true, ...levelPatch(LEVELS[0]) } }));
    await renderSettings();
    expect(screen.getByTestId("notification-push-off")).toHaveTextContent(/^Push aufs Handy ist bei dir ganz aus/);
    await fireEvent.press(screen.getByTestId("notification-push-on"));
    expect(screen.queryByTestId("notification-push-off")).toBeNull();
    expect((await lastPatch())?.notification_preferences).toEqual(expect.objectContaining({ push: true }));
  });
});

describe("Ruhezeit", () => {
  test("einschalten: Vorschlag 22:00 bis 7:00, Zusammenfassung, Ausnahmen - und gespeichert", async () => {
    await renderSettings();
    expect(screen.queryByTestId("notification-quiet-body")).toBeNull();
    await fireEvent(screen.getByLabelText("Ruhezeit"), "valueChange", true);
    expect(screen.getByTestId("notification-quiet-start").props.value).toBe("22:00");
    expect(screen.getByTestId("notification-quiet-end").props.value).toBe("07:00");
    expect(screen.getByTestId("notification-quiet-summary")).toHaveTextContent("Täglich 22:00 bis 07:00 Uhr, Wiener Zeit – über Mitternacht.");
    for (const text of EXCEPTIONS) expect(within(screen.getByTestId("notification-quiet-exceptions")).getByText(text)).toBeTruthy();
    expect((await lastPatch())?.quiet_hours).toEqual({ enabled: true, start: "22:00", end: "07:00" });
  });

  test("ungültige Uhrzeit bleibt Entwurf: Hinweis, nichts gespeichert", async () => {
    answerWith(serverAnswer({ quiet_hours: { enabled: true, start: "22:00", end: "07:00" } }));
    await renderSettings();
    await fireEvent.changeText(screen.getByTestId("notification-quiet-start"), "25:00");
    await fireEvent(screen.getByTestId("notification-quiet-start"), "blur");
    expect(screen.getByTestId("notification-quiet-error")).toHaveTextContent("Bitte eine Uhrzeit wie 22:00 angeben.");
    expect(screen.queryByTestId("notification-quiet-summary")).toBeNull();
    await lastPatch();
    expect(mockPatch).not.toHaveBeenCalled();
    // Richtig getippt („7:30“ wie am Handy üblich) geht es durch.
    await fireEvent.changeText(screen.getByTestId("notification-quiet-start"), "23:30");
    await fireEvent.changeText(screen.getByTestId("notification-quiet-end"), "6:30");
    expect((await lastPatch())?.quiet_hours).toEqual({ enabled: true, start: "23:30", end: "06:30" });
  });

  test("weniger als 15 Minuten Lücke zwischen Ende und Beginn: Hinweis, nichts gespeichert", async () => {
    answerWith(serverAnswer({ quiet_hours: { enabled: true, start: "07:00", end: "06:30" } }));
    await renderSettings();
    await fireEvent.press(screen.getByTestId("notification-quiet-end-later"));
    expect(screen.getByTestId("notification-quiet-end").props.value).toBe("06:45");
    expect((await lastPatch())?.quiet_hours).toEqual({ enabled: true, start: "07:00", end: "06:45" });
    mockPatch.mockClear();
    await fireEvent.press(screen.getByTestId("notification-quiet-end-later"));
    expect(screen.getByTestId("notification-quiet-end").props.value).toBe("07:00");
    expect(screen.getByTestId("notification-quiet-error")).toHaveTextContent("Zwischen Ende und Beginn der Ruhezeit müssen mindestens 15 Minuten liegen.");
    await lastPatch();
    expect(mockPatch).not.toHaveBeenCalled();
  });
});

describe("Weitere Wege", () => {
  test("eingeklappt; aufgeklappt E-Mail, Kanäle, Newsletter - Discord nur verknüpft", async () => {
    await renderSettings();
    expect(screen.queryByTestId("notification-more-panel")).toBeNull();
    expect(screen.getByTestId("notification-more-ways").props.accessibilityState).toEqual({ expanded: false });
    await fireEvent.press(screen.getByTestId("notification-more-ways"));
    expect(screen.getByTestId("notification-more-ways").props.accessibilityState).toEqual({ expanded: true });
    const panel = screen.getByTestId("notification-more-panel");
    expect(within(panel).getByLabelText("E-Mail")).toBeTruthy();
    expect(within(panel).getByLabelText("Newsletter")).toBeTruthy();
    expect(within(panel).queryByLabelText("Discord")).toBeNull();
    expect(within(panel).getByTestId("notification-discord-unlinked")).toBeTruthy();
    await fireEvent(within(panel).getByLabelText("E-Mail"), "valueChange", false);
    expect((await lastPatch())?.notification_preferences).toEqual(expect.objectContaining({ email: false }));
  });
});

describe("Laden", () => {
  test("vor der Antwort Platzhalter; scheitert das Laden, gibt es „Erneut versuchen“", async () => {
    let fail = true;
    mockGet.mockImplementation((path: string) => {
      if (path !== "/users/me/notification-preferences") return Promise.resolve({ data: [] });
      return fail ? Promise.reject(new Error("offline")) : Promise.resolve({ data: serverAnswer() });
    });
    await render(
      <NavigationContext.Provider value={{ navigate: jest.fn() } as never}>
        <SettingsScreen />
      </NavigationContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId("notification-load-failed")).toBeTruthy());
    expect(screen.getByTestId("notification-load-failed")).toHaveTextContent(/^Die Stufen konnten nicht geladen werden./);
    fail = false;
    await fireEvent.press(screen.getByTestId("notification-load-retry"));
    await waitFor(() => expect(screen.getByTestId("notification-levels")).toBeTruthy());
    expect(screen.queryByTestId("notification-load-failed")).toBeNull();
  });

  test("älterer Server ohne Stufen: die bisherige Ansicht, keine Ruhezeit", async () => {
    answerWith({ preferences: { push: true }, discord: { linked: false } });
    await render(
      <NavigationContext.Provider value={{ navigate: jest.fn() } as never}>
        <SettingsScreen />
      </NavigationContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId("notification-legacy")).toBeTruthy());
    expect(screen.queryByTestId("notification-levels")).toBeNull();
    expect(screen.queryByLabelText("Ruhezeit")).toBeNull();
    // Die Wörter sind auch dort wie im Web.
    await fireEvent.press(screen.getByTestId("settings-topics-toggle"));
    expect(screen.getByText("Spiele & Aufrufe")).toBeTruthy();
  });
});
