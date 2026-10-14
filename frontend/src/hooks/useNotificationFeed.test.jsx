import { act, renderHook, waitFor } from "@testing-library/react";

// Benachrichtigungen (#984, #987): ein Ladefehler ist kein „Keine Benachrichtigungen“, ein gescheitertes Nachladen lässt
// den letzten Stand stehen. „Gelesen“ setzt sofort; was der Server ablehnt, wird wieder ungelesen und gemeldet -
// Teilerfolge bleiben. Erfundene Daten.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
const live = { reload: null };
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (callback) => { live.reload = callback; } }));

const { useNotificationFeed } = await import("./useNotificationFeed");

const ROWS = [
  { id: "n-1", kind: "match", title: "Dein Match startet", read: false, created_at: "2026-10-14T10:00:00Z" },
  { id: "n-2", kind: "team", title: "Neue Einladung", read: false, created_at: "2026-10-14T09:00:00Z" },
  { id: "n-3", kind: "news", title: "Neuer Beitrag", read: true, created_at: "2026-10-13T09:00:00Z" },
];
const serverError = () => Object.assign(new Error("boom"), { response: { status: 500, data: {} } });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function loaded() {
  const hook = renderHook(() => useNotificationFeed());
  await waitFor(() => expect(hook.result.current.status).toBe("ok"));
  return hook;
}

const readOf = (result, id) => result.current.items.find((item) => item.id === id).read;

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.delete.mockReset();
  apiMock.get.mockResolvedValue({ data: ROWS });
});

test("ein Ladefehler ist ein Fehler, nicht „keine Benachrichtigungen“", async () => {
  apiMock.get.mockReset();
  apiMock.get.mockRejectedValue(serverError());
  const { result } = renderHook(() => useNotificationFeed());
  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.problem).toBe("error");
  expect(result.current.items).toEqual([]);
});

test("ein gescheitertes Nachladen lässt die Benachrichtigungen stehen", async () => {
  const { result } = await loaded();
  apiMock.get.mockRejectedValueOnce(serverError());
  await act(async () => { await live.reload(); });
  expect(result.current.items).toHaveLength(3);
  expect(result.current.unread).toBe(2);
  expect(result.current.stale).toBe(true);
});

test("Gelesen-Markieren scheitert: wieder ungelesen, Zähler stimmt, Fehler mit Nochmal versuchen", async () => {
  const { result } = await loaded();
  apiMock.post.mockRejectedValueOnce(serverError());
  await act(async () => { await result.current.markRead({ ids: ["n-1"] }); });
  expect(readOf(result, "n-1")).toBe(false);
  expect(result.current.unread).toBe(2);
  expect(result.current.actionError?.message).toMatch(/nicht als gelesen markiert/);

  apiMock.post.mockResolvedValueOnce({ data: {} });
  await act(async () => { await result.current.actionError.retry(); });
  expect(readOf(result, "n-1")).toBe(true);
  expect(result.current.unread).toBe(1);
  expect(result.current.actionError).toBeNull();
});

test("Teilerfolg: was geklappt hat, bleibt gelesen; nur der Rest wird wieder ungelesen", async () => {
  const { result } = await loaded();
  apiMock.post.mockImplementation((url) => (url.includes("n-2") ? Promise.reject(serverError()) : Promise.resolve({ data: {} })));
  await act(async () => { await result.current.markRead({ ids: ["n-1", "n-2"] }); });
  expect(readOf(result, "n-1")).toBe(true);
  expect(readOf(result, "n-2")).toBe(false);
  expect(result.current.unread).toBe(1);
  expect(result.current.actionError?.message).toMatch(/1 Benachrichtigung/);
});

test("ausstehend: ein zweiter Klick schickt nichts doppelt, die Einträge sind als ausstehend kenntlich", async () => {
  const { result } = await loaded();
  const pending = deferred();
  apiMock.post.mockReturnValue(pending.promise);
  let first;
  act(() => { first = result.current.markRead({ ids: ["n-1"] }); });
  expect(result.current.pendingIds.has("n-1")).toBe(true);
  await act(async () => { await result.current.markRead({ ids: ["n-1"] }); });
  expect(apiMock.post).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve({ data: {} }); await first; });
  expect(result.current.pendingIds.has("n-1")).toBe(false);
  expect(readOf(result, "n-1")).toBe(true);
});

test("Alle gelesen scheitert: alle vorher ungelesenen wieder ungelesen, Fehler steht da, der Stand wird neu geholt", async () => {
  const { result } = await loaded();
  apiMock.get.mockClear();
  apiMock.post.mockRejectedValueOnce(serverError());
  await act(async () => { await result.current.markAllRead(); });
  expect(readOf(result, "n-1")).toBe(false);
  expect(readOf(result, "n-2")).toBe(false);
  expect(readOf(result, "n-3")).toBe(true);
  expect(result.current.unread).toBe(2);
  expect(result.current.actionError?.message).toMatch(/nicht als gelesen markiert/);
  expect(apiMock.get).toHaveBeenCalledWith("/admin/notifications", expect.anything());
});

test("Alle gelesen klappt: alles gelesen, kein Fehler", async () => {
  const { result } = await loaded();
  apiMock.post.mockResolvedValueOnce({ data: {} });
  await act(async () => { await result.current.markAllRead(); });
  expect(result.current.unread).toBe(0);
  expect(result.current.actionError).toBeNull();
});

test("markRead nennt, was gescheitert ist - für Stellen ohne eigene Liste (Toast der Glocke)", async () => {
  const { result } = await loaded();
  apiMock.post.mockRejectedValueOnce(serverError());
  let failed;
  await act(async () => { failed = await result.current.markRead({ ids: ["n-1"] }); });
  expect(failed).toEqual(["n-1"]);
  apiMock.post.mockResolvedValueOnce({ data: {} });
  await act(async () => { failed = await result.current.markRead({ ids: ["n-1"] }); });
  expect(failed).toEqual([]);
});

// Nach Codex-Prüfung: ein Nachladen während „gelesen“ unterwegs ist, überschreibt die Markierung nicht; nach dem
// erfolgreichen POST bleibt sie gesetzt.
test("Rennen: Nachladen während Gelesen-Markieren - die Markierung bleibt, auch nach dem POST", async () => {
  const { result } = await loaded();
  const post = deferred();
  apiMock.post.mockReturnValueOnce(post.promise);
  let marking;
  act(() => { marking = result.current.markRead({ ids: ["n-1"] }); });
  expect(readOf(result, "n-1")).toBe(true);
  // Der Server liefert noch den alten Stand (n-1 ungelesen).
  await act(async () => { await live.reload(); });
  expect(readOf(result, "n-1")).toBe(true);
  expect(result.current.unread).toBe(1);
  await act(async () => { post.resolve({ data: {} }); await marking; });
  expect(readOf(result, "n-1")).toBe(true);
  expect(result.current.unread).toBe(1);
});

test("Rennen: Nachladen während „alle gelesen“ - alles bleibt gelesen, auch nach dem POST", async () => {
  const { result } = await loaded();
  const post = deferred();
  apiMock.post.mockReturnValueOnce(post.promise);
  let marking;
  act(() => { marking = result.current.markAllRead(); });
  await act(async () => { await live.reload(); });
  expect(result.current.unread).toBe(0);
  await act(async () => { post.resolve({ data: {} }); await marking; });
  expect(result.current.unread).toBe(0);
});
