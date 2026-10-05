import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { Passkey } from "react-native-passkey";
import { inviteKey, PasskeyInvite } from "./PasskeyInvite";

// Passkey-Einladung (#919): direkt nach einer Anmeldung mit Passwort - nur wenn das Konto noch keinen Passkey hat.
// Angelegt wird mit dem Ticket der Anmeldung, ohne das Passwort noch einmal zu verlangen; „Später“ gilt je Konto.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
}));
const mockAuth = { passkeyOffer: { ticket: "enroll-1", userId: "u-1" } as { ticket: string; userId: string } | null, clearPasskeyOffer: jest.fn() };
jest.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.passkeyOffer = { ticket: "enroll-1", userId: "u-1" };
  (Passkey.isSupported as jest.Mock).mockReturnValue(true);
  mockGet.mockResolvedValue({ data: [] });
  mockPost.mockImplementation(async (url: string) => (url.endsWith("/register/options") ? { data: { ticket: "reg-1", options: { challenge: "c" } } } : { data: { ok: true } }));
});

test("ohne Passkey lädt die App ein; „Passkey anlegen“ nimmt das Ticket der Anmeldung, nicht das Passwort", async () => {
  await render(<PasskeyInvite />);
  await waitFor(() => expect(screen.getByText("Nächstes Mal nur mit Fingerabdruck?")).toBeTruthy());
  expect(mockGet).toHaveBeenCalledWith("/auth/passkeys");

  await fireEvent.press(screen.getByTestId("passkey-invite-create"));
  await waitFor(() => expect(screen.getByText("Passkey angelegt")).toBeTruthy());
  expect(mockPost).toHaveBeenNthCalledWith(1, "/auth/passkeys/mobile/register/options", { enroll_ticket: "enroll-1", current_password: "", name: "LionsAPP (Android)" });
  expect(Passkey.create).toHaveBeenCalledWith({ challenge: "c" });
  expect(mockPost).toHaveBeenNthCalledWith(2, "/auth/passkeys/mobile/register/verify", expect.objectContaining({ ticket: "reg-1" }));
  expect(mockAuth.clearPasskeyOffer).toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId("passkey-invite-done"));
  expect(screen.queryByTestId("passkey-invite")).toBeNull();
});

test("hat das Konto schon einen Passkey (etwa von der Website), bleibt es still", async () => {
  mockGet.mockResolvedValue({ data: [{ id: "cred-web", name: "Laptop" }] });
  await render(<PasskeyInvite />);
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
  expect(screen.queryByTestId("passkey-invite")).toBeNull();
});

test("„Später“ gilt für dieses Konto auf diesem Gerät; ein anderes Konto wird trotzdem eingeladen", async () => {
  const first = await render(<PasskeyInvite />);
  await waitFor(() => expect(screen.getByTestId("passkey-invite-later")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("passkey-invite-later"));
  await waitFor(() => expect(mockAuth.clearPasskeyOffer).toHaveBeenCalled());
  expect(await SecureStore.getItemAsync(inviteKey("u-1"))).toBe("true");
  expect(mockPost).not.toHaveBeenCalled();
  await first.unmount();

  mockGet.mockClear();
  const again = await render(<PasskeyInvite />);
  await waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith(inviteKey("u-1")));
  expect(mockGet).not.toHaveBeenCalled();
  expect(screen.queryByTestId("passkey-invite")).toBeNull();
  await again.unmount();

  mockAuth.passkeyOffer = { ticket: "enroll-2", userId: "u-2" };
  await render(<PasskeyInvite />);
  await waitFor(() => expect(screen.getByTestId("passkey-invite")).toBeTruthy());
});

test("abgebrochen am Gerät: ein ruhiger Satz mit dem Weg ins Profil; ohne Offerte oder Passkey-Unterstützung gar nichts", async () => {
  (Passkey.create as jest.Mock).mockRejectedValueOnce({ error: "UserCancelled" });
  const first = await render(<PasskeyInvite />);
  await waitFor(() => expect(screen.getByTestId("passkey-invite-create")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("passkey-invite-create"));
  await waitFor(() => expect(screen.getByText(/Abgebrochen – anlegen kannst du den Passkey jederzeit im Profil unter „Einstellungen“/)).toBeTruthy());
  expect(mockAuth.clearPasskeyOffer).not.toHaveBeenCalled();
  await first.unmount();

  (Passkey.isSupported as jest.Mock).mockReturnValue(false);
  const unsupported = await render(<PasskeyInvite />);
  expect(screen.queryByTestId("passkey-invite")).toBeNull();
  await unsupported.unmount();

  (Passkey.isSupported as jest.Mock).mockReturnValue(true);
  mockAuth.passkeyOffer = null;
  mockGet.mockClear();
  await render(<PasskeyInvite />);
  expect(mockGet).not.toHaveBeenCalled();
  expect(screen.queryByTestId("passkey-invite")).toBeNull();
});
