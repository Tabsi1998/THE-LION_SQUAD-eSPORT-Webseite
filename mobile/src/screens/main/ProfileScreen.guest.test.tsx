import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ProfileScreen } from "./ProfileScreen";

// Gast zuerst (#918): ohne Konto zeigt der Profil-Tab den Weg zum Konto - kein leeres Profil „Live-Daten“ mehr. Darunter
// die Einstellungen für Gäste (#1146): nur Darstellung und „Über die App“.

const mockOpenSignIn = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({
  openSignIn: (...args: unknown[]) => mockOpenSignIn(...args),
  openDetail: jest.fn(),
  openTab: jest.fn(),
  navigateToUrl: () => false,
  targetFromUrl: jest.fn(),
}));
jest.mock("../../auth/AuthContext", () => {
  const guest = jest.requireActual("../../live").liveGuestUser;
  return { useAuth: () => ({ user: guest }) };
});
const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn(), put: jest.fn(), patch: jest.fn() },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  resolveMediaUrl: (value: string) => value,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../seasons/SeasonStage", () => ({ SeasonBackdropSlot: () => null, appNamesSeason: () => true }));
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));

test("als Gast: Anmelden oder Konto erstellen statt eines leeren Profils - ohne eine einzige Anfrage", async () => {
  await render(<ProfileScreen />);
  expect(screen.getByText("Dein Profil")).toBeTruthy();
  expect(screen.getByTestId("profile-header-title")).toHaveTextContent("Profil");
  expect(screen.queryByText("Live-Gastmodus")).toBeNull();
  expect(screen.queryByText("Live-Daten")).toBeNull();
  expect(mockGet).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId("profile-guest-login"));
  expect(mockOpenSignIn).toHaveBeenLastCalledWith("Login");
  await fireEvent.press(screen.getByTestId("profile-guest-register"));
  expect(mockOpenSignIn).toHaveBeenLastCalledWith("Register");
});

test("als Gast: unter dem Anmelde-Hinweis nur Darstellung und „Über die App“ - kein Zahnrad, keine Glocke", async () => {
  await render(<ProfileScreen />);
  expect(screen.getByTestId("settings-group-appearance")).toBeTruthy();
  expect(screen.getByTestId("season-deco-setting")).toBeTruthy();
  expect(screen.getByTestId("settings-group-about")).toBeTruthy();
  expect(screen.getByText(/LionsAPP v0\.5\.0-beta · Build 63/)).toBeTruthy();
  for (const group of ["notifications", "security", "privacy", "account"]) expect(screen.queryByTestId(`settings-group-${group}`)).toBeNull();
  expect(screen.queryByTestId("profile-settings")).toBeNull();
  expect(screen.queryByTestId("profile-header-bell")).toBeNull();
  expect(screen.getByTestId("profile-header-search")).toBeTruthy();
});
