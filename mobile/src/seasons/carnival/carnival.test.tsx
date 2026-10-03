import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";

// Fasching in der App (S12 #643, F1–F3 #745–#747): Konfetti beim ersten Start des Tages (Skia, nicht auf stillen
// Screens, nie bei „dezent“ oder „Bewegung reduzieren“), einige Stücke liegen kurz auf der Tab-Leiste und verblassen;
// der Partyhut im Kopf wippt, tippt leicht und wirft Konfetti - höchstens alle zehn Sekunden; Luftschlangen je nach
// Screen-Klasse, beim ersten Mal entfaltet; der Gruß einmal am Tag, nicht unter einem offenen Fenster.

const mockSeasonState: Record<string, unknown> = { ready: true, seasons: [], byKey: {}, preference: "on", setPreference: jest.fn(async () => {}), reducedMotion: false, reload: jest.fn(), toast: null, showToast: jest.fn(), weather: null, serverOffset: 0, serverNow: null };
jest.mock("../SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }) }));
jest.mock("../../navigation/rootNavigation", () => ({ navigationRef: { isReady: () => true, getCurrentRoute: () => ({ name: "Dashboard" }), addListener: () => () => {} } }));

const {
  CarnivalCorners, CarnivalGreeting, ConfettiSky, GREETING_KEY, HAT_COOLDOWN_MS, PartyHatTabIcon, PartyHatWidget, RAIN_KEY, STREAMER_BOX, UNFOLD_KEY,
  appStreamerPath, appStreamerPlan, rainAllowed, requestConfettiBurst, resetCarnivalState, streamersFor, tabBarLedge,
} = require("./index");
const { APP_BURST, FADE_MS, REST_MS, addFlying, capForApp, confettiIdle, emptyConfetti, flyingFrom, stepConfetti } = require("./sky");
const { burstPieces, rainPieces } = require("./confetti");
const { mulberry32 } = require("../rng");
const { SEASON_MODULES, appNamesSeason } = require("../SeasonStage");
const { resetQuiet, setOverlay } = require("../quiet");

function carnival(overrides: Record<string, unknown> = {}) {
  return { key: "carnival", label: "Fasching", phase: "deko", intensity: "normal", effective: "normal", channels: ["web", "app"], texts: { greeting: "Schönen Fasching" }, data: {}, starts_at: "2027-02-09T00:00:00+01:00", ends_at: "2027-02-09T23:59:59+01:00", forced: false, ...overrides };
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

async function frames(count: number, ms = 100) {
  const { __frameCallbacks } = require("react-native-reanimated");
  for (let i = 0; i < count; i += 1) {
    await act(async () => {
      jest.advanceTimersByTime(ms);
      __frameCallbacks.forEach(({ callback, handle }: { callback: () => void; handle: { isActive: boolean } }) => handle.isActive && callback());
    });
  }
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2027, 1, 9, 10, 0));
  resetCarnivalState();
  resetQuiet();
  mockSeasonState.reducedMotion = false;
  mockSeasonState.weather = null;
  (Haptics.impactAsync as jest.Mock).mockClear();
  for (const key of [RAIN_KEY, UNFOLD_KEY, GREETING_KEY]) await SecureStore.deleteItemAsync(`season_greeting_${key}`);
});

afterEach(() => {
  jest.useRealTimers();
});

test("die Bühne kennt Fasching: Himmel, Ecken, Kopf, Tab-Symbol und Gruß; er steht unter „Gerade läuft“", () => {
  expect(Object.keys(SEASON_MODULES.carnival).sort()).toEqual(["Corners", "Greeting", "Sky", "TabIcon", "Widget"]);
  expect(appNamesSeason({ key: "carnival" })).toBe(true);
});

test("Stücke je Gerät: 60 normal, 100 kräftig, keine bei „dezent“; Regen nur auf lebendigen und mittleren Screens", () => {
  expect([capForApp("normal"), capForApp("full"), capForApp("subtle"), capForApp("off")]).toEqual([60, 100, 0, 0]);
  expect(rainAllowed("Dashboard")).toBe(true);
  expect(rainAllowed("TeamDetail")).toBe(true);
  expect(rainAllowed("DirectThread")).toBe(false);
  expect(rainAllowed("Settings")).toBe(false);
});

