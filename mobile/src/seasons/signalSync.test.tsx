import React from "react";
import { AppState } from "react-native";
import { act, render } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";

// Der Abgleich der Saison-Signale in der App (#678): ohne Anmeldung (auch als Gast) geht nichts hinaus; nach dem Login
// auch das von vorher; viele Zählungen kurz hintereinander sind eine Meldung; abgelehnt ist auch gemeldet; schlägt die
// Meldung fehl, bleibt der Ausgang stehen; hat der Server eine Stufe vergeben, erfährt es die App.

const mockApi = { post: jest.fn() };
jest.mock("../lib/api", () => ({ api: mockApi }));

const { FIRST_FLUSH_MS, FLUSH_DELAY_MS, RETRY_MS, flushSignals, useSignalSync } = require("./signalSync");
const { OUTBOX_KEY, outboxSize, recordSignal, setSignalOwner } = require("./signals");

const NOW = new Date("2026-10-30T19:00:00Z");

function Sync({ userId, onAwarded }: { userId: string | null; onAwarded?: (count: number) => void }) {
  useSignalSync(userId, onAwarded);
  return null;
}

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(async () => {
  jest.useFakeTimers({ now: NOW });
  await SecureStore.deleteItemAsync(OUTBOX_KEY);
  await SecureStore.deleteItemAsync("season_signals");
  setSignalOwner(null);
  mockApi.post.mockReset();
  mockApi.post.mockImplementation(async (_url: string, body: { items: unknown[] }) => ({ data: { accepted: body.items.length, newly_awarded: 0 } }));
});

afterEach(() => {
  jest.useRealTimers();
});

test("eine Meldung: was im Ausgang liegt, mit Tag - danach ist er leer; ohne Inhalt keine Meldung", async () => {
  expect(await flushSignals("anna", { now: NOW })).toBeNull();
  expect(mockApi.post).not.toHaveBeenCalled();
  await recordSignal("halloween_pumpkin", { now: new Date("2026-10-28T19:00:00Z") });
  await recordSignal("halloween_bats_scared", { onceIf: false, now: NOW });
  await recordSignal("halloween_bats_scared", { onceIf: false, now: NOW });
  expect(await flushSignals("anna", { now: NOW })).toEqual({ sent: 2, accepted: 2, awarded: 0, retry: false });
  expect(mockApi.post).toHaveBeenCalledWith("/achievements/signals", { items: [
    { name: "halloween_pumpkin", day: "2026-10-28", count: 1 },
    { name: "halloween_bats_scared", day: "2026-10-30", count: 2 },
  ] });
  expect(await outboxSize(NOW)).toBe(0);
});

test("abgelehnt ist auch gemeldet; Netz und Server lassen den Ausgang stehen; unannehmbar fliegt hinaus", async () => {
  await recordSignal("halloween_bats_scared", { onceIf: false, now: NOW });
  mockApi.post.mockResolvedValueOnce({ data: { accepted: 0, newly_awarded: 0 } });
  expect(await flushSignals("anna", { now: NOW })).toEqual({ sent: 1, accepted: 0, awarded: 0, retry: false });
  expect(await outboxSize(NOW)).toBe(0);
  await recordSignal("halloween_bats_scared", { onceIf: false, now: NOW });
  for (const error of [new Error("Netz weg"), { response: { status: 503 } }, { response: { status: 429 } }, { response: { status: 401 } }]) {
    mockApi.post.mockRejectedValueOnce(error);
    expect(await flushSignals("anna", { now: NOW })).toEqual({ sent: 0, accepted: 0, awarded: 0, retry: true });
    expect(await outboxSize(NOW)).toBe(1);
  }
  mockApi.post.mockRejectedValueOnce({ response: { status: 404 } });
  expect(await flushSignals("anna", { now: NOW })).toEqual({ sent: 1, accepted: 0, awarded: 0, retry: false });
  expect(await outboxSize(NOW)).toBe(0);
});

