import React from "react";
import { act, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";

// Ostern in der App (S14 #645, E1 #753, E4 #756): im Register; die Ohren im Kopf zucken auf Antippen (leichtes
// Tippen, höchstens alle vier Sekunden) und sind still nur ein Bild; die Eier-Reihe an der Begrüßungskarte; das
// Osterei am Tab; Blätter nur mit Bewegung; Karfreitag still; der Gruß am Ostersonntag und -montag einmal.

const mockSeasonState: Record<string, unknown> = { ready: true, seasons: [], byKey: {}, preference: "on", setPreference: jest.fn(async () => {}), reducedMotion: false, reload: jest.fn(), toast: null, showToast: jest.fn(), weather: null };
jest.mock("../SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }) }));
jest.mock("../../navigation/rootNavigation", () => ({ navigationRef: { isReady: () => true, getCurrentRoute: () => ({ name: "Dashboard" }), addListener: () => () => {} } }));

const { EasterBackdrop, EasterEdge, EasterGreeting, EasterSky, EasterTabIcon, GREETING_KEY, TOAST_DELAY_MS, TOAST_MS } = require("./index");
const { SEASON_MODULES, appNamesSeason } = require("../SeasonStage");

const SUNDAY = "2027-03-28";

function easter(overrides: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
  return { key: "easter", label: "Ostern", phase: "deko", intensity: "normal", effective: "normal", channels: ["web", "app"], texts: { greeting: "Frohe Ostern wünscht THE LION SQUAD" }, data: { quiet: false, sunday: SUNDAY, ...data }, starts_at: "2027-03-21T00:00:00+01:00", ends_at: "2027-03-29T23:59:59+02:00", forced: false, ...overrides };
}

async function flushStorage() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2027-03-24T10:00:00+01:00"));
  mockSeasonState.reducedMotion = false;
  (SecureStore.getItemAsync as jest.Mock).mockReset?.();
  (SecureStore.setItemAsync as jest.Mock).mockReset?.();
  (Haptics.impactAsync as jest.Mock).mockClear?.();
});

afterEach(() => {
  jest.useRealTimers();
});

test("im Register: Kante, Eier an Karten, Gruß, Himmel, Tab-Symbol - keine Hasenohren mehr (#857) - und die App nennt Ostern als laufend", () => {
  expect(Object.keys(SEASON_MODULES.easter).sort()).toEqual(["Backdrop", "Corners", "Edge", "Greeting", "Sky", "TabIcon"]);
  expect(appNamesSeason({ key: "easter" })).toBe(true);
});

test("die Eier-Reihe an der Begrüßungskarte: verschiedene Muster, nicht auf stillen Screens; das Osterei am Tab", async () => {
  await render(<EasterEdge season={easter()} screen="Dashboard" />);
  const eggs = screen.getAllByTestId(/^easter-egg-art-/).map((node) => String(node.props.testID));
  expect(eggs.length).toBeGreaterThanOrEqual(4);
  expect(new Set(eggs).size).toBe(eggs.length);
  await screen.unmount();
  await render(<EasterEdge season={easter()} screen="AdminHome" />);
  expect(screen.queryByTestId("easter-edge")).toBeNull();
  await screen.unmount();
  await render(<EasterTabIcon size={24} />);
  expect(screen.getByTestId("easter-tab-egg")).toBeTruthy();
});

test("Frühlingslicht hinter dem Inhalt - nicht auf stillen Screens", async () => {
  await render(<EasterBackdrop season={easter()} screen="Dashboard" />);
  expect(screen.getByTestId("easter-light")).toBeTruthy();
  await screen.unmount();
  await render(<EasterBackdrop season={easter()} screen="AdminHome" />);
  expect(screen.queryByTestId("easter-light")).toBeNull();
});

test("Himmel: Blätter nur mit Bewegung und nicht am Karfreitag", async () => {
  await render(<EasterSky season={easter()} screen="Dashboard" reducedMotion={false} />);
  expect(screen.getByTestId("easter-petals")).toBeTruthy();
  expect(screen.getAllByTestId(/^easter-petal-/).length).toBe(4);
  await screen.unmount();
  await render(<EasterSky season={easter()} screen="Dashboard" reducedMotion />);
  expect(screen.queryByTestId("easter-sky")).toBeNull();
  await screen.unmount();
  await render(<EasterSky season={easter({}, { quiet: true })} screen="Dashboard" reducedMotion={false} />);
  expect(screen.queryByTestId("easter-sky")).toBeNull();
});

test("bei „voll“ flattert nach einer Weile ein Zitronenfalter vorbei", async () => {
  await render(<EasterSky season={easter({ effective: "full" })} screen="Dashboard" reducedMotion={false} />);
  expect(screen.queryByTestId("easter-butterfly")).toBeNull();
  await advance(41000);
  expect(screen.getByTestId("easter-butterfly")).toBeTruthy();
});

test("der Gruß am Ostersonntag einmal je Tag - davor und am Karfreitag nicht", async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  await render(<EasterGreeting season={easter()} screen="Dashboard" />);
  await flushStorage();
  await advance(TOAST_DELAY_MS + 10);
  expect(screen.queryByTestId("easter-toast")).toBeNull();
  await screen.unmount();

  jest.setSystemTime(new Date("2027-03-26T10:00:00+01:00"));
  await render(<EasterGreeting season={easter({}, { quiet: true })} screen="Dashboard" />);
  await flushStorage();
  await advance(TOAST_DELAY_MS + 10);
  expect(screen.queryByTestId("easter-toast")).toBeNull();
  await screen.unmount();

  jest.setSystemTime(new Date("2027-03-28T10:00:00+02:00"));
  await render(<EasterGreeting season={easter()} screen="Dashboard" />);
  await flushStorage();
  await advance(TOAST_DELAY_MS + 10);
  expect(screen.getByTestId("easter-toast").props.accessibilityLabel).toContain("Frohe Ostern wünscht THE LION SQUAD");
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(expect.stringContaining(GREETING_KEY), "2027-03-28");
  await advance(TOAST_MS + 10);
  expect(screen.queryByTestId("easter-toast")).toBeNull();
});
