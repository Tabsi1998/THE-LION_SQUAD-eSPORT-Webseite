import React from "react";
import { AppState } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
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
const mockGetPermission = jest.fn(async () => mockPermission);
// Ob der Einlass vorne ist (#1056): ein anderer Screen darüber gibt die Kamera frei.
let mockFocused = true;
jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useIsFocused: () => mockFocused }));
// Live-Strom (#1063): der Test löst die Meldung „Einlass geändert“ selbst aus.
const mockLive: { callback: (() => unknown) | null; resources: readonly string[]; enabled: boolean | undefined } = { callback: null, resources: [], enabled: undefined };
jest.mock("../../realtime/LiveChangesProvider", () => ({
  useLiveRefresh: (callback: () => unknown, resources: readonly string[], options: { enabled?: boolean } = {}) => {
    mockLive.callback = callback;
    mockLive.resources = resources;
    mockLive.enabled = options.enabled;
  },
}));
jest.mock("expo-camera", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    CameraView: ({ testID, onBarcodeScanned }: { testID?: string; onBarcodeScanned?: (event: { data: string }) => void }) =>
      React.createElement(View, { testID, onBarcodeScanned }),
    useCameraPermissions: () => [mockPermission, mockRequestPermission, mockGetPermission],
  };
});

const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
const route = { key: "Admission", name: "Admission", params: undefined } as never;

const MEETING = { id: 41, title: "Generalversammlung 2026", time: "18:00", place: "Vereinsheim", counts: { present: 2, eligible: 20, quorum_from: 11, quorum_reached: false },
  recent: [{ member_id: 7, name: "Paula Muster", state: "present", voting: true, reason_text: "stimmberechtigt", arrived: "18:02" }] };

let appStateListeners: ((state: string) => void)[] = [];
let appStateSpy: jest.SpyInstance | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockReset();
  mockGet.mockReset();
  mockPermission.granted = true;
  mockPermission.canAskAgain = true;
  mockFocused = true;
  mockLive.callback = null;
  mockGet.mockResolvedValue({ data: { ready: true, meetings: [MEETING] } });
  appStateListeners = [];
  appStateSpy = jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, listener: (state: string) => void) => {
    appStateListeners.push(listener);
    return { remove: () => { appStateListeners = appStateListeners.filter((item) => item !== listener); } };
  }) as never);
});

afterEach(() => {
  appStateSpy?.mockRestore();
  jest.useRealTimers();
});

async function appGoes(state: "background" | "active") {
  await act(async () => {
    for (const listener of [...appStateListeners]) listener(state);
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

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

// #1005: nach dem Nachladen nur eine Versammlung behalten, die es noch gibt; leere Liste mit Hinweis;
// Wechsel der Versammlung setzt Ergebnis, Rücknahme und Scan-Sperre zurück.

const OTHER = { id: 42, title: "Außerordentliche GV", time: "20:00", place: "Vereinsheim", counts: { present: 5, eligible: 20, quorum_from: 11, quorum_reached: false }, recent: [] };

async function pullToRefresh() {
  const [scroll] = screen.container.queryAll((node) => Boolean(node.props.refreshControl));
  await act(async () => {
    await scroll.props.refreshControl.props.onRefresh();
  });
}

test("Versammlung 41 fällt beim Nachladen weg: die App wählt 42, Scanner und Zählung gehören zu 42", async () => {
  await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^2 anwesend/));
  mockGet.mockResolvedValue({ data: { ready: true, meetings: [OTHER] } });
  await pullToRefresh();
  await waitFor(() => expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^5 anwesend/));
  expect(screen.getByTestId("admission-meeting-card")).toHaveTextContent(/Außerordentliche GV/);
  expect(screen.getByTestId("admission-camera")).toBeTruthy();
  mockPost.mockResolvedValueOnce({ data: { ok: true, already: false, admission: { member_id: 9, name: "Max Beispiel", state: "present", voting: true, reason_text: "stimmberechtigt" },
    counts: { ...OTHER.counts, present: 6 }, headline: "Anwesend: Max Beispiel, stimmberechtigt" } });
  await scan("https://lionsquad.at/card/abc");
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/admin/admission/42/scan", { code: "https://lionsquad.at/card/abc" }));
});

