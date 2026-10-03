import { act, renderHook } from "@testing-library/react-native";
import { useProgressiveCount } from "./progressive";

// Lange Listen bauen sich schrittweise auf (E13, #623): erst wenige, dann je Takt mehr, bis alles steht;
// ein neuer Filter beginnt wieder vorn.

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("erst die ersten, dann schrittweise alle; ein neuer Schlüssel beginnt vorn", async () => {
  const { result, rerender } = await renderHook(({ total, key }: { total: number; key: string }) => useProgressiveCount(total, key, 12, 12), { initialProps: { total: 40, key: "alle" } });
  expect(result.current).toBe(12);
  await act(async () => { jest.advanceTimersByTime(20); });
  expect(result.current).toBe(24);
  // Jeder Schritt plant den nächsten erst nach dem Zeichnen - also Takt für Takt.
  for (let i = 0; i < 4; i++) await act(async () => { jest.advanceTimersByTime(20); });
  expect(result.current).toBe(40);
  await rerender({ total: 30, key: "erreicht" });
  expect(result.current).toBe(12);
  await rerender({ total: 5, key: "geheim" });
  expect(result.current).toBe(5);
});
