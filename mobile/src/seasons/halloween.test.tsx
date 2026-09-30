import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";

// Halloween in der App (#636, #655, #665): je Screen eine andere, stabile Anordnung, unabhängig von der Stärke
// gewürfelt; das runde Netz wird Schritt für Schritt gesponnen oder steht fertig da; Spinne am Faden vom oberen
// Rand; Abseil-Spinne mit Zustandsfolge; Fledermäuse zum Antippen; Friedhof mit Geistern und Sperre; Kürbis mit
// Gruß, Haptik und Signal; Fledermäuse nicht bei „Bewegung reduzieren“ oder dezent.

const mockSignals = { recordSignal: jest.fn(async () => true) };
jest.mock("./signals", () => mockSignals);
jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: "light" } }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }) }));
const mockSeasonState: Record<string, unknown> = { reducedMotion: false, showToast: jest.fn(), toast: null };
jest.mock("./SeasonProvider", () => ({ useSeason: () => mockSeasonState }));

const { HalloweenWidget, HalloweenCorners, HalloweenBats, OrbWeb, RappelSpider, pumpkinCounts, screenLayout, setYearSalt, GHOST_COOLDOWN_MS } = require("./halloween");
// Festes Jahres-Salz (C4): die Anordnung je Screen hängt sonst vom Kalenderjahr ab.
setYearSalt("abnahme");
const { buildPlan, stepDurationMs, webRadius } = require("./webPlan");
const { createMotionScheduler, resetMotionScheduler } = require("./motion");
const { resetPerches } = require("./perches");
const { resetFlights } = require("./flights");

// Bewegungsbudget (A3): in diesen Tests darf alles sofort - der Planer hat seine eigenen Tests.
beforeEach(() => {
  resetMotionScheduler(createMotionScheduler({ unlimited: true, appState: null }));
  resetPerches();
  resetFlights();
});
afterAll(() => resetMotionScheduler(null));

const SCREENS = ["Dashboard", "Tournaments", "Events", "News", "Teams", "More", "Profile", "Calendar", "Achievements", "Settings", "Chat", "Members", "Gallery", "Servers"];

function season(overrides: Record<string, unknown> = {}) {
  return { key: "halloween", label: "Halloween", phase: "deko", intensity: "normal", effective: "normal", channels: ["app"], texts: { greeting: "Happy Halloween von THE LION SQUAD" }, data: { night: true }, starts_at: "", ends_at: "", forced: false, ...overrides };
}

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockSeasonState.reducedMotion = false;
});

test("Anordnung je Screen: gleich für denselben, anders für einen anderen, dezent nur ruhiger", () => {
  const home = screenLayout("Dashboard", "normal");
  expect(screenLayout("Dashboard", "normal")).toEqual(home);
  expect(JSON.stringify(screenLayout("Tournaments", "normal"))).not.toBe(JSON.stringify(home));
  expect(["tl", "tr"]).toContain(home.web.corner);
  expect(home.web.factor).toBeGreaterThanOrEqual(0.85);
  expect(home.spider).not.toBeNull();
  expect(home.spider.offset).toBeGreaterThanOrEqual(0.03);
  expect(home.spider.offset).toBeLessThanOrEqual(0.12);
  const subtle = screenLayout("Dashboard", "subtle");
  expect(subtle.web.corner).toBe(home.web.corner);
  expect(subtle.web.seed).toBe(home.web.seed);
  expect(subtle.web.build).toBe(false);
  expect(subtle.spider).toBeNull();
  expect(subtle.crawler).toBeNull();
  expect(subtle.rappel).toBeNull();
  expect(subtle.hangingBats).toEqual([]);
  expect(subtle.graves).toEqual([]);
  const full = screenLayout("Dashboard", "full");
  expect(full.crawler).not.toBeNull();
  expect(full.hangingBats.length).toBeGreaterThanOrEqual(1);
  const layouts = SCREENS.map((name) => screenLayout(name, "normal"));
  expect(layouts.some((layout) => layout.web.build)).toBe(true);
  expect(layouts.some((layout) => layout.rappel)).toBe(true);
  expect(layouts.some((layout) => layout.hangingBats.length > 0)).toBe(true);
  expect(layouts.some((layout) => layout.graves.length > 0)).toBe(true);
  expect(new Set(layouts.map((layout) => layout.web.corner)).size).toBe(2);
});

test("Signal nur am 31. Oktober ab 18 Uhr", () => {
  expect(pumpkinCounts(new Date(2026, 9, 31, 18))).toBe(true);
  expect(pumpkinCounts(new Date(2026, 9, 31, 17, 59))).toBe(false);
  expect(pumpkinCounts(new Date(2026, 9, 30, 20))).toBe(false);
});

