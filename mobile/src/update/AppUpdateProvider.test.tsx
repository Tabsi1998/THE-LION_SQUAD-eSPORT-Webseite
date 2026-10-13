import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import * as SecureStore from "expo-secure-store";
import { AppUpdateProvider } from "./AppUpdateProvider";
import { SNOOZE_KEY, SNOOZE_MS, type AppVersionInfo } from "../lib/appUpdate";
import { SEEN_BUILD_KEY } from "../lib/whatsnew";
import { liveGuestUser } from "../live";
import type { User } from "../types";

// Update-Prüfung je Installation (#1002) und „Später“ über einen Neustart hinweg (#1003).
// Eigener Build im Test: 63 (jest.setup.js), der Server bietet 64 an.

const mockAuth: { user: User | null } = { user: null };
jest.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

const mockGet = jest.fn();
jest.mock("../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));

const mockDetect = jest.fn();
const mockStartPlay = jest.fn();
jest.mock("../lib/installSource", () => ({
  detectInstallSource: () => mockDetect(),
  startPlayUpdate: (...args: unknown[]) => mockStartPlay(...args),
}));

jest.mock("../components/AppUpdateBanner", () => {
  const { Pressable, Text: RNText } = jest.requireActual("react-native");
  return {
    AppUpdateBanner: ({ release, mandatory, onLater }: { release: { build: number }; mandatory: boolean; onLater: () => void }) => (
      <Pressable testID="update-banner" onPress={onLater}>
        <RNText>{`Build ${release.build}${mandatory ? " Pflicht" : ""}`}</RNText>
      </Pressable>
    ),
  };
});
jest.mock("../components/WhatsNewCard", () => ({ WhatsNewCard: () => null }));

const member = { ...liveGuestUser, id: "u-1", username: "spieler", role: "player", user_type: "member" } as User;

function versionInfo(build = 64, mandatory = false): AppVersionInfo {
  return {
    current: { build, version: "1.4.0", notes: "- Neu", size: 1, filename: `LionsAPP-${build}.apk`, download_url: `/api/mobile/app-download/${build}` },
    update_available: true,
    mandatory,
  };
}

const sideload = { source: "sideload", updateAvailable: false, immediateAllowed: false, flexibleAllowed: false };
const devFlag = (global as unknown as { __DEV__: boolean });
let previousDev: boolean;

async function flush() {
  // Sicherer Speicher, Versionsabfrage und Installationsquelle antworten nacheinander - einmal durch die Ereignisschleife.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function mount() {
  const view = await render(
    <AppUpdateProvider>
      <Text>App</Text>
    </AppUpdateProvider>,
  );
  await flush();
  return view;
}

beforeEach(async () => {
  previousDev = devFlag.__DEV__;
  devFlag.__DEV__ = false;
  mockAuth.user = null;
  mockGet.mockReset().mockResolvedValue({ data: versionInfo() });
  mockDetect.mockReset().mockResolvedValue(sideload);
  mockStartPlay.mockReset().mockResolvedValue(true);
  await SecureStore.deleteItemAsync(SNOOZE_KEY);
  await SecureStore.deleteItemAsync(SEEN_BUILD_KEY);
});

afterEach(() => {
  devFlag.__DEV__ = previousDev;
});

describe("#1002 – Update-Prüfung auch für Gäste", () => {
  test("ein dauerhafter Gast fragt den Server und sieht das angebotene Update", async () => {
    mockAuth.user = liveGuestUser;
    await mount();
    expect(mockGet).toHaveBeenCalledWith("/mobile/app-version?build=63");
    expect(screen.getByText("Build 64")).toBeTruthy();
  });

  test("ein Gast sieht auch ein Pflicht-Update", async () => {
    mockAuth.user = liveGuestUser;
    mockGet.mockResolvedValue({ data: versionInfo(64, true) });
    await mount();
    expect(screen.getByText("Build 64 Pflicht")).toBeTruthy();
  });

  test("aus Google Play öffnet auch beim Gast Googles Dialog, ohne eigenen Hinweis", async () => {
    mockAuth.user = liveGuestUser;
    mockDetect.mockResolvedValue({ source: "play", updateAvailable: true, immediateAllowed: true, flexibleAllowed: true });
    await mount();
    expect(mockStartPlay).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("update-banner")).toBeNull();
  });

  test("Anmelden und Abmelden fragen nicht erneut und öffnen Googles Dialog nicht doppelt", async () => {
    mockAuth.user = liveGuestUser;
    mockDetect.mockResolvedValue({ source: "play", updateAvailable: true, immediateAllowed: false, flexibleAllowed: true });
    const view = await mount();
    mockAuth.user = member;
    await view.rerender(<AppUpdateProvider><Text>App</Text></AppUpdateProvider>);
    await flush();
    mockAuth.user = liveGuestUser;
    await view.rerender(<AppUpdateProvider><Text>App</Text></AppUpdateProvider>);
    await flush();
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockDetect).toHaveBeenCalledTimes(1);
    expect(mockStartPlay).toHaveBeenCalledTimes(1);
  });

  test("ohne Netz und ohne Play-Dienst bleibt die App für den Gast nutzbar", async () => {
    mockAuth.user = liveGuestUser;
    mockGet.mockRejectedValue(new Error("Network Error"));
    mockDetect.mockRejectedValue(new Error("Play nicht da"));
    await mount();
    expect(screen.getByText("App")).toBeTruthy();
    expect(screen.queryByTestId("update-banner")).toBeNull();
  });
});

