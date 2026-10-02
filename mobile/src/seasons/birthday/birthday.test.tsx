import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";

// Vereinsgeburtstag in der App (S13 #644, B1–B3): die Karte einmal am Tag (nicht auf stillen Screens, nicht unter einem
// offenen Fenster), Kerzen nach Jahren gehen nacheinander an, dann ein leichtes Tippen und Konfetti aus der Torte;
// „dezent“ brennt gleich und feiert nicht. Mitglieder holen den Jahres-Sticker, andere sehen dafür nichts. Die
// Wimpelkette hängt an der Begrüßungskarte, je Jahr etwas anders.

const mockSeasonState: Record<string, unknown> = { ready: true, seasons: [], byKey: {}, preference: "on", setPreference: jest.fn(async () => {}), reducedMotion: false, reload: jest.fn(), toast: null, showToast: jest.fn(), weather: null, serverOffset: 0, serverNow: null };
const mockAuth: { user: Record<string, unknown> | null } = { user: null };
const mockApi = { get: jest.fn(), post: jest.fn() };
jest.mock("../SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../../lib/api", () => ({ api: mockApi }));
jest.mock("../../components/BrandLogo", () => ({ BrandLogo: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }) }));
jest.mock("../../navigation/rootNavigation", () => ({ navigationRef: { isReady: () => true, getCurrentRoute: () => ({ name: "Dashboard" }), addListener: () => () => {} } }));

const { BirthdayEdge, BirthdayGreeting, BirthdaySky, BirthdaySticker, CARD_DELAY_MS, GREETING_KEY, IGNITE_DELAY_MS, IGNITE_STEP_MS, cardText, edgePennants, resetBirthdayState, yearsOf } = require("./index");
const { requestConfettiBurst, resetCarnivalState } = require("../carnival");
const { SEASON_MODULES, appNamesSeason } = require("../SeasonStage");
const { resetQuiet, setOverlay } = require("../quiet");

function birthday(overrides: Record<string, unknown> = {}) {
  return { key: "club_birthday", label: "Vereinsgeburtstag", phase: "feier", intensity: "normal", effective: "normal", channels: ["web", "app"], texts: { greeting: "8 Jahre THE LION SQUAD – danke, dass ihr dabei seid" }, data: { years: 8, founded_on: "2019-03-01" }, starts_at: "2027-03-01T00:00:00+01:00", ends_at: "2027-03-01T23:59:59+01:00", forced: false, ...overrides };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

const litCount = () => screen.queryAllByTestId("birthday-flame", { includeHiddenElements: true }).length;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2027, 2, 1, 11, 0));
  resetBirthdayState();
  resetCarnivalState();
  resetQuiet();
  mockSeasonState.reducedMotion = false;
  mockAuth.user = null;
  mockApi.get.mockReset();
  mockApi.post.mockReset();
  (Haptics.impactAsync as jest.Mock).mockClear();
  (Haptics.notificationAsync as jest.Mock).mockClear();
  await SecureStore.deleteItemAsync(`season_greeting_${GREETING_KEY}`);
});

afterEach(() => {
  jest.useRealTimers();
});

test("die Bühne kennt den Vereinsgeburtstag: Konfetti, Karte und Wimpel an der Begrüßungskarte", () => {
  expect(Object.keys(SEASON_MODULES.club_birthday).sort()).toEqual(["Edge", "Greeting", "Sky"]);
  expect(appNamesSeason({ key: "club_birthday" })).toBe(true);
  expect(yearsOf(birthday())).toBe(8);
  expect(yearsOf(birthday({ data: {} }))).toBeNull();
  expect(cardText("8 Jahre THE LION SQUAD – danke, dass ihr dabei seid", 8)).toBe("Danke, dass ihr dabei seid");
  expect(cardText("Heute feiern wir!", 8)).toBe("Heute feiern wir!");
});

test("die Karte einmal am Tag: Kerzen nacheinander, dann ein leichtes Tippen; am selben Tag nicht noch einmal", async () => {
  const first = await render(<BirthdayGreeting season={birthday()} screen="Dashboard" />);
  await flush();
  expect(screen.queryByTestId("birthday-card")).toBeNull();
  await advance(CARD_DELAY_MS);
  expect(screen.getByTestId("birthday-card")).toBeTruthy();
  expect(screen.getByText("8 Jahre")).toBeTruthy();
  expect(screen.getByText("Danke, dass ihr dabei seid")).toBeTruthy();
  expect(litCount()).toBe(0);
  await advance(IGNITE_DELAY_MS + IGNITE_STEP_MS * 2 + 10);
  expect(litCount()).toBe(3);
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
  await advance(IGNITE_STEP_MS * 6 + 600);
  expect(litCount()).toBe(8);
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  await first.unmount();
  await render(<BirthdayGreeting season={birthday()} screen="Dashboard" />);
  await flush();
  await advance(5000);
  expect(screen.queryByTestId("birthday-card")).toBeNull();
});

