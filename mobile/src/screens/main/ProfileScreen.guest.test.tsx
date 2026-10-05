import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ProfileScreen } from "./ProfileScreen";

// Gast zuerst (#918): ohne Konto zeigt der Profil-Tab den Weg zum Konto - kein leeres Profil „Live-Daten“ mehr.

const mockOpenSignIn = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({
  openSignIn: (...args: unknown[]) => mockOpenSignIn(...args),
  navigateToUrl: jest.fn(),
  targetFromUrl: jest.fn(),
}));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: jest.requireActual("../../live").liveGuestUser }) }));
const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn(), put: jest.fn() },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  resolveMediaUrl: (value: string) => value,
}));

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
