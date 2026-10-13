import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useKeyedLoad } from "./useKeyedLoad";

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
  expect(fetcher).toHaveBeenCalledWith("a");
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
