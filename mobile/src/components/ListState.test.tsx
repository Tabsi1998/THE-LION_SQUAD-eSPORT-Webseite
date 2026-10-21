import React from "react";
import { AccessibilityInfo, Text } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AxiosError, AxiosHeaders } from "axios";

// Zustände (#1152): leer mit nächstem Schritt, Fehler mit „Nochmal versuchen“ (nie „nichts da“), ohne Netz die Leiste
// „Offline · Stand 14:05“ - sie kommt und geht mit dem Netz; Platzhalter stehen mit „Bewegung reduzieren“ still.

jest.mock("@expo/vector-icons", () => {
  return { Ionicons: () => null };
});

const { EmptyState, ErrorState, OfflineBar, PartialLoadNotice, SkeletonCard, loadProblem } = require("./ListState");
const network = require("../lib/network");

function axiosError(status?: number, detail?: string) {
  const error = new AxiosError("kaputt", status ? "ERR_BAD_RESPONSE" : "ERR_NETWORK");
  if (status) {
    error.response = { status, data: detail ? { detail } : {}, statusText: "", headers: {}, config: { headers: new AxiosHeaders() } };
  }
  return error;
}

afterEach(() => {
  network.resetNetwork();
});

test("leer: Titel, warum, und genau der nächste Schritt als Knopf (dazu ein leiser zweiter Weg)", async () => {
  const discover = jest.fn();
  const code = jest.fn();
  await render(
    <EmptyState title="Noch kein Team" detail="Teams entstehen über eine Einladung." action={{ label: "Teams entdecken", onPress: discover, testID: "go" }} secondaryAction={{ label: "Join-Code eingeben", onPress: code, testID: "code" }} />,
  );
  expect(screen.getByText("Noch kein Team")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("go"));
  await fireEvent.press(screen.getByTestId("code"));
  expect(discover).toHaveBeenCalledTimes(1);
  expect(code).toHaveBeenCalledTimes(1);
});

test("Fehler: je nach Art eigener Text - ohne Netz und bei Fehlern „Nochmal versuchen“, bei „nicht gefunden“ der Text der Seite", async () => {
  expect(loadProblem(axiosError()).kind).toBe("offline");
  expect(loadProblem(axiosError(404)).kind).toBe("notFound");
  expect(loadProblem(axiosError(403, "Nur für Mitglieder.")).kind).toBe("denied");
  expect(loadProblem(axiosError(500)).kind).toBe("error");
  expect(loadProblem(new Error("x")).kind).toBe("error");

  const retry = jest.fn();
  await render(<ErrorState problem={loadProblem(axiosError())} title="Event nicht gefunden" onRetry={retry} />);
  expect(screen.getByText("Ohne Netz")).toBeTruthy();
  expect(screen.queryByText("Event nicht gefunden")).toBeNull();
  await fireEvent.press(screen.getByTestId("error-state-retry"));
  expect(retry).toHaveBeenCalledTimes(1);
  await screen.unmount();

  await render(<ErrorState problem={loadProblem(axiosError(500))} title="Event nicht gefunden" onRetry={retry} />);
  expect(screen.getByText("Laden hat nicht geklappt")).toBeTruthy();
  expect(screen.getByTestId("error-state-retry")).toBeTruthy();
  await screen.unmount();

  await render(<ErrorState problem={loadProblem(axiosError(404))} title="Event nicht gefunden" detail="Dieses Event ist nicht sichtbar." onRetry={retry} />);
  expect(screen.getByText("Event nicht gefunden")).toBeTruthy();
  expect(screen.queryByTestId("error-state-retry")).toBeNull();
  await screen.unmount();

  await render(<ErrorState problem={loadProblem(axiosError(403, "Nur für Mitglieder."))} onRetry={retry} />);
  expect(screen.getByText("Nur für Mitglieder.")).toBeTruthy();
});

test("Offline-Leiste: erscheint ohne Netz mit dem Stand der gezeigten Daten und verschwindet mit dem Netz", async () => {
  await render(<OfflineBar />);
  expect(screen.queryByTestId("offline-bar")).toBeNull();
  // 12:05 UTC = 14:05 in Wien (Sommerzeit). Die Uhr steht am selben Tag - ein Stand von heute zeigt nur die Uhrzeit (#1058).
  const stand = Date.UTC(2026, 9, 8, 12, 5);
  jest.useFakeTimers({ now: Date.UTC(2026, 9, 8, 15, 0), advanceTimers: true });
  await act(async () => {
    network.noteOffline(stand);
  });
  expect(screen.getByTestId("offline-bar")).toHaveTextContent("Offline · Stand 14:05 · zum Aktualisieren ziehen");
  // Ein älterer Stand aus dem Speicher gewinnt - die Leiste nennt den ältesten gezeigten.
  await act(async () => {
    network.noteOffline(stand - 60 * 60 * 1000);
  });
  expect(screen.getByTestId("offline-bar")).toHaveTextContent("Offline · Stand 13:05 · zum Aktualisieren ziehen");
  await act(async () => {
    network.noteFresh();
  });
  expect(screen.queryByTestId("offline-bar")).toBeNull();
  jest.useRealTimers();
});

test("Offline-Leiste: Daten von gestern tragen den Tag (#1058)", async () => {
  jest.useFakeTimers({ now: Date.UTC(2026, 9, 9, 8, 0), advanceTimers: true });
  await render(<OfflineBar />);
  await act(async () => {
    network.noteOffline(Date.UTC(2026, 9, 8, 12, 5));
  });
  expect(screen.getByTestId("offline-bar")).toHaveTextContent("Offline · Stand gestern 14:05 · zum Aktualisieren ziehen");
  await act(async () => {
    network.noteFresh();
  });
  jest.useRealTimers();
});

test("ohne bekannten Stand nur „Offline“; die Leiste hat einen Satz für den Vorleser", async () => {
  await render(<OfflineBar />);
  await act(async () => {
    network.noteOffline(null);
  });
  expect(screen.getByTestId("offline-bar")).toHaveTextContent("Offline · zum Aktualisieren ziehen");
  expect(screen.getByTestId("offline-bar").props.accessibilityLabel).toBe("Offline. Zum Aktualisieren nach unten ziehen.");
});

test("Teil-Fehler: eine Zeile mit „Nochmal“", async () => {
  const retry = jest.fn();
  await render(<PartialLoadNotice problem={{ kind: "error", message: "" }} onRetry={retry} />);
  expect(screen.getByText("Nicht alles geladen – manches ist vom letzten Laden.")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("partial-load-retry"));
  expect(retry).toHaveBeenCalledTimes(1);
});

test("Platzhalter: mit „Bewegung reduzieren“ still", async () => {
  const spy = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  await render(<><SkeletonCard /><Text>x</Text></>);
  await waitFor(() => expect(screen.getByTestId("skeleton-card").props["data-still"]).toBe("1"));
  spy.mockRestore();
});
