import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Passkey } from "react-native-passkey";
import { LoginScreen } from "./LoginScreen";

// Anmelden (#918, #919): kein „Live-Daten ansehen“ mehr - die App läuft ohne Konto. Einen Passkey bietet die Seite beim
// Öffnen selbst an; ohne Passkey bleibt still das Formular, nach einem Abbruch gibt es einen kleinen Link. Nach der
// Anmeldung geht es zurück, woher man kam.

const mockLoginWithPasskey = jest.fn();
const mockLogin = jest.fn();
jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ login: mockLogin, loginWithPasskey: mockLoginWithPasskey, completeMfa: jest.fn(), rememberSession: true }),
}));
jest.mock("../../lib/api", () => ({ errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback) }));
jest.mock("../../branding/BrandingProvider", () => ({ useBranding: () => ({ clubName: "LION", logoUrl: "", mascotUrl: "", loaded: false }) }));

const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(() => true) };

beforeEach(() => {
  jest.clearAllMocks();
  (Passkey.isSupported as jest.Mock).mockReturnValue(true);
});

test("ohne Passkey auf dem Gerät: still das Formular - kein Link, keine Meldung, kein „Live-Daten ansehen“", async () => {
  mockLoginWithPasskey.mockRejectedValueOnce({ error: "NoCredentials" });
  await render(<LoginScreen navigation={navigation} />);
  // Still: nur sofort verfügbare Passkeys (getImmediate), das Formular bleibt frei.
  await waitFor(() => expect(mockLoginWithPasskey).toHaveBeenCalledWith(true, true));
  expect(screen.getByText("Anmelden")).toBeTruthy();
  expect(screen.queryByTestId("login-passkey-link")).toBeNull();
  expect(screen.queryByText(/kein Passkey/)).toBeNull();
  expect(screen.queryByText("Live-Daten ansehen")).toBeNull();
  expect(screen.queryByText("Mit Passkey anmelden")).toBeNull();
});

test("abgebrochen: der kleine Link holt die Abfrage zurück; klappt sie, geht es zurück", async () => {
  mockLoginWithPasskey.mockRejectedValueOnce({ error: "UserCancelled" });
  await render(<LoginScreen navigation={navigation} />);
  await waitFor(() => expect(screen.getByTestId("login-passkey-link")).toBeTruthy());
  expect(screen.queryByText("Passkey-Vorgang abgebrochen.")).toBeNull();

  mockLoginWithPasskey.mockRejectedValueOnce({ error: "UserCancelled" });
  await fireEvent.press(screen.getByTestId("login-passkey-link"));
  await waitFor(() => expect(screen.getByText("Passkey-Vorgang abgebrochen.")).toBeTruthy());

  mockLoginWithPasskey.mockResolvedValueOnce(undefined);
  await fireEvent.press(screen.getByTestId("login-passkey-link"));
  await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
});

test("Passwort-Anmeldung geht zurück, woher man kam; ohne Passkey-Unterstützung fragt die Seite nichts", async () => {
  (Passkey.isSupported as jest.Mock).mockReturnValue(false);
  mockLogin.mockResolvedValueOnce({ mfaRequired: false });
  await render(<LoginScreen navigation={navigation} />);
  expect(mockLoginWithPasskey).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText("E-Mail"), " paula@club-mail.at ");
  await fireEvent.changeText(screen.getByLabelText("Passwort"), "geheim");
  await fireEvent.press(screen.getByText("Anmelden"));
  await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
  expect(mockLogin).toHaveBeenCalledWith("paula@club-mail.at", "geheim", true, false);
  await fireEvent.press(screen.getByText("Noch keinen Account? Registrieren"));
  expect(navigation.navigate).toHaveBeenCalledWith("Register");
});

// Mehrere Passkeys (#939): fand die stille Abfrage auf diesem Handy keinen, sagt die Anmeldung das weiter - die App lädt
// dann ein, auch wenn das Konto anderswo schon einen hat.
test("kein Passkey auf diesem Gerät: die Passwort-Anmeldung meldet es für die Einladung", async () => {
  mockLoginWithPasskey.mockRejectedValueOnce({ error: "NoCredentials" });
  mockLogin.mockResolvedValueOnce({ mfaRequired: false });
  await render(<LoginScreen navigation={navigation} />);
  await waitFor(() => expect(mockLoginWithPasskey).toHaveBeenCalledWith(true, true));
  await fireEvent.changeText(screen.getByLabelText("E-Mail"), "paula@club-mail.at");
  await fireEvent.changeText(screen.getByLabelText("Passwort"), "geheim");
  await fireEvent.press(screen.getByText("Anmelden"));
  await waitFor(() => expect(mockLogin).toHaveBeenCalledWith("paula@club-mail.at", "geheim", true, true));
});

// Passkey am Handy, den der Server nicht kennt (#949): ruhiger Hinweis mit dem Satz des Servers, kein rotes Feld, das
// Formular bleibt bedienbar, der kleine Link bleibt - und die Passwort-Anmeldung lädt danach zu einem neuen Passkey ein.
test("unbekannter Passkey: ruhiger Hinweis, Formular frei, Einladung zum neuen Passkey nach der Passwort-Anmeldung", async () => {
  const unknown = { response: { status: 401, headers: { "x-passkey-error": "unknown-credential" }, data: { detail: "Diesen Passkey kennt lionsquad.at nicht (mehr). Lösche ihn im Passwortmanager deines Handys und melde dich mit Passwort an – danach bietet dir die App einen neuen an." } } };
  mockLoginWithPasskey.mockRejectedValueOnce(unknown);
  mockLogin.mockResolvedValueOnce({ mfaRequired: false });
  await render(<LoginScreen navigation={navigation} />);
  await waitFor(() => expect(screen.getByTestId("login-passkey-unknown")).toBeTruthy());
  expect(screen.getByTestId("login-passkey-unknown")).toHaveTextContent(/kennt lionsquad\.at nicht \(mehr\)/);
  expect(screen.getByTestId("login-passkey-link")).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText("E-Mail"), "paula@club-mail.at");
  await fireEvent.changeText(screen.getByLabelText("Passwort"), "geheim");
  await fireEvent.press(screen.getByText("Anmelden"));
  await waitFor(() => expect(mockLogin).toHaveBeenCalledWith("paula@club-mail.at", "geheim", true, true));
  expect(navigation.goBack).toHaveBeenCalled();
});
