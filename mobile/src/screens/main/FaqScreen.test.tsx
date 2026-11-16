import React from "react";
import { AccessibilityInfo, Linking } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { WEBSITE_BASE_URL } from "../../config";
import { FaqScreen } from "./FaqScreen";

// FAQ in der App (#2449): Suche, Häufige Fragen zum Aufklappen, Bereiche mit Rollen-Filter. Geschütztes nur nach der
// Antwort des Servers (GET /api/faq); ein älterer Server ohne den Endpunkt zeigt die öffentlichen Fragen ohne Fehler.
// Erfundene Daten.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
const mockAuth: { user: Record<string, unknown> | null } = { user: null };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
// Symbole mit Kennung zeigen ihren Namen - so prüft der Test Pfeil gegen „öffnet im Browser“.
jest.mock("@expo/vector-icons", () => ({
  Ionicons: ({ name, testID }: { name: string; testID?: string }) => {
    const { createElement } = jest.requireActual("react");
    const { Text: RNText } = jest.requireActual("react-native");
    return testID ? createElement(RNText, { testID }, name) : null;
  },
}));
const mockNavigateToUrl = jest.fn((_url: string) => false);
jest.mock("../../navigation/rootNavigation", () => ({
  ...jest.requireActual("../../navigation/rootNavigation"),
  navigateToUrl: (url: string) => mockNavigateToUrl(url),
}));

const reanimated = jest.requireMock("react-native-reanimated");

const HELFER = {
  id: "helferdienst-eintragen", frage: "Wie trage ich mich für einen Helferdienst ein?", antwort: "Öffne Helferdienste und tippe bei einer Schicht auf Ich helfe.",
  bereich: "helferdienste", rollen: ["mitglied"], sichtbar_fuer: "mitglied", haeufig: true,
};
const LEITUNG = {
  id: "station-aufrufen", frage: "Wie rufe ich ein Spiel an der Station auf?", antwort: "In der Leitungsansicht tippst du auf Aufrufen.",
  bereich: "turnierleitung", rollen: ["turnierleitung"], sichtbar_fuer: "turnierleitung", haeufig: true,
};
const ALLES_ZU = { angemeldet: false, mitglied: false, helfer: false, turnierleitung: false, turnierleitung_verwaltung: false };

function antwort(data: unknown) {
  mockGet.mockImplementation((url: string) => (url === "/faq" ? Promise.resolve({ data }) : Promise.reject(new Error(`unerwartet: ${url}`))));
}

function reduce(value: boolean) {
  jest.spyOn(reanimated, "useReducedMotion").mockReturnValue(value);
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(new Promise<boolean>(() => undefined));
}

async function renderFaq() {
  const view = await render(<FaqScreen />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/faq"));
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.user = null;
  mockNavigateToUrl.mockImplementation(() => false);
  reduce(false);
});

afterEach(() => jest.restoreAllMocks());

test("älterer Server ohne /api/faq: öffentliche Fragen, kein Fehler, nichts Geschütztes", async () => {
  mockGet.mockRejectedValue(Object.assign(new Error("Not Found"), { response: { status: 404 } }));
  await renderFaq();
  expect(screen.getByTestId("faq-haeufig")).toBeTruthy();
  expect(screen.getByTestId("faq-frage-app-aufruf-ton")).toBeTruthy();
  expect(screen.getByTestId("faq-frage-konto-anlegen")).toBeTruthy();
  expect(screen.getByTestId("faq-bereich-lionsapp")).toBeTruthy();
  expect(screen.queryByTestId("faq-bereich-helferdienste")).toBeNull();
  expect(screen.queryByTestId("faq-bereich-turnierleitung")).toBeNull();
  expect(screen.queryByTestId("faq-rolle-turnierleitung")).toBeNull();
  expect(screen.queryByText(/Fehler|nicht geladen/)).toBeNull();
});

