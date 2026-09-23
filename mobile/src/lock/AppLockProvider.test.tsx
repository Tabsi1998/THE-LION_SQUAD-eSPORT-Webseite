import React from "react";
import { AppState, Text } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { AppLockProvider, useAppLock } from "./AppLockProvider";
import { LockScreen } from "../screens/LockScreen";

// App-Sperre (#217): Einschalten verlangt den Fingerabdruck, beim Start ist gesperrt, nach einer
// Minute im Hintergrund wieder - und ohne Bildschirmsperre am Gerät gibt es keine Sperre.

const mockLogout = jest.fn();
jest.mock("../auth/AuthContext", () => ({ useAuth: () => ({ logout: mockLogout }) }));
jest.mock("../branding/BrandingProvider", () => ({ useBranding: () => ({ clubName: "LION", logoUrl: "", mascotUrl: "", loaded: false }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

function Probe() {
  const lock = useAppLock();
  return (
    <>
      <Text testID="state">{`${lock.ready ? "bereit" : "lade"}|${lock.enabled ? "an" : "aus"}|${lock.locked ? "gesperrt" : "offen"}`}</Text>
      <Text testID="on" onPress={() => void lock.setEnabled(true)}>an</Text>
      <Text testID="off" onPress={() => void lock.setEnabled(false)}>aus</Text>
      {lock.locked ? <LockScreen /> : null}
    </>
  );
}

let clock = 1_000_000;
let appStateListener: ((state: string) => void) | null = null;
let appStateSpy: jest.SpyInstance | null = null;

beforeEach(async () => {
  jest.clearAllMocks();
  clock = 1_000_000;
  appStateListener = null;
  appStateSpy = jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, listener: (state: string) => void) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  }) as never);
  await SecureStore.deleteItemAsync("tls.mobile.appLock");
});

afterEach(() => {
  appStateSpy?.mockRestore();
});

function renderLock() {
  return render(
    <AppLockProvider now={() => clock}>
      <Probe />
    </AppLockProvider>,
  );
}

test("ohne Schalter bleibt alles offen und niemand wird gefragt", async () => {
  await renderLock();
  await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("bereit|aus|offen"));
  expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
});

test("Einschalten verlangt einmal den Fingerabdruck – abgebrochen bleibt aus, bestätigt wird gespeichert", async () => {
  await renderLock();
  await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("bereit|aus|offen"));

  (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false, error: "user_cancel" });
  await fireEvent.press(screen.getByTestId("on"));
  await waitFor(() => expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId("state")).toHaveTextContent("bereit|aus|offen");
  expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith("tls.mobile.appLock", "true");

  await fireEvent.press(screen.getByTestId("on"));
  await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("bereit|an|offen"));
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith("tls.mobile.appLock", "true");

  await fireEvent.press(screen.getByTestId("off"));
  await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("bereit|aus|offen"));
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith("tls.mobile.appLock", "false");
});

test("mit Schalter: beim Start gesperrt, der Sperrbildschirm fragt selbst, nach einer Minute im Hintergrund wieder gesperrt", async () => {
  await SecureStore.setItemAsync("tls.mobile.appLock", "true");
  (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false, error: "user_cancel" });
  await renderLock();
  await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("bereit|an|gesperrt"));
  // Der erste Versuch kam vom Sperrbildschirm selbst und wurde abgebrochen.
  await waitFor(() => expect(screen.getByTestId("lock-failed")).toBeTruthy());
  expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByText("Entsperren"));
  await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("bereit|an|offen"));

  // 30 Sekunden weg: bleibt offen. Über eine Minute: gesperrt.
  expect(appStateListener).not.toBeNull();
  expect(AppState.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  await act(async () => appStateListener?.("background"));
  clock += 30_000;
  await act(async () => appStateListener?.("active"));
  expect(screen.getByTestId("state")).toHaveTextContent("bereit|an|offen");

  // Der Sperrbildschirm fragt beim Erscheinen selbst - hier bricht die Person ab, damit gesperrt bleibt.
  (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false, error: "user_cancel" });
  await act(async () => appStateListener?.("background"));
  clock += 61_000;
  await act(async () => appStateListener?.("active"));
  await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("bereit|an|gesperrt"));

  // Abmelden geht immer - auch gesperrt.
  await fireEvent.press(screen.getByText("Abmelden"));
  expect(mockLogout).toHaveBeenCalled();
});

test("ohne Bildschirmsperre am Gerät gilt auch eine gespeicherte Sperre nicht, und einschalten geht nicht", async () => {
  (LocalAuthentication.getEnrolledLevelAsync as jest.Mock).mockResolvedValueOnce(LocalAuthentication.SecurityLevel.NONE);
  await SecureStore.setItemAsync("tls.mobile.appLock", "true");
  await renderLock();
  await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("bereit|aus|offen"));

  await fireEvent.press(screen.getByTestId("on"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByTestId("state")).toHaveTextContent("bereit|aus|offen");
  expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
});