test("„dezent“: alle Kerzen brennen gleich, kein Tippen; still nicht auf stillen Screens und nicht unter Fenstern", async () => {
  const view = await render(<BirthdayGreeting season={birthday({ effective: "subtle" })} screen="Settings" />);
  await flush();
  await advance(3000);
  expect(screen.queryByTestId("birthday-card")).toBeNull();
  setOverlay("sheet", true);
  await view.rerender(<BirthdayGreeting season={birthday({ effective: "subtle" })} screen="Dashboard" />);
  await flush();
  await advance(3000);
  expect(screen.queryByTestId("birthday-card")).toBeNull();
  await act(async () => {
    setOverlay("sheet", false);
  });
  await flush();
  await advance(CARD_DELAY_MS);
  expect(screen.getByTestId("birthday-card")).toBeTruthy();
  expect(litCount()).toBe(8);
  await advance(6000);
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
});

test("der Jahres-Sticker: Gäste und Nicht-Mitglieder sehen nichts, Mitglieder holen ihn ab", async () => {
  const guest = await render(<BirthdaySticker />);
  expect(screen.queryByTestId("birthday-sticker-claim")).toBeNull();
  expect(mockApi.get).not.toHaveBeenCalled();
  await guest.unmount();

  mockAuth.user = { id: "u1", is_club_member: false };
  mockApi.get.mockResolvedValue({ data: { active: true, member: false, claimed: false, sticker: null } });
  const outsider = await render(<BirthdaySticker />);
  await flush();
  expect(screen.queryByTestId("birthday-sticker-claim")).toBeNull();
  await outsider.unmount();

  mockAuth.user = { id: "u2", is_club_member: true };
  mockApi.get.mockResolvedValue({ data: { active: true, member: true, claimed: false, sticker: null } });
  mockApi.post.mockResolvedValue({ data: { new: true, sticker: { url: "/api/stickers/files/fluent/balloon.png", name: "Luftballon", pack_name: "Zum Vereinsgeburtstag" } } });
  await render(<BirthdaySticker />);
  await flush();
  await act(async () => {
    fireEvent.press(screen.getByTestId("birthday-sticker-claim"));
  });
  await flush();
  expect(mockApi.post).toHaveBeenCalledWith("/seasonal/birthday/sticker");
  expect(screen.getByTestId("birthday-sticker")).toBeTruthy();
  expect(screen.getByText("Dein Jahres-Sticker!")).toBeTruthy();
  expect(screen.getByText("Im Chat unter „Zum Vereinsgeburtstag“.")).toBeTruthy();
  expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
});

test("Konfetti nur aus der Torte: kein Regen beim Start, eine Explosion weckt die Ebene; „dezent“ gar keins", async () => {
  const view = await render(<BirthdaySky season={birthday()} screen="Dashboard" reducedMotion={false} />);
  await flush();
  expect(screen.queryByTestId("carnival-sky")).toBeNull();
  await act(async () => {
    requestConfettiBurst({ x: 120, y: 500 });
  });
  expect(screen.getByTestId("carnival-sky")).toBeTruthy();
  await view.unmount();
  await render(<BirthdaySky season={birthday({ effective: "subtle" })} screen="Dashboard" reducedMotion={false} />);
  await act(async () => {
    requestConfettiBurst({ x: 120, y: 500 });
  });
  expect(screen.queryByTestId("carnival-sky")).toBeNull();
});

test("die Wimpelkette: über die Breite der Karte, Vereinsfarben, je Jahr etwas anders", async () => {
  const list = edgePennants(360, 2027);
  expect(list.length).toBe(Math.round((360 - 28) / 18));
  expect(edgePennants(360, 2027)).toEqual(list);
  expect(edgePennants(360, 2028)).not.toEqual(list);
  expect(new Set(list.map((pennant: { color: string }) => pennant.color)).size).toBe(3);
  list.forEach((pennant: { x: number; y: number; size: number }) => {
    expect(pennant.x).toBeGreaterThan(14);
    expect(pennant.x).toBeLessThan(346);
    expect(pennant.y + pennant.size * 0.9).toBeLessThanOrEqual(16);
  });
  expect(edgePennants(60, 2027)).toEqual([]);
  await render(<BirthdayEdge season={birthday()} screen="Dashboard" />);
  await act(async () => {
    fireEvent(screen.getByTestId("birthday-edge"), "layout", { nativeEvent: { layout: { width: 360, height: 16 } } });
  });
  expect(screen.getAllByTestId("birthday-pennant")).toHaveLength(list.length);
});
