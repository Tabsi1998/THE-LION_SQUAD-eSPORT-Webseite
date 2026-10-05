import { renderHook } from "@testing-library/react-native";
import { Dimensions } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import { applyOrientation, isPhoneScreen, usePhonePortrait } from "./orientation";

// Ausrichtung (#917): Handys hochkant gesperrt, Tablets und aufgeklappte Faltgeräte frei - zur Laufzeit statt im
// Manifest, das Google Play beanstandet hat.

jest.mock("expo-screen-orientation", () => ({
  OrientationLock: { PORTRAIT_UP: 3 },
  lockAsync: jest.fn(async () => {}),
  unlockAsync: jest.fn(async () => {}),
}));

const lockAsync = ScreenOrientation.lockAsync as jest.Mock;
const unlockAsync = ScreenOrientation.unlockAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

test("unter 600 dp auf der kürzeren Seite ist es ein Handy - egal, wie es gerade gehalten wird", () => {
  expect(isPhoneScreen(412, 915)).toBe(true);
  expect(isPhoneScreen(915, 412)).toBe(true);
  expect(isPhoneScreen(600, 960)).toBe(false);
  expect(isPhoneScreen(1280, 800)).toBe(false);
});

test("Handy: hochkant sperren; Tablet: frei; ohne natives Modul kein Absturz", async () => {
  await applyOrientation(412, 915);
  expect(lockAsync).toHaveBeenCalledWith(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  await applyOrientation(800, 1280);
  expect(unlockAsync).toHaveBeenCalledTimes(1);
  lockAsync.mockRejectedValueOnce(new Error("kein natives Modul"));
  await expect(applyOrientation(390, 844)).resolves.toBeUndefined();
});

test("klappt ein Faltgerät auf, wird die Sperre gelöst; zu wieder gesperrt", async () => {
  const listeners: Array<(event: { screen: { width: number; height: number } }) => void> = [];
  const remove = jest.fn();
  jest.spyOn(Dimensions, "get").mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  jest.spyOn(Dimensions, "addEventListener").mockImplementation((_type, handler) => {
    listeners.push(handler as never);
    return { remove } as never;
  });

  const view = await renderHook(() => usePhonePortrait());
  expect(lockAsync).toHaveBeenCalledTimes(1);

  listeners[0]({ screen: { width: 884, height: 1104 } });
  await Promise.resolve();
  expect(unlockAsync).toHaveBeenCalledTimes(1);
  listeners[0]({ screen: { width: 390, height: 844 } });
  await Promise.resolve();
  expect(lockAsync).toHaveBeenCalledTimes(2);

  await view.unmount();
  expect(remove).toHaveBeenCalled();
});
