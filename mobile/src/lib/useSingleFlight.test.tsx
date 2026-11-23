import { act, renderHook } from "@testing-library/react-native";
import { useSingleFlight } from "./useSingleFlight";

// Gegen Doppeltippen (#2173): zwei Aufrufe im selben Takt ergeben genau eine Aufgabe; danach geht es wieder.

test("zweiter Aufruf, solange der erste läuft, wird verworfen - danach geht es wieder, auch nach einem Fehler", async () => {
  const { result } = await renderHook(() => useSingleFlight());
  let release: () => void = () => undefined;
  const task = jest.fn(() => new Promise<string>((resolve) => { release = () => resolve("ok"); }));
  let first: Promise<string | undefined> = Promise.resolve(undefined);
  let second: Promise<string | undefined> = Promise.resolve(undefined);
  await act(async () => {
    first = result.current(task);
    second = result.current(task);
  });
  expect(task).toHaveBeenCalledTimes(1);
  await act(async () => { release(); });
  await expect(first).resolves.toBe("ok");
  await expect(second).resolves.toBeUndefined();
  await expect(result.current(() => Promise.reject(new Error("weg")))).rejects.toThrow("weg");
  await expect(result.current(async () => "wieder")).resolves.toBe("wieder");
});
