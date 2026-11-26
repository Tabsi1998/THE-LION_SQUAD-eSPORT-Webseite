import React from "react";
import { NavigationContext } from "@react-navigation/native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { EINSTELLUNGEN, GRUPPEN, einstellungenDer, sichtbar, type GruppeKey } from "../../lib/meinBereich";
import { MeinBereichGruppeScreen } from "./MeinBereichGruppeScreen";

// Die Gruppen von Mein Bereich (#2059, #1677): jede Einstellung, die die Suche findet, steht in ihrer Gruppe - ab dem Tab
// höchstens zwei Tipps (Gruppe, dann die Stelle). Nichts geht verloren: dieselbe Liste speist Suche und Seiten.

const mockUser: { value: Record<string, unknown> | null } = { value: null };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: mockUser.value, refreshMe: jest.fn(async () => undefined), logout: jest.fn() }) }));
jest.mock("../../live", () => ({ isGuestUser: (user: unknown) => !user }));
const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn(), patch: jest.fn(async () => ({ data: {} })), delete: jest.fn() },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  resolveMediaUrl: (value: string) => value,
}));
const mockNavigateToUrl = jest.fn((_url: string) => true);
jest.mock("../../navigation/rootNavigation", () => ({ navigateToUrl: (url: string) => mockNavigateToUrl(url), openSignIn: jest.fn(), openDetail: jest.fn() }));
jest.mock("../../lock/AppLockProvider", () => ({ useAppLock: () => ({ enabled: false, availability: "ready", setEnabled: jest.fn() }) }));
jest.mock("../../components/PasskeysCard", () => ({ PasskeysCard: () => null }));
jest.mock("../../components/BlockedUsersCard", () => ({ BlockedUsersCard: () => null }));
jest.mock("../../components/MemberConsents", () => {
  const { Text } = jest.requireActual("react-native");
  return { MemberConsents: () => <Text testID="member-consents">Einwilligungen des Vereins</Text> };
});
jest.mock("../../components/league/LeagueSanctionsList", () => ({ LeagueSanctionsList: () => null }));
jest.mock("../../components/PushOffHint", () => ({ PushOffHint: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../seasons/SeasonStage", () => ({ SeasonBackdropSlot: () => null, appNamesSeason: () => true }));
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));
jest.mock("../../update/AppUpdateProvider", () => ({ useOptionalAppUpdate: () => ({ openWhatsNew: jest.fn() }) }));

const MEMBER = { id: "u-1", username: "neonfalke", is_club_member: true, privacy_public_profile: true, dm_privacy: "everyone", notification_preferences: {}, mail_digest: null };
const LEVELS = [{ key: "all", label: "Alles", modes: {} }, { key: "important", label: "Wichtiges", modes: {} }, { key: "few", label: "Wenig", modes: {} }];
const DIGEST = {
  rhythm: "instant", own: null, default: "daily",
  options: [
    { key: "instant", label: "Sofort", schedule: "Jede Mail sofort" },
    { key: "daily", label: "Täglich", schedule: "Täglich um 07:00 Uhr" },
    { key: "weekly", label: "Wöchentlich", schedule: "Montags um 07:00 Uhr" },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.value = MEMBER;
  mockGet.mockImplementation((path: string) => {
    if (path === "/users/me/notification-preferences") return Promise.resolve({ data: { preferences: {}, levels: LEVELS, quiet_hours: { enabled: false, start: "22:00", end: "07:00" }, discord: { linked: false }, mail_digest: DIGEST } });
    if (path === "/account/invoices") return Promise.resolve({ data: { currency: "EUR", summary: { open_count: 2, open_total: 30, overdue_count: 1 } } });
    if (path === "/prizes/me/open-count") return Promise.resolve({ data: { count: 0 } });
    if (path === "/moderation/me/standing") return Promise.resolve({ data: { strike_count: 0, strike_ttl_months: 12, active: null } });
    return Promise.resolve({ data: [] });
  });
});

function renderGruppe(gruppe: Exclude<GruppeKey, "start">, ziel?: string) {
  return render(
    <NavigationContext.Provider value={{ navigate: jest.fn(), addListener: jest.fn(() => () => {}), isFocused: () => true } as never}>
      <MeinBereichGruppeScreen route={{ key: "g", name: "MeinBereichGruppe", params: { gruppe, ziel } } as never} navigation={{} as never} />
    </NavigationContext.Provider>,
  );
}

const SEITEN = GRUPPEN.filter((item) => item.key !== "start").map((item) => item.key as Exclude<GruppeKey, "start">);

test.each(SEITEN)("Mitglied: jede Einstellung der Gruppe „%s“ steht auf ihrer Seite (2 Tipps ab dem Tab)", async (gruppe) => {
  await renderGruppe(gruppe, gruppe === "benachrichtigungen" ? "weitere-wege" : undefined);
  const items = einstellungenDer(gruppe, { mitglied: true });
  expect(items.length).toBeGreaterThan(0);
  for (const item of items) {
    await waitFor(() => expect([item.ziel, screen.queryByTestId(`mb-${item.ziel}`) !== null]).toEqual([item.ziel, true]));
  }
});

test("jede Einstellung - auch für Nicht-Mitglieder und Gäste - hat ihren Platz in einer der Seiten", () => {
  // Kein Eintrag ohne Gruppe oder mit einer Gruppe, die es nicht gibt; jede Sicht hat mindestens einen.
  for (const item of EINSTELLUNGEN) expect(SEITEN).toContain(item.gruppe);
  expect(EINSTELLUNGEN.some((item) => sichtbar(item, { gast: true }))).toBe(true);
  expect(EINSTELLUNGEN.some((item) => item.fuer === "nichtmitglied")).toBe(true);
});

test("kein Mitglied: Mitgliedschaft zeigt den Weg hinein, Verein ebenso", async () => {
  mockUser.value = { ...MEMBER, is_club_member: false };
  const view = await renderGruppe("mitgliedschaft");
  expect(screen.getByTestId("mb-beitreten")).toBeTruthy();
  expect(screen.getByTestId("membership-join-cta")).toBeTruthy();
  expect(screen.queryByTestId("mb-nummer")).toBeNull();
  await view.unmount();
  await renderGruppe("verein");
  expect(screen.getByTestId("membership-join")).toBeTruthy();
  expect(screen.queryByTestId("mb-versammlungen")).toBeNull();
});

test("Gast: jede Gruppe außer Konto & Sicherheit bittet ums Anmelden - Konto zeigt Darstellung und Über die App", async () => {
  mockUser.value = null;
  const view = await renderGruppe("rechnungen");
  expect(screen.getByTestId("mein-bereich-gruppe-anmelden")).toBeTruthy();
  expect(mockGet).not.toHaveBeenCalled();
  await view.unmount();
  await renderGruppe("konto");
  expect(screen.getByTestId("mb-darstellung")).toBeTruthy();
  expect(screen.getByTestId("mb-faq")).toBeTruthy();
  expect(screen.queryByTestId("mb-app-sperre")).toBeNull();
  expect(mockGet).not.toHaveBeenCalled();
});

test("Rechnungen & Unterlagen: Zahlen wie „Nur für dich“, ein Tipp öffnet den Screen; Strafen mit dem Stand der Moderation", async () => {
  await renderGruppe("rechnungen", "strafen");
  await waitFor(() => expect(screen.getByTestId("mein-bereich-zeile-rechnungen")).toHaveTextContent(/2 offen · €\s30,00 · 1 überfällig/));
  expect(screen.getByTestId("mein-bereich-zeile-gewinne")).toHaveTextContent(/Keine offenen Gewinne/);
  await waitFor(() => expect(screen.getByTestId("mein-bereich-strafen-moderation")).toHaveTextContent(/Keine Treffer/));
  await fireEvent.press(screen.getByTestId("mein-bereich-zeile-unterlagen"));
  expect(mockNavigateToUrl).toHaveBeenLastCalledWith("/mein-bereich/rechnungen?tab=unterlagen");
});

test("Benachrichtigungen: Sammel-Mail mit der Vorgabe des Vereins - eigene Wahl und zurück zur Vorgabe über PATCH /users/me", async () => {
  const api = jest.requireMock("../../lib/api") as { api: { patch: jest.Mock } };
  jest.useFakeTimers();
  try {
    await renderGruppe("benachrichtigungen");
    await waitFor(() => expect(screen.getByTestId("notification-digest")).toBeTruthy());
    // Ohne eigene Wahl gilt die Vorgabe des Vereins (täglich).
    expect(screen.getByTestId("notification-digest-summary")).toHaveTextContent(/Täglich um 07:00 Uhr\./);
    expect(screen.getByTestId("notification-digest-default")).toHaveTextContent("Vorgabe des Vereins: Täglich.");
    expect(screen.getByTestId("notification-digest-daily").props.accessibilityState).toEqual({ checked: true });
    await fireEvent.press(screen.getByTestId("notification-digest-weekly"));
    expect(screen.getByTestId("notification-digest-summary")).toHaveTextContent(/Montags um 07:00 Uhr\./);
    await fireEvent.press(screen.getByTestId("notification-digest-use-default"));
    expect(screen.getByTestId("notification-digest-default")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("notification-digest-weekly"));
    jest.advanceTimersByTime(1000);
    await waitFor(() => expect(api.api.patch).toHaveBeenCalled());
    expect(api.api.patch.mock.calls[0][1]).toEqual({ mail_digest: "weekly" });
  } finally {
    jest.useRealTimers();
  }
});

test("Sprung zu Newsletter: „Weitere Wege“ ist gleich offen", async () => {
  await renderGruppe("benachrichtigungen", "newsletter");
  await waitFor(() => expect(screen.getByTestId("notification-newsletter")).toBeTruthy());
  expect(screen.getByTestId("mb-newsletter")).toBeTruthy();
});