test("Ebene: nie mehr als erlaubt, mit dem Scrollen verschoben, kurz auf der Tab-Leiste liegend, dann Ruhe", () => {
  const size = { width: 390, height: 844 };
  const ledge = tabBarLedge(390, 844, 16);
  expect(ledge).toEqual({ left: 0, right: 390, top: 844 - 62 - 16 });
  const rng = mulberry32(5);
  let state = addFlying(emptyConfetti(), flyingFrom(rainPieces(rng, size, 80), 0, rng), 60);
  expect(state.flying).toHaveLength(60);
  state = addFlying(state, flyingFrom(burstPieces(rng, { x: 100, y: 100 }, APP_BURST), 0, rng), 60);
  expect(state.flying).toHaveLength(60);
  // Gescrollt: alles Fliegende rückt mit dem Screen nach oben.
  state = stepConfetti(state, 500, size, 0, ledge, 30);
  expect(state.flying.every((item: { shift: number }) => item.shift === -30)).toBe(true);
  let landed = 0;
  for (let now = 600; now < 8000 && !landed; now += 50) {
    state = stepConfetti(state, now, size, 0, ledge, 0);
    landed = state.resting.length;
  }
  expect(landed).toBeGreaterThan(0);
  // Liegende Stücke liegen flach (lange Seite waagrecht) auf der Kante.
  state.resting.forEach((rest: { top: number; piece: { w: number; h: number } }) => {
    expect(rest.top).toBe(ledge.top);
    expect(rest.piece.w).toBeGreaterThanOrEqual(rest.piece.h);
  });
  for (let now = 8000; now < 8000 + 14000 + REST_MS[1] + FADE_MS + 100; now += 100) state = stepConfetti(state, now, size, 0, ledge, 0);
  expect(confettiIdle(state)).toBe(true);
});

test("Regen beim ersten Start des Tages: Skia zeichnet; ein zweiter Start am selben Tag regnet nicht mehr", async () => {
  const skia = require("@shopify/react-native-skia");
  const first = await render(<ConfettiSky season={carnival()} screen="Dashboard" reducedMotion={false} />);
  await flush();
  expect(screen.getByTestId("carnival-sky")).toBeTruthy();
  const before = skia.__skiaDraws.rects + skia.__skiaDraws.circles + skia.__skiaDraws.paths;
  await frames(12);
  expect(skia.__skiaDraws.rects + skia.__skiaDraws.circles + skia.__skiaDraws.paths).toBeGreaterThan(before + 20);
  expect(await SecureStore.getItemAsync(`season_greeting_${RAIN_KEY}`)).toBe("2027-02-09");
  // Nach dem Regen schläft die Ebene: keine Zeichenfläche mehr.
  await frames(200);
  expect(screen.queryByTestId("carnival-sky")).toBeNull();
  await first.unmount();
  resetCarnivalState();
  await render(<ConfettiSky season={carnival()} screen="Dashboard" reducedMotion={false} />);
  await flush();
  expect(screen.queryByTestId("carnival-sky")).toBeNull();
});

test("kein Regen auf stillen Screens - er kommt auf dem ersten Screen, wo er fallen darf", async () => {
  const view = await render(<ConfettiSky season={carnival()} screen="Settings" reducedMotion={false} />);
  await flush();
  expect(screen.queryByTestId("carnival-sky")).toBeNull();
  await view.rerender(<ConfettiSky season={carnival()} screen="NewsList" reducedMotion={false} />);
  await flush();
  expect(screen.getByTestId("carnival-sky")).toBeTruthy();
});

test("„dezent“ und „Bewegung reduzieren“: kein Konfetti, auch nicht auf Zuruf des Huts", async () => {
  const view = await render(<ConfettiSky season={carnival({ effective: "subtle" })} screen="Dashboard" reducedMotion={false} />);
  await flush();
  requestConfettiBurst({ x: 100, y: 100 });
  await flush();
  expect(screen.queryByTestId("carnival-sky")).toBeNull();
  await view.rerender(<ConfettiSky season={carnival()} screen="Dashboard" reducedMotion />);
  await flush();
  requestConfettiBurst({ x: 100, y: 100 });
  await flush();
  expect(screen.queryByTestId("carnival-sky")).toBeNull();
});

