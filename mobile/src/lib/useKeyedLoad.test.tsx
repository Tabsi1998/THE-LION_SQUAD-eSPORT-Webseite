import { useLayoutEffect } from "react";
import { Text } from "react-native";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import { useKeyedLoad, type KeyedLoad } from "./useKeyedLoad";

// Detailseiten (#1000): wechselt die Kennung, ist der alte Inhalt sofort weg; eine verspätete Antwort für die alte
// Kennung überschreibt nie die neue; ein Fehler nach dem ersten Laden bleibt sichtbar, der letzte Stand ist gekennzeichnet.

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const http = (status: number) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data: {} } });
const offline = () => Object.assign(new Error("Network Error"), { isAxiosError: true });

test("erst laden, dann die Daten der Kennung", async () => {
  const pending = deferred<{ id: string }>();
  const fetcher = jest.fn((_id: string) => pending.promise);
  const { result } = await renderHook(() => useKeyedLoad("a", fetcher));
  expect(result.current).toMatchObject({ loading: true, data: null, problem: null });
  await act(async () => {
    pending.resolve({ id: "a" });
    await pending.promise;
  });
  expect(result.current).toMatchObject({ data: { id: "a" }, loading: false, problem: null, stale: false });
  expect(fetcher).toHaveBeenCalledWith("a", null);
});

test.each([404, 403, 500])("A → B mit %s: kein Inhalt von A als B", async (status) => {
  const answerB = deferred<{ id: string }>();
  const fetcher = jest.fn((id: string) => (id === "b" ? answerB.promise : Promise.resolve({ id })));
  const { result, rerender } = await renderHook(({ id }: { id: string }) => useKeyedLoad(id, fetcher), { initialProps: { id: "a" } });
  await waitFor(() => expect(result.current.data).toEqual({ id: "a" }));
  await rerender({ id: "b" });
  // Gleich beim Wechsel: nichts von A, sondern Laden.
  expect(result.current).toMatchObject({ data: null, loading: true, problem: null });
  await act(async () => {
    answerB.reject(http(status));
    await answerB.promise.catch(() => undefined);
  });
  expect(result.current).toMatchObject({ data: null, loading: false, stale: false });
  expect(result.current.problem?.kind).toBe(status === 404 ? "notFound" : status === 403 ? "denied" : "error");
});

test("eine langsame Antwort für A überschreibt das spätere B nicht", async () => {
  const slowA = deferred<{ id: string }>();
  const fetcher = jest.fn((id: string) => (id === "a" ? slowA.promise : Promise.resolve({ id })));
  const { result, rerender } = await renderHook(({ id }: { id: string }) => useKeyedLoad(id, fetcher), { initialProps: { id: "a" } });
  await rerender({ id: "b" });
  await waitFor(() => expect(result.current.data).toEqual({ id: "b" }));
  await act(async () => {
    slowA.resolve({ id: "a" });
    await slowA.promise;
  });
  expect(result.current.data).toEqual({ id: "b" });
  expect(result.current.problem).toBeNull();
});

test("ein verspäteter Fehler für A setzt bei B keinen Fehler", async () => {
  const slowA = deferred<{ id: string }>();
  const fetcher = jest.fn((id: string) => (id === "a" ? slowA.promise : Promise.resolve({ id })));
  const { result, rerender } = await renderHook(({ id }: { id: string }) => useKeyedLoad(id, fetcher), { initialProps: { id: "a" } });
  await rerender({ id: "b" });
  await waitFor(() => expect(result.current.data).toEqual({ id: "b" }));
  await act(async () => {
    slowA.reject(http(500));
    await slowA.promise.catch(() => undefined);
  });
  expect(result.current).toMatchObject({ data: { id: "b" }, problem: null });
});

test("Nochmal versuchen lädt B; die langsamere frühere Antwort gewinnt nicht", async () => {
  const first = deferred<{ id: string; round: number }>();
  let round = 0;
  const fetcher = jest.fn(() => {
    round += 1;
    return round === 1 ? first.promise : Promise.resolve({ id: "b", round });
  });
  const { result } = await renderHook(() => useKeyedLoad("b", fetcher));
  await act(async () => {
    await result.current.reload();
  });
  expect(result.current.data).toEqual({ id: "b", round: 2 });
  await act(async () => {
    first.resolve({ id: "b", round: 1 });
    await first.promise;
  });
  expect(result.current.data).toEqual({ id: "b", round: 2 });
});

