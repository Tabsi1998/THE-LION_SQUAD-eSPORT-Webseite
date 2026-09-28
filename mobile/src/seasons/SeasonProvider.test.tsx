import React from "react";
import { Text } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";

// Jahreszeiten in der App (#636): nur Saisonen mit Kanal „app“, Stärke nur leiser, Wahl aus Konto oder
// Gerät, angemeldet wird sie ins Konto geschrieben.

const mockApi = { get: jest.fn(), patch: jest.fn() };
jest.mock("../lib/api", () => ({ api: mockApi }));
const mockAuthState: { user: Record<string, unknown> | null; refreshMe: jest.Mock } = { user: null, refreshMe: jest.fn(async () => {}) };
jest.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuthState }));
let mockReduce = false;
jest.mock("../components/FadeIn", () => ({ useReduceMotion: () => mockReduce }));

const { SeasonProvider, useSeason, effectiveIntensity, refreshDelayFor, PREFERENCE_KEY, REFRESH_MS, FAST_REFRESH_MS } = require("./SeasonProvider");

const PAYLOAD = { seasons: [
  { key: "halloween", label: "Halloween", phase: "deko", intensity: "full", channels: ["web", "app"], texts: {}, data: { night: true }, starts_at: "", ends_at: "", forced: false },
  { key: "snow", label: "Schnee", phase: "schnee", intensity: "normal", channels: ["web"], texts: {}, data: {}, starts_at: "", ends_at: "", forced: false },
] };

function Probe() {
  const { seasons, preference, setPreference, ready } = useSeason();
  return (
    <>
      <Text testID="ready">{String(ready)}</Text>
      <Text testID="keys">{seasons.map((s: { key: string; effective: string }) => `${s.key}:${s.effective}`).join(",")}</Text>
      <Text testID="pref">{preference}</Text>
      <Text testID="set" onPress={() => { void setPreference("subtle"); }}>dezent</Text>
    </>
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockAuthState.user = null;
  mockReduce = false;
  mockApi.get.mockResolvedValue({ data: PAYLOAD });
  mockApi.patch.mockResolvedValue({ data: {} });
  await SecureStore.deleteItemAsync(PREFERENCE_KEY);
});

test("Stärke nur leiser; Takt zehn Minuten, um Mitternacht 30 Sekunden", () => {
  expect(effectiveIntensity({ intensity: "full" }, "on", false)).toBe("full");
  expect(effectiveIntensity({ intensity: "full" }, "on", true)).toBe("subtle");
  expect(effectiveIntensity({ intensity: "full" }, "off", false)).toBe("off");
  expect(refreshDelayFor([])).toBe(REFRESH_MS);
  expect(refreshDelayFor([{ key: "new_year", phase: "show" }])).toBe(FAST_REFRESH_MS);
});

test("nur Kanal app, Wahl vom Gerät", async () => {
  await SecureStore.setItemAsync(PREFERENCE_KEY, "subtle");
  await render(<SeasonProvider><Probe /></SeasonProvider>);
  await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"));
  expect(mockApi.get).toHaveBeenCalledWith("/seasonal/active");
  await waitFor(() => expect(screen.getByTestId("pref")).toHaveTextContent("subtle"));
  expect(screen.getByTestId("keys")).toHaveTextContent("halloween:subtle");
});

test("angemeldet zählt das Konto, die Wahl geht ins Konto", async () => {
  mockAuthState.user = { id: "u1", user_type: "member", seasonal_decorations: "on" };
  await render(<SeasonProvider><Probe /></SeasonProvider>);
  await waitFor(() => expect(screen.getByTestId("keys")).toHaveTextContent("halloween:full"));
  await fireEvent.press(screen.getByTestId("set"));
  await waitFor(() => expect(mockApi.patch).toHaveBeenCalledWith("/users/me", { seasonal_decorations: "subtle" }));
  await waitFor(() => expect(mockAuthState.refreshMe).toHaveBeenCalled());
  expect(await SecureStore.getItemAsync(PREFERENCE_KEY)).toBe("subtle");
});

test("Bewegung reduzieren macht alles dezent", async () => {
  mockReduce = true;
  await render(<SeasonProvider><Probe /></SeasonProvider>);
  await waitFor(() => expect(screen.getByTestId("keys")).toHaveTextContent("halloween:subtle"));
});

test("Serverfehler heißt keine Deko, die App läuft weiter", async () => {
  mockApi.get.mockRejectedValue(new Error("offline"));
  await render(<SeasonProvider><Probe /></SeasonProvider>);
  await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"));
  expect(screen.getByTestId("keys")).toHaveTextContent("");
});