test("leere Liste trotz bereit: verständlicher Hinweis; ein weiteres Nachladen stellt die Auswahl ohne Neustart wieder her", async () => {
  await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-camera")).toBeTruthy());
  mockGet.mockResolvedValue({ data: { ready: true, meetings: [] } });
  await pullToRefresh();
  await waitFor(() => expect(screen.getByTestId("admission-no-meeting")).toBeTruthy());
  expect(screen.queryByTestId("admission-scanner")).toBeNull();

  mockGet.mockResolvedValue({ data: { ready: true, meetings: [MEETING, OTHER] } });
  await pullToRefresh();
  await waitFor(() => expect(screen.getByTestId("admission-camera")).toBeTruthy());
  expect(screen.getByTestId("admission-meetings")).toBeTruthy();
  expect(screen.queryByTestId("admission-no-meeting")).toBeNull();
});

test("Nachladen mit ready=false zeigt den Grund statt eines leeren Bildschirms", async () => {
  await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-camera")).toBeTruthy());
  mockGet.mockResolvedValue({ data: { ready: false, text: "Die Versammlung ist beendet.", meetings: [] } });
  await pullToRefresh();
  await waitFor(() => expect(screen.getByTestId("admission-not-ready")).toHaveTextContent(/Die Versammlung ist beendet\./));
  expect(screen.queryByTestId("admission-scanner")).toBeNull();
});

