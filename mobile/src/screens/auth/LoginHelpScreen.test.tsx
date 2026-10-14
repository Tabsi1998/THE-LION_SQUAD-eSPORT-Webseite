import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { WEB_BASE_URL } from "../../lib/siteUrls";
import { LoginHelpScreen } from "./LoginHelpScreen";

// Passwort vergessen und Bestätigungs-Mail (#996): die App fordert die Mail über denselben Server-Weg an wie die Website.
// Der Link in der Mail öffnet die Website; danach geht es zurück in die App zum Anmelden. Wer lieber gleich im Browser
// weitermacht, kommt auf die vorhandene Seite der Website.

const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: { response?: { data?: { detail?: string } } } | null, fallback: string) => error?.response?.data?.detail ?? fallback,
}));

const navigation = { popTo: jest.fn(), goBack: jest.fn() };
const route = (kind: "password" | "verification", email?: string) => ({ key: "LoginHelp-1", name: "LoginHelp" as const, params: { kind, email } });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});

function show(kind: "password" | "verification", email?: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<LoginHelpScreen navigation={navigation as any} route={route(kind, email)} />);
}

test("Passwort vergessen: E-Mail aus der Anmeldung, Link anfordern, Rückweg und Passwort-Regel erklärt", async () => {
  mockPost.mockResolvedValueOnce({ data: { ok: true, message: "Falls diese E-Mail registriert ist, wurde ein Link gesendet." } });
  await show("password", "paula@club-mail.at");
  expect(screen.getByLabelText("E-Mail").props.value).toBe("paula@club-mail.at");
  await fireEvent.press(screen.getByText("Link senden"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/auth/forgot-password", { email: "paula@club-mail.at" }));
  expect(await screen.findByTestId("login-help-sent")).toHaveTextContent(/wurde ein Link gesendet/);
  // Wie es weitergeht: im Browser ein neues Passwort setzen, dann hier anmelden - mit dem Vertrag aus #1509.
  expect(screen.getByTestId("login-help-next")).toHaveTextContent(/Browser/);
  expect(screen.getByTestId("login-help-next")).toHaveTextContent(/App/);
  expect(screen.getByText(/Mindestens 10 Zeichen, höchstens 72 Byte/)).toBeTruthy();
  await fireEvent.press(screen.getByText("Zur Anmeldung"));
  expect(navigation.popTo).toHaveBeenCalledWith("Login");
});

test("Bestätigungs-Mail: derselbe Weg wie die Website, danach zurück zur Anmeldung", async () => {
  mockPost.mockResolvedValueOnce({ data: { ok: true, message: "Falls eine Bestätigung aussteht, wurde der Versand angefordert." } });
  await show("verification", "paula@club-mail.at");
  await fireEvent.press(screen.getByText("Bestätigungslink anfordern"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/auth/resend-verification", { email: "paula@club-mail.at" }));
  expect(await screen.findByTestId("login-help-sent")).toHaveTextContent(/Versand angefordert/);
  expect(screen.getByTestId("login-help-next")).toHaveTextContent(/App/);
});

test("ohne gültige E-Mail: Hinweis am Feld, keine Anfrage", async () => {
  await show("password");
  await fireEvent.press(screen.getByText("Link senden"));
  expect(screen.getByText("Bitte gib deine E-Mail-Adresse ein.")).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText("E-Mail"), "paula@");
  await fireEvent.press(screen.getByText("Link senden"));
  expect(screen.getByText("Bitte gib eine gültige E-Mail-Adresse ein.")).toBeTruthy();
  expect(mockPost).not.toHaveBeenCalled();
});

test("Server lehnt ab (zu viele Anfragen): Satz des Servers, erneut möglich", async () => {
  mockPost.mockRejectedValueOnce({ response: { status: 429, data: { detail: "Zu viele Anfragen. Bitte warte kurz." } } });
  await show("password", "paula@club-mail.at");
  await fireEvent.press(screen.getByText("Link senden"));
  expect(await screen.findByText("Zu viele Anfragen. Bitte warte kurz.")).toBeTruthy();
  expect(screen.queryByTestId("login-help-sent")).toBeNull();
  expect(screen.getByText("Link senden")).toBeTruthy();
});

test("lieber im Browser: die vorhandenen Seiten der Website", async () => {
  await show("password");
  await fireEvent.press(screen.getByTestId("login-help-browser"));
  expect(Linking.openURL).toHaveBeenCalledWith(`${WEB_BASE_URL}/forgot-password`);
  await show("verification");
  await fireEvent.press(screen.getByTestId("login-help-browser"));
  expect(Linking.openURL).toHaveBeenCalledWith(`${WEB_BASE_URL}/verify-email`);
});