test("Kürbis: Gruß als Overlay, Haptik, Signal abends am 31.10.", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 31, 20));
  await render(<HalloweenWidget season={season()} screen="Dashboard" />);
  const lantern = screen.getByTestId("halloween-lantern");
  expect(lantern.props.accessibilityLabel).toBe("Happy Halloween von THE LION SQUAD");
  await fireEvent.press(lantern);
  expect(mockSeasonState.showToast).toHaveBeenCalledWith("Happy Halloween von THE LION SQUAD");
  expect(Haptics.impactAsync).toHaveBeenCalled();
  expect(mockSignals.recordSignal).toHaveBeenCalledWith("halloween_pumpkin");
});

test("vor dem 31. zählt der Klick nicht", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 27, 12));
  await render(<HalloweenWidget season={season()} screen="Dashboard" />);
  await fireEvent.press(screen.getByTestId("halloween-lantern"));
  expect(mockSignals.recordSignal).not.toHaveBeenCalled();
});

test("Netzbau: Schritt für Schritt nach der Uhr, am Ende fertig; ohne Bau oder bei Bewegung reduzieren sofort fertig", async () => {
  jest.useFakeTimers();
  const web = { corner: "tl", factor: 1, seed: 0.42, build: true };
  await render(<OrbWeb web={web} width={360} reduced={false} />);
  expect(screen.getByTestId("halloween-web-building")).toBeTruthy();
  const plan = buildPlan(0.42);
  const radius = webRadius(360, 1);
  const longest = plan.order.reduce((max: number, step: { from: number; to: number; walk?: boolean }) => Math.max(max, stepDurationMs(plan, step, radius)), 0);
  // Jeder Schritt hängt am vorigen (Zustand → Effekt → nächste Uhr), also Schritt für Schritt vorspulen.
  for (let n = 0; n < 10; n += 1) {
    await act(async () => {
      jest.advanceTimersByTime(longest + 5);
    });
  }
  expect(screen.getByTestId("halloween-web-building")).toBeTruthy();
  for (let n = 0; n < plan.order.length + 5 && screen.queryByTestId("halloween-web-built") === null; n += 1) {
    await act(async () => {
      jest.advanceTimersByTime(longest + 5);
    });
  }
  expect(screen.getByTestId("halloween-web-built")).toBeTruthy();
  await screen.unmount();
  await render(<OrbWeb web={{ ...web, build: false }} width={360} reduced={false} />);
  expect(screen.getByTestId("halloween-web-built")).toBeTruthy();
  await screen.unmount();
  await render(<OrbWeb web={web} width={360} reduced />);
  expect(screen.getByTestId("halloween-web-built")).toBeTruthy();
});

test("Ecken: Netz immer, Spinne am Faden und Gräber nur mit Bewegung; dezent zeigt das fertige Netz", async () => {
  const name = SCREENS.find((candidate) => {
    const layout = screenLayout(candidate, "normal");
    return layout.graves.length > 0 && layout.hangingBats.length > 0;
  }) as string;
  expect(name).toBeTruthy();
  const layout = screenLayout(name, "normal");
  await render(<HalloweenCorners season={season({ effective: "subtle" })} screen={name} />);
  expect(screen.getByTestId("halloween-corners")).toBeTruthy();
  expect(screen.getByTestId("halloween-web-built")).toBeTruthy();
  expect(screen.queryByTestId(`halloween-spider-${layout.spider.side}`)).toBeNull();
  expect(screen.queryByTestId("halloween-graveyard")).toBeNull();
  expect(screen.queryAllByTestId("halloween-bat-hanging").length).toBe(0);
  await screen.unmount();
  await render(<HalloweenCorners season={season({ effective: "normal" })} screen={name} />);
  expect(screen.getByTestId(`halloween-spider-${layout.spider.side}`)).toBeTruthy();
  expect(screen.getAllByTestId("halloween-grave").length).toBe(layout.graves.length);
  expect(screen.getAllByTestId("halloween-bat-hanging").length).toBe(layout.hangingBats.length);
  expect(screen.queryByTestId("halloween-crawler")).toBeNull();
});

test("Krabbler kommt nach der Wartezeit", async () => {
  jest.useFakeTimers();
  // Auf dem Höhepunkt (full) hat jeder lebendige Screen einen Krabbler - unabhängig vom Jahres-Salz (C4).
  const name = SCREENS.find((candidate) => screenLayout(candidate, "full").crawler) as string;
  const layout = screenLayout(name, "full");
  expect(layout.crawler).toBeTruthy();
  await render(<HalloweenCorners season={season({ effective: "full" })} screen={name} />);
  expect(screen.queryByTestId("halloween-crawler")).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(layout.crawler.firstMs + 50);
  });
  expect(screen.getByTestId("halloween-crawler")).toBeTruthy();
});

