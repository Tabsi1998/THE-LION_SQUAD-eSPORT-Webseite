import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Passkey } from "react-native-passkey";
import { PasskeysCard } from "./PasskeysCard";

// Passkeys im Profil (#919): dieselben wie auf der Website - anlegen und entfernen, beides mit dem aktuellen Passwort.
// Bietet der Server keine Passkeys für die App an, fehlt die Karte ganz.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: { response?: { data?: { detail?: string } } }, fallback: string) => error?.response?.data?.detail || fallback,
}));

const WEB = { id: "cred-web", name: "Laptop", created_at: "2026-09-01T10:00:00Z", last_used_at: "2026-10-01T10:00:00Z" };
let rows: Array<typeof WEB | { id: string; name: string; created_at: string; last_used_at: null }>;

beforeEach(() => {
  jest.clearAllMocks();
  rows = [WEB];
  (Passkey.isSupported as jest.Mock).mockReturnValue(true);
  mockGet.mockImplementation(async (url: string) => (url === "/auth/passkeys/status" ? { data: { enabled: true, app: true } } : { data: rows }));
  mockPost.mockImplementation(async (url: string) => {
    if (url.endsWith("/register/options")) return { data: { ticket: "reg-1", options: { challenge: "c" } } };
    if (url.endsWith("/register/verify")) {
      rows = [{ id: "cred-app", name: "LionsAPP (Android)", created_at: "2026-10-05T10:00:00Z", last_used_at: null }, WEB];
    }
    if (url.endsWith("/remove")) rows = rows.filter((row) => !url.includes(row.id));
    return { data: { ok: true } };
  });
});

test("ohne Passkeys für die App auf dem Server fehlt die Karte", async () => {
  mockGet.mockImplementation(async () => ({ data: { enabled: true, app: false } }));
  await render(<PasskeysCard />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/auth/passkeys/status"));
  expect(screen.queryByTestId("passkeys")).toBeNull();
  expect(mockGet).not.toHaveBeenCalledWith("/auth/passkeys");
});

test("anlegen: erst das Passwort, dann der Fingerabdruck - der neue Passkey steht danach in der Liste", async () => {
  await render(<PasskeysCard />);
  await waitFor(() => expect(screen.getByText("Laptop")).toBeTruthy());
  expect(screen.getByText(/Zuletzt benutzt am/)).toBeTruthy();

  await fireEvent.press(screen.getByTestId("passkey-add"));
  expect(screen.getByText("Zum Anlegen bitte dein aktuelles Passwort.")).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText("Aktuelles Passwort"), "geheim-42");
  await fireEvent.press(screen.getByTestId("passkey-confirm"));

  await waitFor(() => expect(screen.getByText("LionsAPP (Android)")).toBeTruthy());
  expect(mockPost).toHaveBeenNthCalledWith(1, "/auth/passkeys/mobile/register/options", { enroll_ticket: "", current_password: "geheim-42", name: "LionsAPP (Android)" });
  expect(Passkey.create).toHaveBeenCalledWith({ challenge: "c" });
  expect(screen.getByTestId("passkeys-message").props.children).toMatch(/Passkey angelegt/);
  expect(screen.queryByLabelText("Aktuelles Passwort")).toBeNull();
});

test("entfernen fragt das Passwort; ein falsches meldet der Server wörtlich, das richtige entfernt", async () => {
  await render(<PasskeysCard />);
  await waitFor(() => expect(screen.getByTestId("passkey-remove-cred-web")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("passkey-remove-cred-web"));
  expect(screen.getByText("„Laptop“ entfernen? Bitte dein aktuelles Passwort.")).toBeTruthy();

  mockPost.mockRejectedValueOnce({ response: { status: 401, data: { detail: "Bitte bestätige dein aktuelles Passwort." } } });
  await fireEvent.changeText(screen.getByLabelText("Aktuelles Passwort"), "falsch");
  await fireEvent.press(screen.getByTestId("passkey-confirm"));
  await waitFor(() => expect(screen.getByText("Bitte bestätige dein aktuelles Passwort.")).toBeTruthy());
  expect(screen.getByText("Laptop")).toBeTruthy();

  await fireEvent.changeText(screen.getByLabelText("Aktuelles Passwort"), "geheim-42");
  await fireEvent.press(screen.getByTestId("passkey-confirm"));
  await waitFor(() => expect(screen.getByTestId("passkeys-empty")).toBeTruthy());
  expect(mockPost).toHaveBeenLastCalledWith("/auth/passkeys/mobile/cred-web/remove", { current_password: "geheim-42" });
  expect(screen.getByText("Passkey entfernt.")).toBeTruthy();
});

test("ein Gerät ohne Passkeys kann nichts anlegen, aber die Liste bleibt", async () => {
  (Passkey.isSupported as jest.Mock).mockReturnValue(false);
  await render(<PasskeysCard />);
  await waitFor(() => expect(screen.getByText("Laptop")).toBeTruthy());
  expect(screen.queryByTestId("passkey-add")).toBeNull();
  expect(screen.getByText("Dieses Gerät kann keine Passkeys anlegen.")).toBeTruthy();
});
