import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import { AFTER_DEADLINE_MS, useVetoPolling } from "./useVetoPolling";
import type { VetoBlock } from "./leagueVeto";

// Kurzer Abruf des Map-Vetos (#2173, D.4): fragt im Takt des Stands, im Hintergrund nie, verdeckt (Fokus weg) und nach dem
// Verlassen gar nicht mehr; beim Zurückkommen sofort einmal, kurz nach der Frist einmal extra.

const running = (deadlineIn = 30000): VetoBlock => ({ status: "running", step_seconds: 60, current: { kind: "ban", deadline_at: new Date(Date.now() + deadlineIn).toISOString() } });

let appStateListener: ((state: string) => void) | null = null;
const remove = jest.fn();

beforeEach(() => {
  jest.useFakeTimers({ now: new Date("2026-11-15T19:00:00Z") });
  appStateListener = null;
  remove.mockClear();
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, handler: (state: string) => void) => {
    appStateListener = handler;
    return { remove };
  }) as never);
  Object.defineProperty(AppState, "currentState", { configurable: true, value: "active" });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("läuft: alle 2 Sekunden, Pause: alle 5 Sekunden", async () => {
  const poll = jest.fn();
  const { rerender } = await renderHook(({ block }: { block: VetoBlock }) => useVetoPolling(block, poll), { initialProps: { block: running(600000) } });
  await act(async () => { jest.advanceTimersByTime(6100); });
  expect(poll).toHaveBeenCalledTimes(3);
  poll.mockClear();
  await rerender({ block: { status: "paused" } });
  await act(async () => { jest.advanceTimersByTime(6100); });
  expect(poll).toHaveBeenCalledTimes(1);
});

test("im Hintergrund kein Abruf, beim Zurückkommen sofort einmal", async () => {
  const poll = jest.fn();
  await renderHook(() => useVetoPolling(running(600000), poll));
  Object.defineProperty(AppState, "currentState", { configurable: true, value: "background" });
  await act(async () => { jest.advanceTimersByTime(6100); });
  expect(poll).not.toHaveBeenCalled();
  Object.defineProperty(AppState, "currentState", { configurable: true, value: "active" });
  await act(async () => { appStateListener?.("active"); });
  expect(poll).toHaveBeenCalledTimes(1);
});

test("Fokus weg (verdeckter Screen): kein Abruf mehr, der Lauscher ist abgemeldet", async () => {
  const poll = jest.fn();
  const { rerender } = await renderHook(({ enabled }: { enabled: boolean }) => useVetoPolling(running(600000), poll, { enabled }), { initialProps: { enabled: true } });
  await rerender({ enabled: false });
  expect(remove).toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(10000); });
  expect(poll).not.toHaveBeenCalled();
});

test("nach dem Verlassen (Unmount) fragt nichts mehr nach - auch nicht die Extra-Abfrage nach der Frist", async () => {
  const poll = jest.fn();
  const { unmount } = await renderHook(() => useVetoPolling(running(1000), poll));
  await unmount();
  expect(remove).toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(10000); });
  expect(poll).not.toHaveBeenCalled();
});

test("kurz nach der Frist einmal extra - dann steht die Zufallswahl", async () => {
  const poll = jest.fn();
  // Frist in 1 Sekunde: die Extra-Abfrage kommt bei 1,8 s, der Takt (2 s) erst danach.
  await renderHook(() => useVetoPolling(running(1000), poll));
  await act(async () => { jest.advanceTimersByTime(1000 + AFTER_DEADLINE_MS - 10); });
  expect(poll).toHaveBeenCalledTimes(0);
  await act(async () => { jest.advanceTimersByTime(20); });
  expect(poll).toHaveBeenCalledTimes(1);
});

test("ohne Veto, fertig oder ohne Abruf: nichts", async () => {
  const poll = jest.fn();
  await renderHook(() => useVetoPolling({ status: "done" }, poll));
  await renderHook(() => useVetoPolling(null, poll));
  await renderHook(() => useVetoPolling(running(600000), null));
  await act(async () => { jest.advanceTimersByTime(10000); });
  expect(poll).not.toHaveBeenCalled();
});