test("Wechsel der Versammlung setzt Ergebnis, offene Rücknahme und Scan-Sperre zurück", async () => {
  mockGet.mockResolvedValue({ data: { ready: true, meetings: [MEETING, OTHER] } });
  mockPost.mockResolvedValue({ data: { ok: true, already: false, admission: { member_id: 9, name: "Max Beispiel", state: "present", voting: true, reason_text: "stimmberechtigt" },
    counts: MEETING.counts, headline: "Anwesend: Max Beispiel, stimmberechtigt" } });
  await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-camera")).toBeTruthy());
  await scan("https://lionsquad.at/card/abc");
  await waitFor(() => expect(screen.getByTestId("admission-result")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("admission-undo-7"));
  expect(screen.getByTestId("admission-undo-reason")).toBeTruthy();

  await fireEvent.press(screen.getByTestId("admission-meeting-42"));
  expect(screen.queryByTestId("admission-result")).toBeNull();
  expect(screen.queryByTestId("admission-undo-reason")).toBeNull();
  // Dieselbe Karte gleich danach für die andere Versammlung: die Sperre gegen Doppelscans gilt nicht über den Wechsel.
  await scan("https://lionsquad.at/card/abc");
  await waitFor(() => expect(mockPost).toHaveBeenLastCalledWith("/admin/admission/42/scan", { code: "https://lionsquad.at/card/abc" }));
  expect(mockPost).toHaveBeenCalledTimes(2);

  // Zurück zu 41: die Rücknahme-Form von vorhin ist nicht wieder offen.
  await fireEvent.press(screen.getByTestId("admission-meeting-41"));
  expect(screen.queryByTestId("admission-undo-reason")).toBeNull();
});

// #1056: Kamera und Scan im Lebenslauf des Screens - im Hintergrund und unter einem anderen Screen ist die Kamera aus,
// beim Zurückkommen startet sie neu (und das Kamerarecht wird neu gelesen, es kann in den Einstellungen geändert worden
// sein). Ein Bild, das danach noch ankommt, zählt nicht; während ein Scan läuft, zählt kein zweiter.

test("Kamera nur, solange der Einlass vorne ist: Hintergrund und anderer Screen geben sie frei, zurück startet sie neu", async () => {
  const view = await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-camera")).toBeTruthy());
  const loadsBefore = mockGet.mock.calls.length;

  await appGoes("background");
  expect(screen.queryByTestId("admission-camera")).toBeNull();
  mockGetPermission.mockClear();
  await appGoes("active");
  await waitFor(() => expect(screen.getByTestId("admission-camera")).toBeTruthy());
  // Zurück aus dem Hintergrund: Kamerarecht und Zahlen werden neu gelesen.
  expect(mockGetPermission).toHaveBeenCalled();
  await waitFor(() => expect(mockGet.mock.calls.length).toBeGreaterThan(loadsBefore));

  mockFocused = false;
  await view.rerender(<AdmissionScreen navigation={navigation} route={route} />);
  expect(screen.queryByTestId("admission-camera")).toBeNull();
  mockFocused = true;
  await view.rerender(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-camera")).toBeTruthy());
});

test("kein Doppel-Scan: ein Bild nach dem Verlassen zählt nicht, und solange ein Scan läuft, zählt kein zweiter", async () => {
  await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-camera")).toBeTruthy());
  const lateFrame = screen.getByTestId("admission-camera").props.onBarcodeScanned as (event: { data: string }) => void;
  await appGoes("background");
  await act(async () => lateFrame({ data: "https://lionsquad.at/card/spaet" }));
  expect(mockPost).not.toHaveBeenCalled();

  await appGoes("active");
  await waitFor(() => expect(screen.getByTestId("admission-camera")).toBeTruthy());
  const pending = deferred<unknown>();
  mockPost.mockReturnValueOnce(pending.promise);
  const frame = screen.getByTestId("admission-camera").props.onBarcodeScanned as (event: { data: string }) => void;
  const now = jest.spyOn(Date, "now");
  try {
    now.mockReturnValue(1_000_000);
    // Zwei Bilder kurz hintereinander, bevor der Screen neu gezeichnet ist - das zweite nach der Ruhezeit, aber der
    // erste Scan ist noch unterwegs.
    await act(async () => {
      frame({ data: "https://lionsquad.at/card/eins" });
      now.mockReturnValue(1_004_000);
      frame({ data: "https://lionsquad.at/card/zwei" });
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
  } finally {
    now.mockRestore();
  }
  await act(async () => pending.resolve({ data: { ok: true, admission: { member_id: 9, name: "Max Beispiel", state: "present", voting: true }, counts: MEETING.counts } }));
});

// #1063: Mehrere Geräte scannen gleichzeitig - die Zahlen kommen nach (Live-Meldung, alle 10 Sekunden, beim
// Zurückkommen), ohne Ladeanzeige und ohne Ergebnis oder offene Rücknahme zu verlieren; eine ältere Antwort überschreibt
// nie neuere Zahlen; ein Aussetzer lässt den letzten Stand stehen.

const LATER = { ...MEETING, counts: { present: 12, eligible: 20, quorum_from: 11, quorum_reached: true },
  recent: [{ member_id: 12, name: "Lena Zweitgerät", state: "present", voting: true, reason_text: "stimmberechtigt", arrived: "18:07" }, ...MEETING.recent] };

test("anderes Gerät scannt: alle 10 Sekunden neue Zahlen und Liste - ohne Ladeanzeige, die offene Rücknahme bleibt", async () => {
  jest.useFakeTimers();
  await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^2 anwesend/));
  await fireEvent.press(screen.getByTestId("admission-undo-7"));
  await fireEvent.changeText(screen.getByTestId("admission-undo-reason"), "falscher Ausweis");

  mockGet.mockResolvedValue({ data: { ready: true, meetings: [LATER] } });
  await act(async () => { jest.advanceTimersByTime(10_000); });
  await waitFor(() => expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^12 anwesend .* – beschlussfähig$/));
  expect(screen.getByTestId("admission-row-12")).toHaveTextContent(/Lena Zweitgerät/);
  expect(screen.queryByTestId("admission-loading")).toBeNull();
  expect(screen.getByTestId("admission-undo-reason").props.value).toBe("falscher Ausweis");
  expect(screen.getByTestId("admission-camera")).toBeTruthy();

  // Im Hintergrund fragt die App nicht nach.
  await appGoes("background");
  const calls = mockGet.mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(mockGet.mock.calls.length).toBe(calls);
});

test("Live-Meldung „Einlass geändert“ lädt die Zahlen sofort nach; nur solange der Einlass vorne ist", async () => {
  const view = await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^2 anwesend/));
  expect(mockLive.resources).toEqual(["admin/admission"]);
  expect(mockLive.enabled).toBe(true);
  mockGet.mockResolvedValue({ data: { ready: true, meetings: [LATER] } });
  await act(async () => { await mockLive.callback?.(); });
  await waitFor(() => expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^12 anwesend/));
  mockFocused = false;
  await view.rerender(<AdmissionScreen navigation={navigation} route={route} />);
  expect(mockLive.enabled).toBe(false);
});