test("Fehler nach dem ersten Laden: der letzte Stand bleibt, ausdrücklich als alt gekennzeichnet", async () => {
  let fail = false;
  const fetcher = jest.fn(async (id: string) => {
    if (fail) throw offline();
    return { id };
  });
  const { result } = await renderHook(() => useKeyedLoad("b", fetcher));
  await waitFor(() => expect(result.current.data).toEqual({ id: "b" }));
  fail = true;
  await act(async () => {
    await result.current.reload();
  });
  expect(result.current).toMatchObject({ data: { id: "b" }, stale: true, loading: false });
  expect(result.current.problem?.kind).toBe("offline");
  fail = false;
  await act(async () => {
    await result.current.reload();
  });
  expect(result.current).toMatchObject({ data: { id: "b" }, stale: false, problem: null });
});

test("nach dem Verlassen wird keine Antwort mehr angewendet", async () => {
  const slow = deferred<{ id: string }>();
  const { result, unmount } = await renderHook(() => useKeyedLoad("a", () => slow.promise));
  await unmount();
  await act(async () => {
    slow.resolve({ id: "a" });
    await slow.promise;
  });
  expect(result.current.data).toBeNull();
});

test("der Abruf bekommt den letzten Stand derselben Kennung - für Teile, die nicht kamen (#1000)", async () => {
  const fetcher = jest.fn(async (id: string, previous: { id: string; round: number } | null) => ({ id, round: (previous?.round || 0) + 1 }));
  const { result, rerender } = await renderHook(({ id }: { id: string }) => useKeyedLoad(id, fetcher), { initialProps: { id: "a" } });
  await waitFor(() => expect(result.current.data).toEqual({ id: "a", round: 1 }));
  await act(async () => {
    await result.current.reload();
  });
  expect(result.current.data).toEqual({ id: "a", round: 2 });
  expect(fetcher).toHaveBeenLastCalledWith("a", { id: "a", round: 1 });
  // Eine andere Kennung bekommt nie den Stand der vorigen.
  await rerender({ id: "b" });
  await waitFor(() => expect(result.current.data).toEqual({ id: "b", round: 1 }));
  expect(fetcher).toHaveBeenLastCalledWith("b", null);
});

test("mutate ändert nur den Stand der aktuellen Kennung", async () => {
  const fetcher = jest.fn(async (id: string) => ({ id, name: "alt" }));
  const { result } = await renderHook(() => useKeyedLoad("a", fetcher));
  await waitFor(() => expect(result.current.data).toEqual({ id: "a", name: "alt" }));
  await act(async () => {
    result.current.mutate((current) => ({ ...current, name: "neu" }));
  });
  expect(result.current.data).toEqual({ id: "a", name: "neu" });
});

// Wettlauf (#1570): Der Stand, den ein Nachladen als `previous` bekommt, muss schon stimmen, wenn das Bild mit den
// geladenen Daten steht. Normale Effekte laufen erst nach dem Schreiben ins Bild (auf dem Gerät in einer späteren
// Aufgabe) - wer in diesem Spalt nachlädt (Klick, Invalidierung, ein Layout-Effekt wie hier), bekäme `previous` ohne den
// ersten Stand und zeigte einen ausgefallenen Teil leer statt mit seinem letzten Stand. Der Layout-Effekt der Probe
// lädt im selben Commit nach, in dem die Daten ins Bild kommen: der Spalt entsteht so in jeder Umgebung, nicht nur unter Last.
test("Nachladen im Commit des ersten Bilds kennt den ersten Stand schon (previous)", async () => {
  const fetcher = jest.fn<Promise<{ id: string }>, [string, { id: string } | null]>()
    .mockResolvedValueOnce({ id: "a" })
    .mockRejectedValueOnce(http(500));
  let load!: KeyedLoad<{ id: string }>;
  let reloaded: Promise<void> | undefined;
  function Probe() {
    load = useKeyedLoad("a", fetcher);
    useLayoutEffect(() => {
      if (load.data && !reloaded) reloaded = load.reload();
    });
    return <Text>{load.data ? `Stand ${load.data.id}` : "leer"}</Text>;
  }
  await render(<Probe />);
  await waitFor(() => expect(reloaded).toBeDefined());
  await act(async () => { await reloaded; });
  expect(screen.getByText("Stand a")).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenLastCalledWith("a", { id: "a" });
  expect(load.data).toEqual({ id: "a" });
  expect(load.stale).toBe(true);
});
