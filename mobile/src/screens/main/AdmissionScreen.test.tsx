import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AdmissionScreen } from "./AdmissionScreen";

// Einlass in der App (#845, Entscheidung B): Scan → „Anwesend: <Name>, stimmberechtigt“ groß und grün; doppelt
// ändert nichts (Hinweis gelb); Ablehnung rot mit dem Grund vom Server; ohne Karte die Mitgliedsnummer; Rücknahme nur
// mit Grund; ohne Kamerarecht der Weg dorthin, die Nummer geht trotzdem.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: unknown, fallback: string) => {
    const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
    return typeof detail === "string" ? detail : fallback;
  },
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
const mockPermission: { granted: boolean; canAskAgain: boolean } = { granted: true, canAskAgain: true };
const mockRequestPermission = jest.fn(async () => mockPermission);
jest.mock("expo-camera", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    CameraView: ({ testID, onBarcodeScanned }: { testID?: string; onBarcodeScanned?: (event: { data: string }) => void }) =>
      React.createElement(View, { testID, onBarcodeScanned }),
    useCameraPermissions: () => [mockPermission, mockRequestPermission],
  };
});

const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
const route = { key: "Admission", name: "Admission", params: undefined } as never;

const MEETING = { id: 41, title: "Generalversammlung 2026", time: "18:00", place: "Vereinsheim", counts: { present: 2, eligible: 20, quorum_from: 11, quorum_reached: false },
  recent: [{ member_id: 7, name: "Paula Muster", state: "present", voting: true, reason_text: "stimmberechtigt", arrived: "18:02" }] };

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockReset();
  mockPermission.granted = true;
  mockPermission.canAskAgain = true;
  mockGet.mockResolvedValue({ data: { ready: true, meetings: [MEETING] } });
});

async function scan(code: string) {
  await fireEvent(screen.getByTestId("admission-camera"), "barcodeScanned", { data: code });
}

test("Scan: Anwesend groß und grün, Zahlen und Liste neu; derselbe Code gleich noch einmal zählt nicht", async () => {
  mockPost.mockResolvedValueOnce({ data: { ok: true, already: false, admission: { member_id: 9, name: "Max Beispiel", state: "present", voting: true, reason_text: "stimmberechtigt", arrived: "18:05" },
    counts: { present: 3, eligible: 20, quorum_from: 11, quorum_reached: false }, headline: "Anwesend: Max Beispiel, stimmberechtigt", detail: "ab 18:05" } });
  await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^2 anwesend/));
  await scan("https://lionsquad.at/card/abc");
  await waitFor(() => expect(screen.getByTestId("admission-result-headline")).toHaveTextContent("Anwesend: Max Beispiel, stimmberechtigt"));
  expect(mockPost).toHaveBeenCalledWith("/admin/admission/41/scan", { code: "https://lionsquad.at/card/abc" });
  expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^3 anwesend/);
  expect(screen.getByTestId("admission-row-9")).toHaveTextContent(/Max Beispiel/);
  await scan("https://lionsquad.at/card/abc");
  expect(mockPost).toHaveBeenCalledTimes(1);
});

test("Ablehnung: rot mit dem Grund vom Server; ohne Karte die Mitgliedsnummer", async () => {
  mockPost.mockRejectedValueOnce({ response: { status: 404, data: { detail: "Diese Karte ist abgelaufen." } } });
  mockPost.mockResolvedValueOnce({ data: { ok: true, already: true, admission: { member_id: 7, name: "Paula Muster", state: "present", voting: false, reason_text: "ohne Stimmrecht" },
    counts: MEETING.counts, headline: "Schon da: Paula Muster", detail: "ohne Stimmrecht" } });
  await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-camera")).toBeTruthy());
  await scan("https://lionsquad.at/card/alt");
  await waitFor(() => expect(screen.getByTestId("admission-result-headline")).toHaveTextContent("Nicht eingelassen"));
  expect(screen.getByTestId("admission-result")).toHaveTextContent(/Diese Karte ist abgelaufen\./);

  await fireEvent.changeText(screen.getByTestId("admission-number"), "1042");
  await fireEvent.press(screen.getByTestId("admission-number-submit"));
  await waitFor(() => expect(screen.getByTestId("admission-result-headline")).toHaveTextContent("Schon da: Paula Muster"));
  expect(mockPost).toHaveBeenLastCalledWith("/admin/admission/41/scan", { number: "1042" });
  expect(screen.getByTestId("admission-number").props.value).toBe("");
});

test("Rücknahme nur mit Grund; danach steht die Zeile durchgestrichen", async () => {
  mockPost.mockResolvedValueOnce({ data: { ok: true, admission: { member_id: 7, name: "Paula Muster", state: "undone", undo_reason: "falscher Ausweis" }, counts: { present: 1, eligible: 20, quorum_from: 11, quorum_reached: false } } });
  await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-undo-7")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("admission-undo-7"));
  expect(screen.getByTestId("admission-undo-confirm").props.accessibilityState?.disabled ?? false).toBe(true);
  await fireEvent.changeText(screen.getByTestId("admission-undo-reason"), "falscher Ausweis");
  await fireEvent.press(screen.getByTestId("admission-undo-confirm"));
  await waitFor(() => expect(screen.getByTestId("admission-result-headline")).toHaveTextContent("Zurückgenommen: Paula Muster"));
  expect(mockPost).toHaveBeenCalledWith("/admin/admission/41/undo", { member_id: 7, reason: "falscher Ausweis" });
  expect(screen.getByTestId("admission-row-7")).toHaveTextContent(/zurückgenommen: falscher Ausweis/);
  expect(screen.queryByTestId("admission-undo-7")).toBeNull();
  expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^1 anwesend/);
});

test("ohne Kamerarecht: der Knopf fragt; endgültig verweigert der Weg in die Einstellungen - die Nummer geht trotzdem", async () => {
  mockPermission.granted = false;
  const asking = await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-camera-permission")).toBeTruthy());
  expect(screen.queryByTestId("admission-camera")).toBeNull();
  await fireEvent.press(screen.getByTestId("admission-camera-allow"));
  expect(mockRequestPermission).toHaveBeenCalled();
  expect(screen.getByTestId("admission-number")).toBeTruthy();
  await asking.unmount();

  mockPermission.canAskAgain = false;
  await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-camera-permission")).toBeTruthy());
  expect(screen.queryByTestId("admission-camera-allow")).toBeNull();
  expect(screen.getByTestId("admission-camera-permission")).toHaveTextContent(/Android-Einstellungen/);
});

test("keine Versammlung heute: der Grund vom Server, kein Scanner", async () => {
  mockGet.mockResolvedValueOnce({ data: { ready: false, reason: "no_meeting", text: "Heute ist keine Generalversammlung angesetzt.", meetings: [] } });
  await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-not-ready")).toHaveTextContent(/Heute ist keine Generalversammlung angesetzt\./));
  expect(screen.queryByTestId("admission-scanner")).toBeNull();
});
