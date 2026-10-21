import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Passkey } from "react-native-passkey";
import { LoginScreen } from "./LoginScreen";

// Anmelden (#918, #919): kein „Live-Daten ansehen“ mehr - die App läuft ohne Konto. Einen Passkey bietet die Seite beim
// Öffnen selbst an; ohne Passkey bleibt still das Formular, nach einem Abbruch gibt es einen kleinen Link. Nach der
// Anmeldung geht es zurück, woher man kam.

const mockLoginWithPasskey = jest.fn();
const mockLogin = jest.fn();
const mockCompleteMfa = jest.fn();
jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ login: mockLogin, loginWithPasskey: mockLoginWithPasskey, completeMfa: mockCompleteMfa, rememberSession: true }),
}));
const mockPost = jest.fn(async (..._args: unknown[]) => ({ data: { ok: true } }));
jest.mock("../../lib/api", () => ({
  api: { post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: unknown, fallback: string) => {
    const detail = (error as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
    if (typeof detail === "string") return detail;
    return error instanceof Error ? error.message : fallback;
  },
}));
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

// Ein Wort je Sache (#1242): Die App sagt „Anmeldung“, nicht „Login“ - auch wenn die Anmeldung ohne Grund scheitert.
test("scheitert die Passwort-Anmeldung ohne Grund vom Server, steht „Anmeldung fehlgeschlagen.“ da", async () => {
  (Passkey.isSupported as jest.Mock).mockReturnValue(false);
  mockLogin.mockRejectedValueOnce({});
  await render(<LoginScreen navigation={navigation} />);
  await fireEvent.changeText(screen.getByLabelText("E-Mail"), "paula@club-mail.at");
  await fireEvent.changeText(screen.getByLabelText("Passwort"), "geheim");
  await fireEvent.press(screen.getByText("Anmelden"));
  expect(await screen.findByText("Anmeldung fehlgeschlagen.")).toBeTruthy();
  expect(screen.queryByText(/Login fehlgeschlagen/)).toBeNull();
  expect(navigation.goBack).not.toHaveBeenCalled();
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

// MFA (#995): der Code aus der Authenticator-App bleibt bequem (Ziffern, Autofill). Für einen Wiederherstellungscode
// (Buchstaben und Ziffern) gibt es eine eigene Eingabe mit voller Tastatur.
async function toMfa() {
  (Passkey.isSupported as jest.Mock).mockReturnValue(false);
  mockLogin.mockResolvedValueOnce({ mfaRequired: true, ticket: "ticket-1" });
  await render(<LoginScreen navigation={navigation} />);
  await fireEvent.changeText(screen.getByLabelText("E-Mail"), "paula@club-mail.at");
  await fireEvent.changeText(screen.getByLabelText("Passwort"), "geheim-geheim");
  await fireEvent.press(screen.getByText("Anmelden"));
  await waitFor(() => expect(screen.getByLabelText("Code aus der Authenticator-App")).toBeTruthy());
}

test("MFA: App-Code mit Ziffern und Autofill, Wiederherstellungscode mit Buchstaben eintippbar", async () => {
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  await toMfa();
  const totp = screen.getByLabelText("Code aus der Authenticator-App");
  expect(totp.props.keyboardType).toBe("number-pad");
  expect(totp.props.textContentType).toBe("oneTimeCode");
  expect(totp.props.autoComplete).toBe("one-time-code");
  expect(screen.getByText(/6 Ziffern/)).toBeTruthy();

  await fireEvent.press(screen.getByTestId("login-mfa-mode"));
  const recovery = screen.getByLabelText("Wiederherstellungscode");
  expect(recovery.props.keyboardType).toBe("default");
  expect(recovery.props.autoCapitalize).toBe("characters");
  expect(recovery.props.autoCorrect).toBe(false);
  expect(screen.getByText(/10 Zeichen aus Buchstaben und Ziffern/)).toBeTruthy();
  expect(screen.queryByLabelText("Code aus der Authenticator-App")).toBeNull();

  mockCompleteMfa.mockResolvedValueOnce(undefined);
  await fireEvent.changeText(recovery, " abcd-efgh23 ");
  await fireEvent.press(screen.getByText("MFA bestätigen"));
  await waitFor(() => expect(mockCompleteMfa).toHaveBeenCalledWith("ticket-1", "abcd-efgh23", true, false));
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  // Kein Code landet im Protokoll.
  for (const call of [...log.mock.calls, ...warn.mock.calls]) expect(JSON.stringify(call)).not.toMatch(/abcd/i);
  log.mockRestore();
  warn.mockRestore();
});

test("MFA: falscher oder verbrauchter Code - Satz des Servers, Eingabe bleibt offen", async () => {
  await toMfa();
  mockCompleteMfa.mockRejectedValueOnce({ response: { status: 401, data: { detail: "Ungültiger MFA- oder Wiederherstellungscode." } } });
  await fireEvent.changeText(screen.getByLabelText("Code aus der Authenticator-App"), "123456");
  await fireEvent.press(screen.getByText("MFA bestätigen"));
  expect(await screen.findByText("Ungültiger MFA- oder Wiederherstellungscode.")).toBeTruthy();
  expect(screen.getByLabelText("Code aus der Authenticator-App")).toBeTruthy();
  expect(navigation.goBack).not.toHaveBeenCalled();
});

test("MFA abgelaufen: zurück zum Formular mit Hinweis, „Anmelden“ holt eine neue Abfrage ohne Neustart", async () => {
  await toMfa();
  mockCompleteMfa.mockRejectedValueOnce({
    response: { status: 401, headers: { "x-auth-error": "mfa_challenge_invalid" }, data: { detail: "MFA-Anmeldung ist ungültig oder abgelaufen." } },
  });
  await fireEvent.changeText(screen.getByLabelText("Code aus der Authenticator-App"), "123456");
  await fireEvent.press(screen.getByText("MFA bestätigen"));
  await waitFor(() => expect(screen.getByLabelText("E-Mail")).toBeTruthy());
  expect(screen.getByText(/abgelaufen/)).toBeTruthy();
  // Gilt am Server schon nicht mehr - kein zusätzlicher Abbruch nötig.
  expect(mockPost).not.toHaveBeenCalled();
  expect(screen.getByLabelText("E-Mail").props.value).toBe("paula@club-mail.at");

  mockLogin.mockResolvedValueOnce({ mfaRequired: true, ticket: "ticket-2" });
  await fireEvent.press(screen.getByText("Anmelden"));
  await waitFor(() => expect(screen.getByLabelText("Code aus der Authenticator-App")).toBeTruthy());
  expect(screen.getByLabelText("Code aus der Authenticator-App").props.value).toBe("");
  mockCompleteMfa.mockResolvedValueOnce(undefined);
  await fireEvent.changeText(screen.getByLabelText("Code aus der Authenticator-App"), "654321");
  await fireEvent.press(screen.getByText("MFA bestätigen"));
  await waitFor(() => expect(mockCompleteMfa).toHaveBeenCalledWith("ticket-2", "654321", true, false));
});

test("MFA abbrechen: zurück zum Formular, ohne Ticket und ohne Code - und die Abfrage gilt am Server nicht mehr", async () => {
  await toMfa();
  await fireEvent.changeText(screen.getByLabelText("Code aus der Authenticator-App"), "12");
  await fireEvent.press(screen.getByTestId("login-mfa-restart"));
  expect(screen.getByLabelText("E-Mail")).toBeTruthy();
  expect(screen.queryByText("MFA bestätigen")).toBeNull();
  expect(mockCompleteMfa).not.toHaveBeenCalled();
  expect(mockPost).toHaveBeenCalledWith("/auth/mfa/cancel", { ticket: "ticket-1" });
});

test("Seite verlassen während der MFA-Abfrage: die Abfrage wird am Server verworfen; nach Erfolg nicht", async () => {
  await toMfa();
  await screen.unmount();
  expect(mockPost).toHaveBeenCalledWith("/auth/mfa/cancel", { ticket: "ticket-1" });

  mockPost.mockClear();
  await toMfa();
  mockCompleteMfa.mockResolvedValueOnce(undefined);
  await fireEvent.changeText(screen.getByLabelText("Code aus der Authenticator-App"), "123456");
  await fireEvent.press(screen.getByText("MFA bestätigen"));
  await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
  await screen.unmount();
  expect(mockPost).not.toHaveBeenCalled();
});

// Wege aus der Anmeldung (#996): Passwort vergessen und fehlende Bestätigungs-Mail haben einen sichtbaren nächsten Schritt.
test("Passwort vergessen und Bestätigungs-Mail: sichtbar, mit der getippten E-Mail", async () => {
  (Passkey.isSupported as jest.Mock).mockReturnValue(false);
  await render(<LoginScreen navigation={navigation} />);
  await fireEvent.changeText(screen.getByLabelText("E-Mail"), " paula@club-mail.at ");
  await fireEvent.press(screen.getByText("Passwort vergessen?"));
  expect(navigation.navigate).toHaveBeenCalledWith("LoginHelp", { kind: "password", email: "paula@club-mail.at" });
  await fireEvent.press(screen.getByText("Keine Bestätigungs-Mail bekommen?"));
  expect(navigation.navigate).toHaveBeenCalledWith("LoginHelp", { kind: "verification", email: "paula@club-mail.at" });
});

test("E-Mail noch nicht bestätigt: die Anmeldung zeigt gleich den Weg zur Bestätigungs-Mail", async () => {
  (Passkey.isSupported as jest.Mock).mockReturnValue(false);
  mockLogin.mockRejectedValueOnce({
    response: { status: 403, headers: { "x-auth-error": "email_verification_required" }, data: { detail: "E-Mail-Adresse noch nicht bestätigt. Bitte fordere einen Bestätigungslink an." } },
  });
  await render(<LoginScreen navigation={navigation} />);
  await fireEvent.changeText(screen.getByLabelText("E-Mail"), "paula@club-mail.at");
  await fireEvent.changeText(screen.getByLabelText("Passwort"), "geheim-geheim");
  await fireEvent.press(screen.getByText("Anmelden"));
  await waitFor(() => expect(screen.getByTestId("login-verification-recovery")).toBeTruthy());
  await fireEvent.press(screen.getByText("Bestätigungslink anfordern"));
  expect(navigation.navigate).toHaveBeenCalledWith("LoginHelp", { kind: "verification", email: "paula@club-mail.at" });
});

test("Passkey unbekannt oder abgebrochen blockiert die Wege nicht", async () => {
  const unknown = { response: { status: 401, headers: { "x-passkey-error": "unknown-credential" }, data: { detail: "Diesen Passkey kennt lionsquad.at nicht (mehr)." } } };
  mockLoginWithPasskey.mockRejectedValueOnce(unknown);
  await render(<LoginScreen navigation={navigation} />);
  await waitFor(() => expect(screen.getByTestId("login-passkey-unknown")).toBeTruthy());
  await fireEvent.press(screen.getByText("Passwort vergessen?"));
  expect(navigation.navigate).toHaveBeenCalledWith("LoginHelp", { kind: "password", email: "" });

  // Abgebrochen: die Fehlermeldung des Passkeys steht da, die Wege bleiben.
  mockLoginWithPasskey.mockRejectedValueOnce({ error: "UserCancelled" });
  await fireEvent.press(screen.getByTestId("login-passkey-link"));
  await waitFor(() => expect(screen.getByText("Passkey-Vorgang abgebrochen.")).toBeTruthy());
  await fireEvent.press(screen.getByText("Keine Bestätigungs-Mail bekommen?"));
  expect(navigation.navigate).toHaveBeenCalledWith("LoginHelp", { kind: "verification", email: "" });
});