test("ohne Anmeldung geht nichts hinaus; nach dem Login wird nachgemeldet, was vorher gesammelt wurde", async () => {
  await recordSignal("halloween_bats_scared", { onceIf: false });
  await recordSignal("halloween_ghosts_freed", { onceIf: false });
  const view = await render(<Sync userId={null} />);
  await advance(FIRST_FLUSH_MS + RETRY_MS);
  expect(mockApi.post).not.toHaveBeenCalled();
  expect(await outboxSize()).toBe(2);
  await view.rerender(<Sync userId="anna" />);
  await advance(FIRST_FLUSH_MS + 50);
  expect(mockApi.post).toHaveBeenCalledTimes(1);
  expect(mockApi.post.mock.calls[0][1].items.map((item: { name: string }) => item.name)).toEqual(["halloween_bats_scared", "halloween_ghosts_freed"]);
  expect(await outboxSize()).toBe(0);
  // Neue Zählungen gehören jetzt Anna.
  await recordSignal("halloween_cat_petted", { onceIf: false });
  expect(JSON.parse((await SecureStore.getItemAsync(OUTBOX_KEY)) || "{}").owner).toBe("anna");
  await view.unmount();
});

test("viele Zählungen kurz hintereinander sind eine Meldung; nach einem Fehler kommt der nächste Versuch später; eine neue Stufe wird gemeldet", async () => {
  const awarded: number[] = [];
  const view = await render(<Sync userId="anna" onAwarded={(count) => awarded.push(count)} />);
  await advance(FIRST_FLUSH_MS + 50);
  expect(mockApi.post).not.toHaveBeenCalled();
  for (let i = 0; i < 8; i += 1) {
    await recordSignal("halloween_bats_scared", { onceIf: false });
    await advance(100);
  }
  expect(mockApi.post).not.toHaveBeenCalled();
  mockApi.post.mockImplementationOnce(async (_url: string, body: { items: unknown[] }) => ({ data: { accepted: body.items.length, newly_awarded: 1 } }));
  await advance(FLUSH_DELAY_MS + 50);
  expect(mockApi.post).toHaveBeenCalledTimes(1);
  expect(mockApi.post.mock.calls[0][1]).toEqual({ items: [{ name: "halloween_bats_scared", day: "2026-10-30", count: 8 }] });
  expect(awarded).toEqual([1]);
  mockApi.post.mockRejectedValueOnce(new Error("Netz weg"));
  await recordSignal("halloween_bats_scared", { onceIf: false });
  await advance(FLUSH_DELAY_MS + 50);
  expect(mockApi.post).toHaveBeenCalledTimes(2);
  expect(await outboxSize()).toBe(1);
  await advance(RETRY_MS - 2000);
  expect(mockApi.post).toHaveBeenCalledTimes(2);
  await advance(3000);
  expect(mockApi.post).toHaveBeenCalledTimes(3);
  expect(await outboxSize()).toBe(0);
  await view.unmount();
});

test("geht die App in den Hintergrund, wird sofort gemeldet; kommt sie nach vorne, wird nachgemeldet; abgemeldet hört niemand zu", async () => {
  const handlers: Array<(state: string) => void> = [];
  const remove = jest.fn();
  const spy = jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, handler: (state: string) => void) => {
    handlers.push(handler);
    return { remove };
  }) as never);
  const view = await render(<Sync userId="anna" />);
  await advance(FIRST_FLUSH_MS + 50);
  await recordSignal("halloween_bats_scared", { onceIf: false });
  await act(async () => {
    handlers.forEach((handler) => handler("background"));
  });
  await advance(30);
  expect(mockApi.post).toHaveBeenCalledTimes(1);
  await recordSignal("halloween_ghosts_freed", { onceIf: false });
  mockApi.post.mockClear();
  await advance(FLUSH_DELAY_MS + 50);
  expect(mockApi.post).toHaveBeenCalledTimes(1);
  await act(async () => {
    handlers.forEach((handler) => handler("active"));
  });
  await advance(FIRST_FLUSH_MS + 50);
  // Der Ausgang ist leer: es gibt nichts nachzumelden.
  expect(mockApi.post).toHaveBeenCalledTimes(1);
  await view.unmount();
  expect(remove).toHaveBeenCalled();
  await recordSignal("halloween_bats_scared", { onceIf: false });
  await advance(RETRY_MS);
  expect(mockApi.post).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});