test("eine Abfrage, die vor dem eigenen Scan losging, überschreibt die neueren Zahlen nicht", async () => {
  jest.useFakeTimers();
  await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^2 anwesend/));
  const slow = deferred<unknown>();
  mockGet.mockReturnValueOnce(slow.promise);
  const callsBefore = mockGet.mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(10_000); });
  expect(mockGet.mock.calls.length).toBe(callsBefore + 1);

  mockPost.mockResolvedValueOnce({ data: { ok: true, already: false, admission: { member_id: 9, name: "Max Beispiel", state: "present", voting: true, reason_text: "stimmberechtigt" },
    counts: { present: 3, eligible: 20, quorum_from: 11, quorum_reached: false }, headline: "Anwesend: Max Beispiel, stimmberechtigt" } });
  await scan("https://lionsquad.at/card/abc");
  await waitFor(() => expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^3 anwesend/));

  await act(async () => slow.resolve({ data: { ready: true, meetings: [MEETING] } }));
  expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^3 anwesend/);
  expect(screen.getByTestId("admission-row-9")).toBeTruthy();
  expect(screen.getByTestId("admission-result-headline")).toHaveTextContent("Anwesend: Max Beispiel, stimmberechtigt");

  mockGet.mockResolvedValue({ data: { ready: true, meetings: [{ ...LATER, counts: { ...LATER.counts, present: 13 } }] } });
  await act(async () => { jest.advanceTimersByTime(10_000); });
  await waitFor(() => expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^13 anwesend/));
});

test("Aussetzer beim Nachfragen: der letzte Stand bleibt stehen, mit Hinweis; die nächste Antwort nimmt den Hinweis weg", async () => {
  jest.useFakeTimers();
  await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^2 anwesend/));
  mockGet.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { jest.advanceTimersByTime(10_000); });
  await waitFor(() => expect(screen.getByTestId("admission-stale")).toBeTruthy());
  expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^2 anwesend/);
  expect(screen.getByTestId("admission-camera")).toBeTruthy();
  expect(screen.queryByTestId("admission-not-ready")).toBeNull();

  mockGet.mockResolvedValue({ data: { ready: true, meetings: [LATER] } });
  await act(async () => { jest.advanceTimersByTime(10_000); });
  await waitFor(() => expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^12 anwesend/));
  expect(screen.queryByTestId("admission-stale")).toBeNull();
});

// #1064: Ergebnis und Rücknahme gehören zu genau einer Versammlung. Eine Antwort, die nach einem Wechsel ankommt, zeigt
// nichts mehr an - auch nicht nach einem Wechsel hin und zurück (Anfrage-Kennung); die Daten landen trotzdem bei der
// richtigen Versammlung. Die Rücknahme geht nur an die Versammlung, in der sie geöffnet wurde.

const TWO = { ...MEETING, recent: [...MEETING.recent, { member_id: 8, name: "Kim Probe", state: "present", voting: true, reason_text: "stimmberechtigt", arrived: "18:03" }] };

test("späte Scan-Antwort nach Wechsel hin und zurück: kein Ergebnis, die Zahlen landen trotzdem bei der richtigen Versammlung", async () => {
  mockGet.mockResolvedValue({ data: { ready: true, meetings: [MEETING, OTHER] } });
  await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-camera")).toBeTruthy());
  const pending = deferred<unknown>();
  mockPost.mockReturnValueOnce(pending.promise);
  await scan("https://lionsquad.at/card/abc");
  expect(mockPost).toHaveBeenCalledWith("/admin/admission/41/scan", { code: "https://lionsquad.at/card/abc" });

  await fireEvent.press(screen.getByTestId("admission-meeting-42"));
  await fireEvent.press(screen.getByTestId("admission-meeting-41"));
  await act(async () => pending.resolve({ data: { ok: true, already: false, admission: { member_id: 9, name: "Max Beispiel", state: "present", voting: true, reason_text: "stimmberechtigt" },
    counts: { ...MEETING.counts, present: 3 }, headline: "Anwesend: Max Beispiel, stimmberechtigt" } }));
  expect(screen.queryByTestId("admission-result")).toBeNull();
  expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^3 anwesend/);
  expect(screen.getByTestId("admission-row-9")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("admission-meeting-42"));
  expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^5 anwesend/);
  expect(screen.queryByTestId("admission-row-9")).toBeNull();
});

test("späte Rücknahme-Antwort nach Wechsel hin und zurück: kein Ergebnis, die neu geöffnete Rücknahme bleibt offen", async () => {
  mockGet.mockResolvedValue({ data: { ready: true, meetings: [TWO, OTHER] } });
  await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-undo-7")).toBeTruthy());
  const pending = deferred<unknown>();
  mockPost.mockReturnValueOnce(pending.promise);
  await fireEvent.press(screen.getByTestId("admission-undo-7"));
  await fireEvent.changeText(screen.getByTestId("admission-undo-reason"), "falscher Ausweis");
  await fireEvent.press(screen.getByTestId("admission-undo-confirm"));
  expect(mockPost).toHaveBeenCalledWith("/admin/admission/41/undo", { member_id: 7, reason: "falscher Ausweis" });

  await fireEvent.press(screen.getByTestId("admission-meeting-42"));
  await fireEvent.press(screen.getByTestId("admission-meeting-41"));
  await fireEvent.press(screen.getByTestId("admission-undo-8"));
  await fireEvent.changeText(screen.getByTestId("admission-undo-reason"), "doppelt gezählt");
  await act(async () => pending.resolve({ data: { ok: true, admission: { member_id: 7, name: "Paula Muster", state: "undone", undo_reason: "falscher Ausweis" },
    counts: { ...MEETING.counts, present: 1 } } }));
  expect(screen.queryByTestId("admission-result")).toBeNull();
  expect(screen.getByTestId("admission-undo-reason").props.value).toBe("doppelt gezählt");
  expect(screen.getByTestId("admission-row-7")).toHaveTextContent(/zurückgenommen: falscher Ausweis/);
});

