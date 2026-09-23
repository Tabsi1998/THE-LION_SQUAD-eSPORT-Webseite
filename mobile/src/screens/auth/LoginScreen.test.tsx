import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Passkey } from "react-native-passkey";
import { LoginScreen } from "./LoginScreen";

// Anmelden (#217 Stufe 2): „Mit Passkey anmelden“ gibt es, wenn das Gerät es kann; Abbruch ist
// eine Meldung, kein Absturz; ohne Unterstützung fehlt der Knopf.

const mockLoginWithPasskey = jest.fn();
const mockLogin = jest.fn();
jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ login: mockLogin, loginWithPasskey: mockLoginWithPasskey, completeMfa: jest.fn(), continueAsGuest: jest.fn(), rememberSession: true }),
}));
jest.mock("../../lib/api", () => ({ errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback) }));
jest.mock("../../branding/BrandingProvider", () => ({ useBranding: () => ({ clubName: "LION", logoUrl: "", mascotUrl: "", loaded: false }) }));

const navigation = { navigate: jest.fn() } as never;
const route = { key: "l", name: "Login" } as never;

beforeEach(() => {
  jest.clearAllMocks();
  (Passkey.isSupported as jest.Mock).mockReturnValue(true);
});

test("der Passkey-Knopf meldet mit „Angemeldet bleiben“ an; ein Abbruch steht als Satz da", async () => {
  mockLoginWithPasskey.mockRejectedValueOnce({ error: "UserCancelled" });
  await render(<LoginScreen navigation={navigation} route={route} />);
  await fireEvent.press(screen.getByText("Mit Passkey anmelden"));
  await waitFor(() => expect(screen.getByText("Passkey-Vorgang abgebrochen.")).toBeTruthy());
  expect(mockLoginWithPasskey).toHaveBeenCalledWith(true);

  mockLoginWithPasskey.mockResolvedValueOnce(undefined);
  await fireEvent.press(screen.getByText("Mit Passkey anmelden"));
  await waitFor(() => expect(mockLoginWithPasskey).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("Passkey-Vorgang abgebrochen.")).toBeNull();
});

test("ohne Unterstützung am Gerät gibt es den Knopf nicht", async () => {
  (Passkey.isSupported as jest.Mock).mockReturnValue(false);
  await render(<LoginScreen navigation={navigation} route={route} />);
  expect(screen.queryByText("Mit Passkey anmelden")).toBeNull();
  expect(screen.getByText("Anmelden")).toBeTruthy();
});
