import { act, render } from "@testing-library/react";

// Der Abgleich der Saison-Signale (#678): ohne Anmeldung geht nichts hinaus; nach dem Login auch das von vorher;
// viele Zählungen kurz hintereinander sind eine Meldung; abgelehnt ist auch gemeldet; schlägt die Meldung fehl, bleibt
// der Ausgang stehen; hat der Server eine Stufe vergeben, erfährt es die Zeremonie.

const apiMock = { post: vi.fn() };
const authState = { user: null };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));

const { AWARDED_EVENT, FIRST_FLUSH_MS, FLUSH_DELAY_MS, RETRY_MS, SignalSync, flushSignals } = await import("./SignalSync");
const { OUTBOX_KEY, outboxSize, recordSignal, setSignalOwner } = await import("./signals");

const NOW = new Date("2026-10-30T19:00:00Z");

function accepted(items, extra = {}) {
  return { data: { accepted: items.length, newly_awarded: 0, results: items.map((item) => ({ ...item, accepted: true })), ...extra } };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  localStorage.clear();
  setSignalOwner(null);
  authState.user = null;
  apiMock.post.mockReset();
  apiMock.post.mockImplementation(async (_url, body) => accepted(body.items));
});

afterEach(() => {
  vi.useRealTimers();
});

test("eine Meldung: was im Ausgang liegt, mit Tag - danach ist der Ausgang leer; ohne Inhalt keine Meldung", async () => {
  expect(await flushSignals("anna", { now: NOW })).toBeNull();
  expect(apiMock.post).not.toHaveBeenCalled();
  recordSignal("halloween_pumpkin", { now: new Date("2026-10-28T19:00:00Z") });
  recordSignal("halloween_bats_scared", { onceIf: false, now: NOW });
  recordSignal("halloween_bats_scared", { onceIf: false, now: NOW });
  const result = await flushSignals("anna", { now: NOW });
  expect(apiMock.post).toHaveBeenCalledWith("/achievements/signals", { items: [
    { name: "halloween_pumpkin", day: "2026-10-28", count: 1 },
    { name: "halloween_bats_scared", day: "2026-10-30", count: 2 },
  ] }, { skipInvalidation: true });
  expect(result).toEqual({ sent: 2, accepted: 2, awarded: 0, retry: false });
  expect(outboxSize(NOW)).toBe(0);
});

test("abgelehnt ist auch gemeldet (Deckel, Saison); Netz und Server lassen den Ausgang stehen; unannehmbar fliegt hinaus", async () => {
  recordSignal("halloween_bats_scared", { onceIf: false, now: NOW });
  apiMock.post.mockResolvedValueOnce({ data: { accepted: 0, newly_awarded: 0, results: [{ name: "halloween_bats_scared", day: "2026-10-30", accepted: false, reason: "cap" }] } });
  expect(await flushSignals("anna", { now: NOW })).toEqual({ sent: 1, accepted: 0, awarded: 0, retry: false });
  expect(outboxSize(NOW)).toBe(0);
  recordSignal("halloween_bats_scared", { onceIf: false, now: NOW });
  for (const error of [new Error("Netz weg"), { response: { status: 503 } }, { response: { status: 429 } }, { response: { status: 401 } }, { response: { status: 403 } }]) {
    apiMock.post.mockRejectedValueOnce(error);
    expect(await flushSignals("anna", { now: NOW })).toEqual({ sent: 0, accepted: 0, awarded: 0, retry: true });
    expect(outboxSize(NOW)).toBe(1);
  }
  apiMock.post.mockRejectedValueOnce({ response: { status: 422 } });
  expect(await flushSignals("anna", { now: NOW })).toEqual({ sent: 1, accepted: 0, awarded: 0, retry: false });
  expect(outboxSize(NOW)).toBe(0);
});

test("ohne Anmeldung geht nichts hinaus; nach dem Login wird nachgemeldet, was vorher gesammelt wurde", async () => {
  recordSignal("halloween_bats_scared", { onceIf: false });
  recordSignal("halloween_ghosts_freed", { onceIf: false });
  const view = render(<SignalSync />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(FIRST_FLUSH_MS + RETRY_MS);
  });
  expect(apiMock.post).not.toHaveBeenCalled();
  expect(outboxSize()).toBe(2);
  authState.user = { id: "anna" };
  view.rerender(<SignalSync />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(FIRST_FLUSH_MS + 10);
  });
  expect(apiMock.post).toHaveBeenCalledTimes(1);
  expect(apiMock.post.mock.calls[0][1].items.map((item) => item.name)).toEqual(["halloween_bats_scared", "halloween_ghosts_freed"]);
  expect(outboxSize()).toBe(0);
  // Neue Zählungen gehören jetzt Anna.
  recordSignal("halloween_cat_petted", { onceIf: false });
  expect(Object.keys(JSON.parse(localStorage.getItem(OUTBOX_KEY)))).toEqual(["anna|halloween_cat_petted|2026-10-30"]);
  view.unmount();
});

test("zwanzig Flocken kurz hintereinander sind eine Meldung; nach einem Fehler kommt der nächste Versuch später", async () => {
  authState.user = { id: "anna" };
  const view = render(<SignalSync />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(FIRST_FLUSH_MS + 10);
  });
  expect(apiMock.post).not.toHaveBeenCalled();
  for (let i = 0; i < 20; i += 1) {
    recordSignal("snowflakes_clicked", { onceIf: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
  }
  expect(apiMock.post).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS + 10);
  });
  expect(apiMock.post).toHaveBeenCalledTimes(1);
  expect(apiMock.post.mock.calls[0][1]).toEqual({ items: [{ name: "snowflakes_clicked", day: "2026-10-30", count: 20 }] });
  apiMock.post.mockRejectedValueOnce(new Error("Netz weg"));
  recordSignal("snowflakes_clicked", { onceIf: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS + 10);
  });
  expect(apiMock.post).toHaveBeenCalledTimes(2);
  expect(outboxSize()).toBe(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RETRY_MS - 1000);
  });
  expect(apiMock.post).toHaveBeenCalledTimes(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(apiMock.post).toHaveBeenCalledTimes(3);
  expect(outboxSize()).toBe(0);
  view.unmount();
});

test("hat der Server eine Stufe vergeben, erfährt es die Zeremonie; beim Verlassen der Seite geht die Meldung sofort hinaus", async () => {
  authState.user = { id: "anna" };
  const awarded = [];
  const listener = (event) => awarded.push(event.detail);
  window.addEventListener(AWARDED_EVENT, listener);
  apiMock.post.mockImplementationOnce(async (_url, body) => accepted(body.items, { newly_awarded: 1 }));
  const view = render(<SignalSync />);
  recordSignal("halloween_pumpkin");
  Object.defineProperty(document, "hidden", { value: true, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  expect(apiMock.post).toHaveBeenCalledTimes(1);
  expect(awarded).toEqual([{ count: 1, source: "signal" }]);
  view.unmount();
  // Abgemeldet oder weg: es hört niemand mehr zu.
  recordSignal("halloween_bats_scared", { onceIf: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RETRY_MS);
  });
  expect(apiMock.post).toHaveBeenCalledTimes(1);
  window.removeEventListener(AWARDED_EVENT, listener);
});
