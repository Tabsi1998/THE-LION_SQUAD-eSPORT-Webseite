import { AppState } from "react-native";
import { DeviceMotion } from "expo-sensors";
import { FULL_AT, SMOOTHING, UPDATE_MS, smoothTilt, tiltFromRotation, tiltSource } from "./tilt";

// Neigungssensor (#667): Neigung aus der Lage, weich geglättet und begrenzt; ein Sensor für alle Zuhörer, aus ohne
// Zuhörer und im Hintergrund; ohne Sensor am Gerät bleibt alles bei 0.

type Listener = (measurement: { rotation: { alpha: number; beta: number; gamma: number } }) => void;

function lastListener(): Listener {
  const calls = (DeviceMotion.addListener as jest.Mock).mock.calls;
  return calls[calls.length - 1][0] as Listener;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  (DeviceMotion.isAvailableAsync as jest.Mock).mockResolvedValue(true);
});

test("Neigung aus der Lage: seitlich aus gamma, vorn/hinten gegenüber der Ruhelage, voll bei etwa 25 Grad, begrenzt", () => {
  expect(tiltFromRotation({ alpha: 0, beta: 0, gamma: 0 })).toEqual({ x: 0, y: 0 });
  expect(tiltFromRotation({ beta: 0, gamma: FULL_AT / 2 })).toEqual({ x: 0.5, y: 0 });
  expect(tiltFromRotation({ beta: 0, gamma: -FULL_AT * 3 })).toEqual({ x: -1, y: 0 });
  const pitched = tiltFromRotation({ beta: 1 + FULL_AT / 4, gamma: 0 }, 1);
  expect(pitched.x).toBe(0);
  expect(pitched.y).toBeCloseTo(0.25, 6);
  expect(tiltFromRotation({ beta: Number.NaN, gamma: null })).toEqual({ x: 0, y: 0 });
  expect(tiltFromRotation(null)).toEqual({ x: 0, y: 0 });
});

test("glätten: ein Teil des Wegs je Messung, kleine Reste fallen auf 0", () => {
  const step = smoothTilt({ x: 0, y: 0 }, { x: 1, y: -1 });
  expect(step).toEqual({ x: SMOOTHING, y: -SMOOTHING });
  expect(smoothTilt({ x: 0.001, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  let current = { x: 0, y: 0 };
  for (let i = 0; i < 40; i += 1) current = smoothTilt(current, { x: 1, y: 0 });
  expect(current.x).toBeGreaterThan(0.99);
});

test("ein Sensor für alle: startet mit dem ersten Zuhörer, 15 Messungen je Sekunde, aus mit dem letzten", async () => {
  const seen: Array<{ x: number; y: number }> = [];
  const stopA = tiltSource.subscribe((tilt) => seen.push(tilt));
  expect(seen).toEqual([{ x: 0, y: 0 }]);
  await flush();
  expect(DeviceMotion.setUpdateInterval).toHaveBeenCalledWith(UPDATE_MS);
  expect(DeviceMotion.addListener).toHaveBeenCalledTimes(1);
  const stopB = tiltSource.subscribe(() => {});
  await flush();
  expect(DeviceMotion.addListener).toHaveBeenCalledTimes(1);

  lastListener()({ rotation: { alpha: 0, beta: 0.9, gamma: FULL_AT } });
  expect(seen[seen.length - 1].x).toBeCloseTo(SMOOTHING, 3);
  expect(seen[seen.length - 1].y).toBe(0);
  for (let i = 0; i < 30; i += 1) lastListener()({ rotation: { alpha: 0, beta: 0.9, gamma: FULL_AT } });
  expect(seen[seen.length - 1].x).toBeGreaterThan(0.99);
  expect(tiltSource.value.x).toBeGreaterThan(0.99);

  const removed = (DeviceMotion.addListener as jest.Mock).mock.results[0].value.remove as jest.Mock;
  stopA();
  expect(removed).not.toHaveBeenCalled();
  stopB();
  expect(removed).toHaveBeenCalled();
  expect(tiltSource.value).toEqual({ x: 0, y: 0 });
});

test("im Hintergrund hört der Sensor auf und die Neigung geht auf 0; vorne geht es weiter", async () => {
  const states: string[] = [];
  const appState = jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    states.push("listening");
    (appState as unknown as { handler: (status: string) => void }).handler = handler as (status: string) => void;
    return { remove: jest.fn() } as never;
  });
  const seen: Array<{ x: number; y: number }> = [];
  const stop = tiltSource.subscribe((tilt) => seen.push(tilt));
  await flush();
  for (let i = 0; i < 30; i += 1) lastListener()({ rotation: { alpha: 0, beta: 0, gamma: -FULL_AT } });
  expect(seen[seen.length - 1].x).toBeLessThan(-0.99);
  const removed = (DeviceMotion.addListener as jest.Mock).mock.results[0].value.remove as jest.Mock;
  (appState as unknown as { handler: (status: string) => void }).handler("background");
  expect(removed).toHaveBeenCalled();
  expect(seen[seen.length - 1]).toEqual({ x: 0, y: 0 });
  (appState as unknown as { handler: (status: string) => void }).handler("active");
  await flush();
  expect(DeviceMotion.addListener).toHaveBeenCalledTimes(2);
  stop();
  appState.mockRestore();
});

test("ohne Sensor am Gerät bleibt alles still bei 0", async () => {
  (DeviceMotion.isAvailableAsync as jest.Mock).mockResolvedValue(false);
  const fresh = new (Object.getPrototypeOf(tiltSource).constructor)();
  const seen: Array<{ x: number; y: number }> = [];
  const stop = fresh.subscribe((tilt: { x: number; y: number }) => seen.push(tilt));
  await flush();
  expect(DeviceMotion.addListener).not.toHaveBeenCalled();
  expect(seen).toEqual([{ x: 0, y: 0 }]);
  stop();
});
