import React from "react";
import { AccessibilityInfo, Linking } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { WEBSITE_BASE_URL } from "../../config";
import { FaqScreen } from "./FaqScreen";

// FAQ in der App (#2449): Suche, Häufige Fragen zum Aufklappen, Bereiche mit Rollen-Filter. Geschütztes nur nach der
// Antwort des Servers (GET /api/faq); ein älterer Server ohne den Endpunkt zeigt die öffentlichen Fragen ohne Fehler.
// Erfundene Daten.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
const mockAuth: { user: Record<string, unknown> | null } = { user: null };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
const mockNavigateToUrl = jest.fn((_url: string) => false);
jest.mock("../../navigation/rootNavigation", () => ({ navigateToUrl: (url: string) => mockNavigateToUrl(url) }));

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

test("Turnierleitung: eigener Bereich und Rollen-Chip", async () => {
  mockAuth.user = { id: "u-2" };
  antwort({ darf: { ...ALLES_ZU, angemeldet: true, turnierleitung: true }, fragen: [LEITUNG] });
  await renderFaq();
  await waitFor(() => expect(screen.getByTestId("faq-rolle-turnierleitung")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("faq-rolle-turnierleitung"));
  expect(screen.getByTestId("faq-rolle-turnierleitung").props.accessibilityState).toEqual({ selected: true });
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
