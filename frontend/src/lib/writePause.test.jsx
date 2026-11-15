import { act, cleanup, render, screen } from "@testing-library/react";
import { AxiosError } from "axios";
import { api, formatRequestError } from "./api";
import { isWritePauseError, noteWritePause, resetWritePause, retryAfterSeconds, writePauseSnapshot } from "./writePause";
import { resetNetwork } from "./network";
import { OfflineBar } from "@/components/tls/OfflineBar";

// Kurze Schreibpause fürs Backup (#1009): Der Server antwortet auf Speichern mit 503 „gleich wieder da“. Die Seite zeigt
// den Text der Antwort, die Leiste unter dem Kopf sagt dasselbe und verschwindet nach „Retry-After“ von selbst.

const MESSAGE = "Kurze Wartung: Wir sichern gerade die Daten. Lesen geht weiter, Speichern ist gleich wieder möglich. Bitte versuch es in einer Minute noch einmal.";

function pauseError(config = {}, headers = { "retry-after": "20" }) {
  return new AxiosError("Request failed with status code 503", "ERR_BAD_RESPONSE", config, null, {
    status: 503,
    data: { detail: MESSAGE, code: "write_pause", retry_after: 20 },
    headers,
    config,
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetWritePause();
  resetNetwork();
});

test("erkennt die Antwort der Schreibpause - andere 503 nicht", () => {
  expect(isWritePauseError(pauseError())).toBe(true);
  expect(isWritePauseError({ response: { status: 503, data: { detail: "Bad Gateway" } } })).toBe(false);
  expect(isWritePauseError({ response: { status: 500, data: { code: "write_pause" } } })).toBe(false);
  expect(isWritePauseError(new Error("Network Error"))).toBe(false);
});

test("Wartezeit aus Retry-After, sonst aus dem Inhalt, sonst 30 Sekunden - höchstens fünf Minuten", () => {
  expect(retryAfterSeconds(pauseError())).toBe(20);
  expect(retryAfterSeconds({ response: { data: { retry_after: 12 } } })).toBe(12);
  expect(retryAfterSeconds({ response: { headers: {}, data: {} } })).toBe(30);
  expect(retryAfterSeconds({ response: { headers: { "retry-after": "9999" } } })).toBe(300);
  expect(retryAfterSeconds({ response: { headers: { "retry-after": "bald" } } })).toBe(30);
});

test("die Leiste sagt „gleich wieder da“ und verschwindet nach der genannten Zeit", () => {
  vi.useFakeTimers();
  render(<OfflineBar />);
  expect(screen.queryByTestId("write-pause-bar")).toBeNull();
  act(() => noteWritePause(20));
  expect(screen.getByTestId("write-pause-bar")).toHaveTextContent("Speichern ist gleich wieder möglich");
  expect(screen.getByTestId("write-pause-bar")).toHaveTextContent("Lesen geht weiter");
  act(() => vi.advanceTimersByTime(19_000));
  expect(screen.getByTestId("write-pause-bar")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1_500));
  expect(screen.queryByTestId("write-pause-bar")).toBeNull();
});

test("ohne Netz geht die Offline-Leiste vor", () => {
  render(<OfflineBar />);
  act(() => noteWritePause(20));
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
  expect(screen.getByTestId("offline-bar")).toBeInTheDocument();
  expect(screen.queryByTestId("write-pause-bar")).toBeNull();
});

test("der API-Client meldet die Pause, die Seite bekommt den Text des Servers", async () => {
  const adapter = (config) => Promise.reject(pauseError(config));
  const failure = await api.post("/tournaments/t1/register", {}, { adapter }).catch((error) => error);
  expect(failure.response.status).toBe(503);
  expect(writePauseSnapshot().active).toBe(true);
  expect(formatRequestError(failure)).toBe(MESSAGE);
});

test("ein anderer Fehler löst die Leiste nicht aus", async () => {
  const adapter = (config) => Promise.reject(new AxiosError("Request failed with status code 503", "ERR_BAD_RESPONSE", config, null, {
    status: 503, data: "<html>Bad Gateway</html>", headers: {}, config,
  }));
  await api.post("/news", {}, { adapter }).catch(() => null);
  expect(writePauseSnapshot().active).toBe(false);
});