test("dieselbe Person in beiden Versammlungen: die Rücknahme-Form der vorigen ist nach dem Wechsel weg und schickt nichts an die andere", async () => {
  const otherWithSame = { ...OTHER, recent: [{ member_id: 7, name: "Paula Muster", state: "present", voting: true, reason_text: "stimmberechtigt", arrived: "20:01" }] };
  mockGet.mockResolvedValue({ data: { ready: true, meetings: [MEETING, otherWithSame] } });
  await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-undo-7")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("admission-undo-7"));
  await fireEvent.changeText(screen.getByTestId("admission-undo-reason"), "falscher Ausweis");
  await fireEvent.press(screen.getByTestId("admission-meeting-42"));
  expect(screen.queryByTestId("admission-undo-reason")).toBeNull();
  expect(screen.queryByTestId("admission-undo-confirm")).toBeNull();
  expect(mockPost).not.toHaveBeenCalled();
});

test("hängender Scan der vorigen Versammlung sperrt die neue nicht, und seine späte Antwort löst die neue Sperre nicht", async () => {
  mockGet.mockResolvedValue({ data: { ready: true, meetings: [MEETING, OTHER] } });
  await render(<AdmissionScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("admission-camera")).toBeTruthy());
  const old = deferred<unknown>();
  mockPost.mockReturnValueOnce(old.promise);
  await scan("https://lionsquad.at/card/alt");
  expect(mockPost).toHaveBeenLastCalledWith("/admin/admission/41/scan", { code: "https://lionsquad.at/card/alt" });

  // Wechsel zu 42: Scan und Nummer gehen sofort, ohne auf die Antwort für 41 zu warten.
  await fireEvent.press(screen.getByTestId("admission-meeting-42"));
  expect(screen.getByTestId("admission-camera").props.onBarcodeScanned).toEqual(expect.any(Function));
  await fireEvent.changeText(screen.getByTestId("admission-number"), "1042");
  expect(screen.getByTestId("admission-number-submit").props.accessibilityState?.disabled ?? false).toBe(false);
  await fireEvent.changeText(screen.getByTestId("admission-number"), "");
  const fresh = deferred<unknown>();
  mockPost.mockReturnValueOnce(fresh.promise);
  await scan("https://lionsquad.at/card/neu");
  expect(mockPost).toHaveBeenLastCalledWith("/admin/admission/42/scan", { code: "https://lionsquad.at/card/neu" });
  expect(mockPost).toHaveBeenCalledTimes(2);

  // Die späte Antwort für 41 gibt die laufende Sperre von 42 nicht frei.
  await act(async () => old.resolve({ data: { ok: true, admission: { member_id: 9, name: "Max Beispiel", state: "present", voting: true }, counts: { ...MEETING.counts, present: 3 } } }));
  expect(screen.getByTestId("admission-camera").props.onBarcodeScanned).toBeUndefined();
  expect(screen.getByTestId("admission-number-submit").props.accessibilityState?.disabled).toBe(true);
  expect(screen.queryByTestId("admission-result")).toBeNull();

  await act(async () => fresh.resolve({ data: { ok: true, already: false, admission: { member_id: 11, name: "Nora Neu", state: "present", voting: true },
    counts: { ...OTHER.counts, present: 6 }, headline: "Anwesend: Nora Neu, stimmberechtigt" } }));
  expect(screen.getByTestId("admission-result-headline")).toHaveTextContent("Anwesend: Nora Neu, stimmberechtigt");
  expect(screen.getByTestId("admission-counts")).toHaveTextContent(/^6 anwesend/);
  expect(screen.getByTestId("admission-camera").props.onBarcodeScanned).toEqual(expect.any(Function));
});
