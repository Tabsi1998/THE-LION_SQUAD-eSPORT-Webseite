import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useLoad } from "./useLoad";

// Der zentrale Lade-Baustein der Website (#983, #984, #985): Laden, leer, Fehler und geladen getrennt; nur die zuletzt
// gestartete Anfrage zählt; ein gescheitertes Nachladen lässt den letzten Stand stehen.

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const serverError = () => Object.assign(new Error("boom"), { response: { status: 500, data: {} } });
const notFound = () => Object.assign(new Error("weg"), { response: { status: 404, data: {} } });
const offline = () => new Error("Network Error");

test("erst laden, dann geladen", async () => {
  const fetcher = vi.fn(async () => [{ id: 1 }]);
  const { result } = renderHook(() => useLoad("liste", fetcher));
  expect(result.current.status).toBe("loading");
  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.status).toBe("ok"));
  expect(result.current.data).toEqual([{ id: 1 }]);
  expect(result.current.problem).toBeNull();
  expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ key: "liste", previous: null, signal: expect.any(AbortSignal) }));
});

test("eine erfolgreiche leere Antwort ist „leer“ - auch bei { items: [] }", async () => {
  const { result } = renderHook(() => useLoad("liste", async () => []));
  await waitFor(() => expect(result.current.status).toBe("empty"));
  const paged = renderHook(() => useLoad("seite", async () => ({ items: [], total: 0 })));
  await waitFor(() => expect(paged.result.current.status).toBe("empty"));
  const custom = renderHook(() => useLoad("eigen", async () => ({ rows: [] }), { isEmpty: (data) => data.rows.length === 0 }));
  await waitFor(() => expect(custom.result.current.status).toBe("empty"));
});

test("ein Fehler beim ersten Laden ist ein Fehler, nie „leer“; Nochmal versuchen lädt die Seite", async () => {
  const fetcher = vi.fn()
    .mockRejectedValueOnce(serverError())
    .mockResolvedValueOnce([{ id: 1 }]);
  const { result } = renderHook(() => useLoad("liste", fetcher));
  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.problem).toBe("error");
  expect(result.current.data).toBeNull();
  expect(result.current.loading).toBe(false);

  await act(async () => { await result.current.reload(); });
  expect(result.current.status).toBe("ok");
  expect(result.current.data).toEqual([{ id: 1 }]);
});

test("Art des Fehlers: ohne Netz, nicht gefunden", async () => {
  const net = renderHook(() => useLoad("a", async () => { throw offline(); }));
  await waitFor(() => expect(net.result.current.problem).toBe("offline"));
  const gone = renderHook(() => useLoad("b", async () => { throw notFound(); }));
  await waitFor(() => expect(gone.result.current.problem).toBe("notFound"));
});

test("ein gescheitertes Nachladen lässt den letzten Stand stehen und sagt es (stale)", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce([{ id: 1 }])
    .mockRejectedValueOnce(serverError());
  const { result } = renderHook(() => useLoad("liste", fetcher));
  await waitFor(() => expect(result.current.status).toBe("ok"));
  await act(async () => { await result.current.reload(); });
  expect(result.current.status).toBe("ok");
  expect(result.current.data).toEqual([{ id: 1 }]);
  expect(result.current.stale).toBe(true);
  expect(result.current.problem).toBe("error");
  expect(fetcher).toHaveBeenLastCalledWith(expect.objectContaining({ previous: [{ id: 1 }] }));
});

// Wettlauf (#1570): Der Stand, den ein Nachladen als `previous` bekommt, darf nicht erst nach dem Effekt-Lauf der Seite
// stimmen. React schreibt die geladenen Daten sofort ins Bild, führt die Effekte aber erst in einer späteren Aufgabe
// aus - wer in diesem Spalt nachlädt (ein Klick, eine Invalidierung), hätte `previous` ohne den ersten Stand bekommen
// und einen ausgefallenen Teil leer statt mit seinem letzten Stand gezeigt. Ein MutationObserver läuft unmittelbar nach
// dem Schreiben ins Bild und vor jeder späteren Aufgabe, stellt den Spalt also immer her - nicht nur unter Last.
test("Nachladen unmittelbar nach dem ersten Bild kennt den ersten Stand schon (previous)", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce([{ id: 1 }])
    .mockRejectedValueOnce(serverError());
  let load;
  function Probe() {
    load = useLoad("liste", fetcher);
    return <p data-testid="stand">{load.data ? `Stand ${load.data.length}` : "leer"}</p>;
  }
  const { container } = render(<Probe />);
  let reloaded;
  const observer = new MutationObserver(() => {
    if (!reloaded && load.data) {
      observer.disconnect();
      reloaded = load.reload();
    }
  });
  observer.observe(container, { childList: true, subtree: true, characterData: true });
  await screen.findByText("Stand 1");
  await act(async () => { await reloaded; });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenLastCalledWith(expect.objectContaining({ previous: [{ id: 1 }] }));
  expect(load.data).toEqual([{ id: 1 }]);
  expect(load.stale).toBe(true);
});