test("Fledermaus antippen: Haptik, sie fliegt davon und ist danach weg", async () => {
  jest.useFakeTimers();
  const name = SCREENS.find((candidate) => screenLayout(candidate, "normal").hangingBats.length > 0) as string;
  const count = screenLayout(name, "normal").hangingBats.length;
  await render(<HalloweenCorners season={season({ effective: "normal" })} screen={name} />);
  expect(screen.getAllByTestId("halloween-bat-hanging").length).toBe(count);
  await fireEvent.press(screen.getAllByTestId("halloween-bat-hanging")[0]);
  expect(Haptics.impactAsync).toHaveBeenCalled();
  // Jede verscheuchte Fledermaus zählt als Fundstück (#678) - jedes Mal, nicht nur einmal am Tag.
  expect(mockSignals.recordSignal).toHaveBeenCalledTimes(1);
  expect(mockSignals.recordSignal).toHaveBeenCalledWith("halloween_bats_scared", { onceIf: false });
  expect(screen.queryAllByTestId("halloween-bat-hanging").length).toBe(count - 1);
  expect(screen.getByTestId("halloween-bat-flying")).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(2900);
  });
  expect(screen.queryByTestId("halloween-bat-flying")).toBeNull();
  expect(screen.queryAllByTestId("halloween-bat-hanging").length).toBe(count - 1);
});

test("Grab antippen: ein Geist steigt auf, das zweite Mal erst nach der Sperre, der Geist verschwindet wieder", async () => {
  jest.useFakeTimers();
  const name = SCREENS.find((candidate) => screenLayout(candidate, "normal").graves.length > 0) as string;
  await render(<HalloweenCorners season={season({ effective: "normal" })} screen={name} />);
  const graves = screen.getAllByTestId("halloween-grave");
  await fireEvent.press(graves[0]);
  expect(screen.getAllByTestId("halloween-ghost").length).toBe(1);
  await fireEvent.press(graves[0]);
  expect(screen.getAllByTestId("halloween-ghost").length).toBe(1);
  await fireEvent.press(graves[1]);
  expect(screen.getAllByTestId("halloween-ghost").length).toBe(2);
  // Jeder befreite Geist zählt als Fundstück (#678) - das Antippen in der Sperrzeit nicht.
  expect(mockSignals.recordSignal).toHaveBeenCalledTimes(2);
  expect(mockSignals.recordSignal).toHaveBeenLastCalledWith("halloween_ghosts_freed", { onceIf: false });
  await act(async () => {
    jest.advanceTimersByTime(6100);
  });
  expect(screen.queryAllByTestId("halloween-ghost").length).toBe(0);
  await act(async () => {
    jest.advanceTimersByTime(GHOST_COOLDOWN_MS);
  });
  await fireEvent.press(graves[0]);
  expect(screen.getAllByTestId("halloween-ghost").length).toBe(1);
});

test("Abseil-Spinne: Faden wächst vom oberen Rand, unten lässt sie los und läuft", async () => {
  jest.useFakeTimers();
  await render(<RappelSpider spec={{ side: "left", size: 24, speed: 400, first: 0.1, rest: 5 }} width={360} floorY={500} reduced={false} />);
  expect(screen.queryByTestId("halloween-rappel")).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  const thread = screen.getByTestId("halloween-rappel");
  expect(thread.props.style).toEqual(expect.objectContaining({ left: expect.any(Number), height: expect.any(Number) }));
  await act(async () => {
    jest.advanceTimersByTime(2500);
  });
  expect(screen.getByTestId("halloween-rappel-runner")).toBeTruthy();
});

test("Bewegung reduzieren: keine Spinne, keine Fledermäuse, Netz gleich fertig", async () => {
  mockSeasonState.reducedMotion = true;
  const name = SCREENS.find((candidate) => screenLayout(candidate, "full").web.build && screenLayout(candidate, "full").hangingBats.length > 0) as string;
  const layout = screenLayout(name, "full");
  await render(<HalloweenCorners season={season({ effective: "full" })} screen={name} />);
  expect(screen.queryByTestId(`halloween-spider-${layout.spider.side}`)).toBeNull();
  expect(screen.queryByTestId("halloween-web-building")).toBeNull();
  expect(screen.getByTestId("halloween-web-built")).toBeTruthy();
  expect(screen.queryAllByTestId("halloween-bat-hanging").length).toBe(0);
});

test("Fledermäuse: nicht bei Bewegung reduzieren oder dezent, sonst nach drei Sekunden", async () => {
  jest.useFakeTimers();
  await render(<HalloweenBats season={season()} screen="Dashboard" reducedMotion />);
  expect(screen.queryByTestId("halloween-bats")).toBeNull();
  await screen.unmount();
  await render(<HalloweenBats season={season({ effective: "subtle" })} screen="Dashboard" reducedMotion={false} />);
  expect(screen.queryByTestId("halloween-bats")).toBeNull();
  await screen.unmount();
  await render(<HalloweenBats season={season({ effective: "full", data: { night: false } })} screen="Dashboard" reducedMotion={false} />);
  expect(screen.queryByTestId("halloween-bats")).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(3100);
  });
  expect(screen.getByTestId("halloween-bats")).toBeTruthy();
});
