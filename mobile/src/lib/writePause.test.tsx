import React from "react";
import { act, render, screen } from "@testing-library/react-native";
import { WritePauseBar } from "../components/WritePauseBar";
import {
  WRITE_PAUSE_LABEL, isWritePauseError, noteWritePause, resetWritePause, retryAfterSeconds, writePauseSnapshot,
} from "./writePause";

// Schreibpause fürs Backup (#1009, App: #2173): Erkennen, Dauer und die Leiste oben im Screen.

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const pause = (headers: unknown = {}, data: Record<string, unknown> = { code: "write_pause" }) => ({ response: { status: 503, headers, data } });

afterEach(async () => {
  await act(async () => resetWritePause());
  jest.useRealTimers();
});

test("nur ein 503 mit Code „write_pause“ ist die Schreibpause", () => {
  expect(isWritePauseError(pause())).toBe(true);
  expect(isWritePauseError({ response: { status: 503, data: { detail: "überlastet" } } })).toBe(false);
  expect(isWritePauseError({ response: { status: 500, data: { code: "write_pause" } } })).toBe(false);
  expect(isWritePauseError(new Error("Network Error"))).toBe(false);
  expect(isWritePauseError(null)).toBe(false);
});

test("die Dauer kommt aus Retry-After, sonst aus dem Inhalt, sonst 30 Sekunden - höchstens 5 Minuten", () => {
  expect(retryAfterSeconds(pause({ "retry-after": "12" }))).toBe(12);
  expect(retryAfterSeconds(pause({ get: (name: string) => (name === "retry-after" ? "7" : undefined) }))).toBe(7);
  expect(retryAfterSeconds(pause({}, { code: "write_pause", retry_after: 20 }))).toBe(20);
  expect(retryAfterSeconds(pause({ "retry-after": "kaputt" }))).toBe(30);
  expect(retryAfterSeconds(pause({ "retry-after": "9999" }))).toBe(300);
});

test("die Leiste steht, solange die Pause läuft, und geht danach von selbst", async () => {
  jest.useFakeTimers();
  await render(<WritePauseBar />);
  expect(screen.queryByTestId("write-pause-bar")).toBeNull();
  await act(async () => noteWritePause(10));
  expect(screen.getByTestId("write-pause-bar")).toBeTruthy();
  expect(screen.getByText(WRITE_PAUSE_LABEL)).toBeTruthy();
  // Derselbe Satz wie im Web (frontend/src/lib/writePause.js).
  expect(WRITE_PAUSE_LABEL).toBe("Kurze Wartung: Wir sichern gerade die Daten. Lesen geht weiter, Speichern ist gleich wieder möglich.");
  // Eine kürzere Meldung verkürzt nichts.
  await act(async () => noteWritePause(2));
  await act(async () => { jest.advanceTimersByTime(5_000); });
  expect(screen.getByTestId("write-pause-bar")).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(6_000); });
  expect(writePauseSnapshot().active).toBe(false);
  expect(screen.queryByTestId("write-pause-bar")).toBeNull();
});