test("A langsam, B schnell: die spätere Antwort für A ändert B nicht, und A wird abgebrochen", async () => {
  const slowA = deferred();
  const signals = {};
  const fetcher = vi.fn(({ key, signal }) => {
    signals[key] = signal;
    return key === "a" ? slowA.promise : Promise.resolve([`treffer-${key}`]);
  });
  const { result, rerender } = renderHook(({ term }) => useLoad(term, fetcher), { initialProps: { term: "a" } });
  rerender({ term: "b" });
  // Schon im ersten Bild nach dem Wechsel nichts Altes.
  expect(result.current.data).toBeNull();
  await waitFor(() => expect(result.current.data).toEqual(["treffer-b"]));
  expect(signals.a.aborted).toBe(true);
  await act(async () => slowA.resolve(["treffer-a"]));
  expect(result.current.data).toEqual(["treffer-b"]);
  expect(result.current.status).toBe("ok");
});

test("ein verspäteter Fehler einer alten Anfrage gehört nicht zur aktuellen", async () => {
  const slowA = deferred();
  const fetcher = vi.fn(({ key }) => (key === "a" ? slowA.promise : Promise.resolve(["b"])));
  const { result, rerender } = renderHook(({ term }) => useLoad(term, fetcher), { initialProps: { term: "a" } });
  rerender({ term: "b" });
  await waitFor(() => expect(result.current.status).toBe("ok"));
  await act(async () => slowA.reject(serverError()));
  expect(result.current.status).toBe("ok");
  expect(result.current.problem).toBeNull();
});

test("Leeren (Kennung null) verwirft eine laufende Antwort; nichts lädt, nichts steht da", async () => {
  const slow = deferred();
  const fetcher = vi.fn(() => slow.promise);
  const { result, rerender } = renderHook(({ term }) => useLoad(term, fetcher), { initialProps: { term: "abc" } });
  rerender({ term: null });
  expect(result.current.status).toBe("idle");
  expect(result.current.loading).toBe(false);
  await act(async () => slow.resolve(["alt"]));
  expect(result.current.data).toBeNull();
  expect(result.current.status).toBe("idle");
});

test("nach dem Verlassen gilt keine Antwort mehr - die Anfrage wird abgebrochen", async () => {
  const slow = deferred();
  let seen;
  const fetcher = vi.fn(({ signal }) => {
    seen = signal;
    return slow.promise;
  });
  const { unmount } = renderHook(() => useLoad("x", fetcher));
  unmount();
  expect(seen.aborted).toBe(true);
  await act(async () => slow.resolve(["spät"]));
});

test("debounceMs: beim Tippen fragt nur der letzte Begriff, das Laden gehört sofort zum neuen Begriff", async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn(async ({ key }) => [key]);
    const { result, rerender } = renderHook(({ term }) => useLoad(term, fetcher, { debounceMs: 200 }), { initialProps: { term: "li" } });
    expect(result.current.status).toBe("loading");
    rerender({ term: "lio" });
    rerender({ term: "lion" });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ key: "lion" }));
    expect(result.current.data).toEqual(["lion"]);
  } finally {
    vi.useRealTimers();
  }
});

test("mutate ändert den Stand ohne neuen Abruf", async () => {
  const fetcher = vi.fn(async () => [{ id: 1, read: false }]);
  const { result } = renderHook(() => useLoad("feed", fetcher));
  await waitFor(() => expect(result.current.status).toBe("ok"));
  act(() => result.current.mutate((rows) => rows.map((row) => ({ ...row, read: true }))));
  expect(result.current.data).toEqual([{ id: 1, read: true }]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("Array-Kennungen zählen nach Inhalt, nicht nach Objekt", async () => {
  const fetcher = vi.fn(async () => ["x"]);
  const { result, rerender } = renderHook(({ page }) => useLoad(["spieler", page, ""], fetcher), { initialProps: { page: 1 } });
  await waitFor(() => expect(result.current.status).toBe("ok"));
  rerender({ page: 1 });
  await waitFor(() => expect(result.current.status).toBe("ok"));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("eine erfolgreiche Antwort ohne Inhalt (null) ist „leer“, nicht ewig „lädt“", async () => {
  const { result } = renderHook(() => useLoad("nichts", async () => null));
  await waitFor(() => expect(result.current.status).toBe("empty"));
  expect(result.current.loading).toBe(false);
});
