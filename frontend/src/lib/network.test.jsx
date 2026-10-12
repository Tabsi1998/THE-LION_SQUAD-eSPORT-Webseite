import { act, render, screen } from "@testing-library/react";
import { networkSnapshot, noteFresh, noteOffline, offlineLabel, resetNetwork, watchBrowserNetwork } from "./network";
import { problemKind } from "./loadProblem";
import { OfflineBar } from "@/components/tls/OfflineBar";

// Ohne Netz (#1152): der Browser und der API-Client melden „offline“; die Leiste nennt den Stand der zuletzt geladenen
// Daten und verschwindet, sobald das Netz zurück ist. Ein Ladefehler sagt, welcher Art er ist.

afterEach(() => resetNetwork());

test("Stand: die letzte echte Antwort - offline merkt ihn sich, online vergisst ihn", () => {
  const stand = Date.UTC(2026, 9, 8, 12, 5);
  noteFresh(stand);
  noteOffline();
  expect(networkSnapshot()).toEqual({ offline: true, stand });
  expect(offlineLabel(stand)).toBe("Offline · Stand 14:05");
  expect(offlineLabel(null)).toBe("Offline");
  noteFresh(stand + 1000);
  expect(networkSnapshot()).toEqual({ offline: false, stand: null });
});

test("der Browser meldet offline und online - die Leiste kommt und geht", () => {
  const stop = watchBrowserNetwork(window);
  render(<OfflineBar />);
  expect(screen.queryByTestId("offline-bar")).toBeNull();
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
  expect(screen.getByTestId("offline-bar")).toHaveTextContent("Offline · neu laden, sobald das Netz wieder da ist");
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  expect(screen.queryByTestId("offline-bar")).toBeNull();
  stop();
});

test("Art des Fehlers: ohne Antwort offline, 404 nicht gefunden, 403 nicht freigegeben, sonst Fehler", () => {
  expect(problemKind(new Error("Network Error"))).toBe("offline");
  expect(problemKind({ response: { status: 404 } })).toBe("notFound");
  expect(problemKind({ response: { status: 403 } })).toBe("denied");
  expect(problemKind({ response: { status: 500 } })).toBe("error");
});

test("ein Abruf ohne Antwort zeigt die Leiste nur, wenn der Browser offline meldet", async () => {
  const { noteRequestFailed } = await import("./network");
  resetNetwork();
  const online = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  noteRequestFailed();
  expect(networkSnapshot().offline).toBe(false);
  online.mockReturnValue(false);
  noteRequestFailed();
  expect(networkSnapshot().offline).toBe(true);
  online.mockRestore();
  resetNetwork();
});
