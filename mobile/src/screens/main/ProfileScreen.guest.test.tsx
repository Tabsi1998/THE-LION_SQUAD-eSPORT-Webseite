import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ProfileScreen } from "./ProfileScreen";

// Gast zuerst (#918): kommt ein Gast über einen Link (/u/me) auf das eigene Profil, zeigt es den Weg zum Konto - kein leeres
// Profil „Live-Daten“. Darstellung und „Über die App“ stehen seit Mein Bereich (#2059) in dessen Übersicht
// (MeinBereichScreen.test.tsx), nicht mehr hier.

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
  expect(screen.queryByText("Live-Gastmodus")).toBeNull();
  expect(screen.queryByText("Live-Daten")).toBeNull();
  expect(mockGet).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId("profile-guest-login"));
  expect(mockOpenSignIn).toHaveBeenLastCalledWith("Login");
  await fireEvent.press(screen.getByTestId("profile-guest-register"));
  expect(mockOpenSignIn).toHaveBeenLastCalledWith("Register");
});

test("als Gast: kein Zahnrad, kein zweiter Kopf - die Einstellungen wohnen in Mein Bereich", async () => {
  await render(<ProfileScreen />);
  expect(screen.queryByTestId("profile-settings")).toBeNull();
  expect(screen.queryByTestId("profile-header")).toBeNull();
  expect(screen.queryByTestId("settings-group-appearance")).toBeNull();
});