test("Mitglied: der Server liefert Mitgliederfragen, die Leitungsfrage ohne Recht bleibt weg", async () => {
  mockAuth.user = { id: "u-1" };
  antwort({ darf: { ...ALLES_ZU, angemeldet: true, mitglied: true }, fragen: [HELFER, LEITUNG], anleitungen: [] });
  await renderFaq();
  await waitFor(() => expect(screen.getByTestId("faq-frage-helferdienst-eintragen")).toBeTruthy());
  expect(screen.getByTestId("faq-bereich-helferdienste")).toBeTruthy();
  // Der Server schickt mehr, als `darf` erlaubt: die App zeigt es trotzdem nicht.
  expect(screen.queryByTestId("faq-frage-station-aufrufen")).toBeNull();
  expect(screen.queryByTestId("faq-bereich-turnierleitung")).toBeNull();
  expect(screen.queryByTestId("faq-rolle-turnierleitung")).toBeNull();
});

test("ein Link ohne Ziel vom Server: die Frage klappt auf, nur der Link fehlt", async () => {
  mockAuth.user = { id: "u-1" };
  antwort({ darf: { ...ALLES_ZU, angemeldet: true, mitglied: true }, fragen: [{ ...HELFER, link: { label: "Zu den Helferdiensten" } }] });
  await renderFaq();
  await waitFor(() => expect(screen.getByTestId("faq-frage-helferdienst-eintragen")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("faq-frage-helferdienst-eintragen-knopf"));
  expect(screen.getByText(/tippe bei einer Schicht auf Ich helfe/)).toBeTruthy();
  expect(screen.queryByTestId("faq-frage-link-helferdienst-eintragen")).toBeNull();
});

test("Link auf eine Frage: eine häufige klappt oben auf, eine andere in ihrem Bereich", async () => {
  antwort({ darf: ALLES_ZU, fragen: [] });
  const view = await render(<FaqScreen route={{ key: "faq-1", params: { frage: "app-aufruf-ton" } }} />);
  await waitFor(() => expect(screen.getByTestId("faq-frage-app-aufruf-ton-knopf").props.accessibilityState).toEqual({ expanded: true }));
  expect(screen.getByTestId("faq-bereich-lionsapp-knopf").props.accessibilityState).toEqual({ expanded: false });
  await view.unmount();

  await render(<FaqScreen route={{ key: "faq-2", params: { frage: "app-ruhezeit" } }} />);
  await waitFor(() => expect(screen.getByTestId("faq-bereich-lionsapp-knopf").props.accessibilityState).toEqual({ expanded: true }));
  expect(screen.getByTestId("faq-frage-app-ruhezeit-bereich-knopf").props.accessibilityState).toEqual({ expanded: true });
});

test("Link mit Suche und auf einen Bereich; eine geschützte Frage wartet auf den Server", async () => {
  mockAuth.user = { id: "u-1" };
  let freigeben: (value: unknown) => void = () => undefined;
  mockGet.mockImplementation(() => new Promise((resolve) => { freigeben = resolve; }));
  await render(<FaqScreen route={{ key: "faq-3", params: { frage: HELFER.id, q: "Helferdienst" } }} />);
  expect(screen.getByTestId("faq-search").props.value).toBe("Helferdienst");
  await act(async () => freigeben({ data: { darf: { ...ALLES_ZU, angemeldet: true, mitglied: true }, fragen: [HELFER] } }));
  // Während einer Suche stehen die Häufigen nicht da - die Frage klappt in ihrem Bereich auf.
  await waitFor(() => expect(screen.getByTestId("faq-bereich-helferdienste-knopf").props.accessibilityState).toEqual({ expanded: true }));
  expect(screen.getByTestId("faq-frage-helferdienst-eintragen-bereich-knopf").props.accessibilityState).toEqual({ expanded: true });
});

test("Link auf einen Bereich setzt den Rollen-Filter zurück und klappt ihn auf", async () => {
  antwort({ darf: ALLES_ZU, fragen: [] });
  const view = await renderFaq();
  // Mit „Mitglied“ steht die Liga nicht in der Liste.
  await fireEvent.press(screen.getByTestId("faq-rolle-mitglied"));
  expect(screen.queryByTestId("faq-bereich-liga")).toBeNull();
  await view.rerender(<FaqScreen route={{ key: "faq-4", params: { bereich: "liga" } }} />);
  await waitFor(() => expect(screen.getByTestId("faq-bereich-liga-knopf").props.accessibilityState).toEqual({ expanded: true }));
  expect(screen.getByTestId("faq-rolle-alle").props.accessibilityState).toEqual({ checked: true });
});

test("Turnierleitung: eigener Bereich und Rollen-Chip", async () => {
  mockAuth.user = { id: "u-2" };
  antwort({ darf: { ...ALLES_ZU, angemeldet: true, turnierleitung: true }, fragen: [LEITUNG] });
  await renderFaq();
  await waitFor(() => expect(screen.getByTestId("faq-rolle-turnierleitung")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("faq-rolle-turnierleitung"));
  expect(screen.getByTestId("faq-rolle-turnierleitung").props.accessibilityState).toEqual({ checked: true });
  expect(screen.getByTestId("faq-bereich-turnierleitung")).toBeTruthy();
  expect(screen.queryByTestId("faq-bereich-liga")).toBeNull();
});

test("Aufklappen sagt den Zustand an; Links öffnen den Screen der App oder die Website", async () => {
  antwort({ darf: ALLES_ZU, fragen: [] });
  await renderFaq();
  const knopf = screen.getByTestId("faq-bereich-lionsapp-knopf");
  expect(knopf.props.accessibilityState).toEqual({ expanded: false });
  await fireEvent.press(knopf);
  expect(screen.getByTestId("faq-bereich-lionsapp-knopf").props.accessibilityState).toEqual({ expanded: true });
  await fireEvent.press(screen.getByTestId("faq-frage-app-push-stufen-bereich-knopf"));
  expect(screen.getByText(/Wähl eine Stufe: Alles, Wichtiges oder Wenig/)).toBeTruthy();
  mockNavigateToUrl.mockImplementation(() => true);
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
  await fireEvent.press(screen.getByTestId("faq-frage-link-app-push-stufen-bereich"));
  expect(mockNavigateToUrl).toHaveBeenLastCalledWith("/profile?tab=notifications");
  expect(open).not.toHaveBeenCalled();

  // Eine Anleitung mit Bildern: die Website im Browser, mit Anker auf den Schritt.
  mockNavigateToUrl.mockImplementation(() => false);
  await fireEvent.press(screen.getByTestId("faq-frage-konto-anlegen-knopf"));
  await fireEvent.press(screen.getByTestId("faq-frage-link-konto-anlegen"));
  expect(open).toHaveBeenLastCalledWith(`${WEBSITE_BASE_URL}/faq/konto-und-profil#registrieren`);
  await fireEvent.press(screen.getByTestId("faq-frage-konto-anlegen-knopf"));
  expect(screen.queryByTestId("faq-frage-konto-anlegen-inhalt")).toBeNull();
});

test("das Symbol am Link sagt, ob die App den Screen hat oder die Website aufgeht", async () => {
  antwort({ darf: ALLES_ZU, fragen: [] });
  await renderFaq();
  await fireEvent.press(screen.getByTestId("faq-bereich-lionsapp-knopf"));
  await fireEvent.press(screen.getByTestId("faq-frage-app-push-stufen-bereich-knopf"));
  expect(screen.getByTestId("faq-frage-link-symbol-app-push-stufen-bereich")).toHaveTextContent("arrow-forward");
  // Anleitung im Web und eine Seite ohne Screen in der App (Beitrag unter Mitglied werden): beide öffnen den Browser.
  await fireEvent.press(screen.getByTestId("faq-frage-konto-anlegen-knopf"));
  expect(screen.getByTestId("faq-frage-link-symbol-konto-anlegen")).toHaveTextContent("open-outline");
  await fireEvent.press(screen.getByTestId("faq-bereich-verein-mitgliedschaft-knopf"));
  await fireEvent.press(screen.getByTestId("faq-frage-was-kostet-mitgliedschaft-bereich-knopf"));
  expect(screen.getByTestId("faq-frage-link-symbol-was-kostet-mitgliedschaft-bereich")).toHaveTextContent("open-outline");
});

test("Suche: Fragen zum Aufklappen und Schritte mit Link auf die Website; Rollen-Filter blendet Bereiche aus", async () => {
  antwort({ darf: ALLES_ZU, fragen: [] });
  await renderFaq();
  await fireEvent.changeText(screen.getByTestId("faq-search"), "Gong");
  expect(screen.queryByTestId("faq-haeufig")).toBeNull();
  expect(screen.getByTestId("faq-results-ansage")).toHaveTextContent("1 Treffer");
  expect(screen.getByTestId("faq-frage-app-aufruf-ton-treffer")).toBeTruthy();

  await fireEvent.changeText(screen.getByTestId("faq-search"), "einchecken");
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
  await fireEvent.press(screen.getByTestId("faq-treffer-schritt-turniere-einchecken"));
  expect(open).toHaveBeenLastCalledWith(`${WEBSITE_BASE_URL}/faq/turniere#einchecken`);

  await fireEvent.changeText(screen.getByTestId("faq-search"), "Zebrastreifen");
  expect(screen.getByTestId("faq-no-results")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("faq-search-clear"));
  expect(screen.getByTestId("faq-haeufig")).toBeTruthy();

  expect(screen.getByTestId("faq-bereich-liga")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("faq-rolle-mitglied"));
  expect(screen.queryByTestId("faq-bereich-liga")).toBeNull();
  expect(screen.getByTestId("faq-bereich-lionsapp")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("faq-rolle-alle"));
  expect(screen.getByTestId("faq-bereich-liga")).toBeTruthy();
});

test("Bewegung: Pfeil und Antwort laufen an - mit „Bewegung reduzieren“ steht alles sofort da", async () => {
  antwort({ darf: ALLES_ZU, fragen: [] });
  const timing = jest.spyOn(reanimated, "withTiming");
  const view = await renderFaq();
  await fireEvent.press(screen.getByTestId("faq-frage-app-aufruf-ton-knopf"));
  expect(timing).toHaveBeenCalledWith(1, expect.objectContaining({ duration: 240 }));
  expect(screen.getByTestId("faq-frage-app-aufruf-ton-inhalt")).toBeTruthy();
  await view.unmount();

  jest.restoreAllMocks();
  reduce(true);
  antwort({ darf: ALLES_ZU, fragen: [] });
  const still = jest.spyOn(reanimated, "withTiming");
  await renderFaq();
  await fireEvent.press(screen.getByTestId("faq-frage-app-aufruf-ton-knopf"));
  expect(still).not.toHaveBeenCalled();
  // Keine Blende, die erst noch aufgehen müsste; der Pfeil steht gleich gedreht.
  expect(screen.getByTestId("faq-frage-app-aufruf-ton-inhalt")).not.toHaveStyle({ opacity: 0 });
  expect(screen.getByText(/eigenen Gong/)).toBeTruthy();
});

test("beim Öffnen läuft keine Bewegung an; Wischen schließt die Tastatur; Rollen als Radio-Gruppe", async () => {
  antwort({ darf: ALLES_ZU, fragen: [] });
  const timing = jest.spyOn(reanimated, "withTiming");
  await renderFaq();
  // Pfeil (200 ms) und Antwort (240 ms) der FAQ - andere Bausteine des Rahmens zählen hier nicht.
  const faqBewegung = () => timing.mock.calls.filter(([, config]) => [200, 240].includes((config as { duration?: number } | undefined)?.duration ?? 0));
  expect(faqBewegung()).toEqual([]);
  await fireEvent.press(screen.getByTestId("faq-frage-app-aufruf-ton-knopf"));
  expect(faqBewegung().length).toBeGreaterThan(0);
  expect(screen.getByTestId("faq-screen").props.keyboardDismissMode).toBe("on-drag");
  const gruppe = screen.getByTestId("faq-rollen-gruppe");
  expect(gruppe.props.accessibilityRole).toBe("radiogroup");
  expect(gruppe.props.accessibilityLabel).toBe("Für wen?");
  expect(screen.getByTestId("faq-rolle-alle").props.accessibilityRole).toBe("radio");
  expect(screen.getByTestId("faq-rolle-alle").props.accessibilityState).toEqual({ checked: true });
  await fireEvent.press(screen.getByTestId("faq-rolle-captain"));
  expect(screen.getByTestId("faq-rolle-alle").props.accessibilityState).toEqual({ checked: false });
  expect(screen.getByTestId("faq-rolle-captain").props.accessibilityState).toEqual({ checked: true });
});