describe("#1003 – „Später“ gilt auch nach einem Neustart", () => {
  beforeEach(() => {
    mockAuth.user = member;
  });

  test("„Später“ → Neustart: der Hinweis bleibt für denselben Build weg", async () => {
    await mount();
    await fireEvent.press(screen.getByTestId("update-banner"));
    await flush();
    expect(screen.queryByTestId("update-banner")).toBeNull();
    await cleanup();

    await mount();
    expect(screen.queryByTestId("update-banner")).toBeNull();
  });

  test("ein neuerer Build zeigt den Hinweis wieder", async () => {
    await SecureStore.setItemAsync(SNOOZE_KEY, JSON.stringify({ build: 64, at: Date.now() }));
    mockGet.mockResolvedValue({ data: versionInfo(65) });
    await mount();
    expect(screen.getByText("Build 65")).toBeTruthy();
  });

  test("nach Ablauf der Frist erscheint der Hinweis wieder", async () => {
    await SecureStore.setItemAsync(SNOOZE_KEY, JSON.stringify({ build: 64, at: Date.now() - SNOOZE_MS - 1000 }));
    await mount();
    expect(screen.getByText("Build 64")).toBeTruthy();
  });

  test("ein Pflicht-Update ignoriert den Aufschub", async () => {
    await SecureStore.setItemAsync(SNOOZE_KEY, JSON.stringify({ build: 64, at: Date.now() }));
    mockGet.mockResolvedValue({ data: versionInfo(64, true) });
    await mount();
    expect(screen.getByText("Build 64 Pflicht")).toBeTruthy();
  });

  test.each(["kaputt", "64", "{\"build\":\"x\"}", "{\"build\":64}", "null"])("ein ungültiger gespeicherter Wert (%s) stört nicht", async (raw) => {
    await SecureStore.setItemAsync(SNOOZE_KEY, raw);
    await mount();
    expect(screen.getByText("Build 64")).toBeTruthy();
  });

  test("„Später“ und „Was ist neu gesehen“ beeinflussen einander nicht", async () => {
    // „Was ist neu“ für den eigenen Build schon gesehen: das blendet den Update-Hinweis nicht aus.
    await SecureStore.setItemAsync(SEEN_BUILD_KEY, "63");
    await mount();
    expect(screen.getByText("Build 64")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("update-banner"));
    await flush();
    // „Später“ schreibt nur den eigenen Schlüssel.
    expect(await SecureStore.getItemAsync(SEEN_BUILD_KEY)).toBe("63");
    expect(JSON.parse(String(await SecureStore.getItemAsync(SNOOZE_KEY)))).toMatchObject({ build: 64 });
    await cleanup();

    await mount();
    expect(await SecureStore.getItemAsync(SEEN_BUILD_KEY)).toBe("63");
    expect(screen.queryByTestId("update-banner")).toBeNull();
  });
});