test("Explosion auf Zuruf weckt die schlafende Ebene", async () => {
  await SecureStore.setItemAsync(`season_greeting_${RAIN_KEY}`, "2027-02-09");
  await render(<ConfettiSky season={carnival()} screen="Dashboard" reducedMotion={false} />);
  await flush();
  expect(screen.queryByTestId("carnival-sky")).toBeNull();
  await act(async () => {
    requestConfettiBurst({ x: 200, y: 120 });
  });
  expect(screen.getByTestId("carnival-sky")).toBeTruthy();
});

test("der Hut im Kopf: wippt, tippt leicht - höchstens alle zehn Sekunden; „dezent“ nur ein Bild", async () => {
  const view = await render(<PartyHatWidget season={carnival()} screen="Dashboard" />);
  const hat = screen.getByRole("button", { name: "Partyhut – Konfetti werfen" });
  await act(async () => {
    fireEvent.press(hat);
  });
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.setSystemTime(Date.now() + HAT_COOLDOWN_MS - 1);
    fireEvent.press(hat);
  });
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.setSystemTime(Date.now() + 1);
    fireEvent.press(hat);
  });
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
  await view.rerender(<PartyHatWidget season={carnival({ effective: "subtle" })} screen="Dashboard" />);
  expect(screen.queryByRole("button")).toBeNull();
  // Nur ein Bild: für Bedienhilfen ausgeblendet, aber zu sehen.
  expect(screen.getByTestId("carnival-hat-widget", { includeHiddenElements: true })).toBeTruthy();
  mockSeasonState.reducedMotion = true;
  await view.rerender(<PartyHatWidget season={carnival()} screen="Dashboard" />);
  expect(screen.queryByRole("button")).toBeNull();
});

test("Luftschlangen: je Jahr und Screen fest, schmal genug für den Rand; lebendig zwei, mittel eine (rechts), still keine", async () => {
  const plan = appStreamerPlan(2027, "Dashboard");
  expect(appStreamerPlan(2027, "Dashboard")).toEqual(plan);
  expect(appStreamerPlan(2028, "Dashboard")).not.toEqual(plan);
  for (const streamer of plan) {
    const xs = appStreamerPath(streamer).slice(2).split(" L ").map((pair: string) => Number(pair.split(" ")[0]));
    expect(Math.min(...xs) - 1.7).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs) + 1.7).toBeLessThanOrEqual(STREAMER_BOX);
    expect(streamer.offset + STREAMER_BOX).toBeLessThanOrEqual(18);
  }
  expect(streamersFor(plan, "Dashboard", "normal")).toHaveLength(2);
  expect(streamersFor(plan, "TeamDetail", "normal").map((streamer: { side: string }) => streamer.side)).toEqual(["right"]);
  expect(streamersFor(plan, "DirectThread", "normal")).toEqual([]);
  expect(streamersFor(plan, "Settings", "normal")).toEqual([]);

  await render(<CarnivalCorners season={carnival()} screen="Dashboard" />);
  await flush();
  expect(screen.getAllByTestId("carnival-streamer")).toHaveLength(2);
  expect(await SecureStore.getItemAsync(`season_greeting_${UNFOLD_KEY}`)).toBe("2027-02-09");
});

test("der Gruß einmal am Tag: nach anderthalb Sekunden, zehn Sekunden lang; nicht unter einem offenen Fenster", async () => {
  setOverlay("sheet", true);
  const view = await render(<CarnivalGreeting season={carnival({ texts: { greeting: "Helau und Alaaf!" } })} screen="Dashboard" />);
  await flush();
  await advance(3000);
  expect(screen.queryByTestId("carnival-toast")).toBeNull();
  await act(async () => {
    setOverlay("sheet", false);
  });
  await flush();
  await advance(1500);
  expect(screen.getByTestId("carnival-toast")).toBeTruthy();
  expect(screen.getByText("Helau und Alaaf!")).toBeTruthy();
  await advance(10000);
  expect(screen.queryByTestId("carnival-toast")).toBeNull();
  await view.unmount();
  await render(<CarnivalGreeting season={carnival()} screen="Dashboard" />);
  await flush();
  await advance(3000);
  expect(screen.queryByTestId("carnival-toast")).toBeNull();
});

test("das Tab-Symbol ist der Hut", async () => {
  await render(<PartyHatTabIcon size={24} />);
  expect(screen.getByTestId("carnival-tab-hat")).toBeTruthy();
});
