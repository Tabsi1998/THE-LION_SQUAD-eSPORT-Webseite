import React from "react";
import { AccessibilityInfo, Alert, type AlertButton } from "react-native";
import * as Haptics from "expo-haptics";
import * as reanimated from "react-native-reanimated";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MemberJerseyNumber } from "./MemberJerseyNumber";

// Meine Nummer in der App (#2050, wie die Web-Karte aus #2034): einmal wählen mit Live-Prüfung und Bestätigung, danach
// nur über einen Antrag. Geprüft wird per POST (die Nummer gehört nicht in die Adresse).

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: { response?: { data?: { detail?: unknown } } } | undefined, fallback: string) =>
    (typeof error?.response?.data?.detail === "string" ? error.response.data.detail : fallback),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const open = {
  available: true, number: null, can_choose: true, again: false, free_count: 7, free_numbers: [0, 1, 2, 4, 5, 6, 7],
  range: { min: 0, max: 9 }, reserved: [3], dolibarr: null, open_request: null, requests: [],
};
const fixed = {
  ...open, number: 7, can_choose: false, free_count: 6, free_numbers: [0, 1, 2, 4, 5, 6], set_by: "member",
  chosen_at: "2026-10-26T10:00:00+00:00", dolibarr: { state: "ok", text: "Steht auch in der Mitgliederverwaltung." },
};

const checkReply = (body: { number: number }) => (body.number === 8
  ? { data: { number: 8, free: false, reason: "taken", text: "Diese Nummer hat schon jemand." } }
  : { data: { number: body.number, free: true, text: "Frei." } });

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

/** Drückt im zuletzt gezeigten Bestätigungs-Dialog den Knopf mit diesem Text. */
async function answer(text: string) {
  const buttons = (alertSpy.mock.calls.at(-1)?.[2] || []) as AlertButton[];
  const button = buttons.find((entry) => entry.text === text);
  expect(button).toBeTruthy();
  // Der Knopf startet das Senden nur an - die Antwort des Servers kommt im selben act() an.
  await act(async () => {
    button?.onPress?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test("ohne Mitgliedschaft bzw. Funktion aus: nur ein ruhiger Satz, kein Feld", async () => {
  mockGet.mockResolvedValue({ data: { available: false, reason: "not_member", text: "Eine eigene Nummer gibt es für Vereinsmitglieder." } });
  await render(<MemberJerseyNumber />);
  expect(await screen.findByTestId("jersey-off")).toHaveTextContent("Eine eigene Nummer gibt es für Vereinsmitglieder.");
  expect(screen.queryByTestId("jersey-input")).toBeNull();
  expect(screen.queryByTestId("jersey-error")).toBeNull();
});

test("ohne Antwort vom Server (älterer Stand, kein Netz) gibt es keine Karte", async () => {
  mockGet.mockRejectedValue(new Error("404"));
  await render(<MemberJerseyNumber />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/membership/me/jersey-number"));
  expect(screen.queryByTestId("jersey-card")).toBeNull();
});

test("wählen: Raster oder Feld, Live-Prüfung per POST, Bestätigung, dann setzt sich die Nummer mit Haptik", async () => {
  mockGet.mockResolvedValue({ data: open });
  mockPost.mockImplementation(async (url: string, body: { number: number }) => (url.endsWith("/check") ? checkReply(body) : { data: fixed }));
  await render(<MemberJerseyNumber />);
  const input = await screen.findByTestId("jersey-input");
  expect(screen.getByTestId("jersey-card")).toHaveTextContent(/Nicht wählbar: 3\./);
  expect(screen.getByTestId("jersey-choose")).toBeDisabled();
  // Raster: freie Nummern antippbar, vergebene und reservierte ausgegraut - ohne Namen.
  expect(screen.getByTestId("jersey-grid")).toHaveTextContent(/Frei: 7/);
  expect(screen.getByTestId("jersey-grid-3")).toBeDisabled();
  expect(screen.getByTestId("jersey-grid-8")).toBeDisabled();

  await fireEvent.changeText(input, "100");
  expect(screen.getByTestId("jersey-check")).toHaveTextContent("Nur Nummern von 0 bis 9.");
  await fireEvent.changeText(input, "8");
  await waitFor(() => expect(screen.getByTestId("jersey-check")).toHaveTextContent("Diese Nummer hat schon jemand."));
  expect(mockPost).toHaveBeenCalledWith("/membership/me/jersey-number/check", { number: 8 }, expect.anything());
  expect(mockGet.mock.calls.some(([url]) => String(url).includes("check"))).toBe(false);
  expect(screen.getByTestId("jersey-choose")).toBeDisabled();

  await fireEvent.press(screen.getByTestId("jersey-grid-7"));
  expect(input.props.value).toBe("7");
  expect(screen.getByTestId("jersey-grid-7").props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  await waitFor(() => expect(screen.getByTestId("jersey-check")).toHaveTextContent("Frei"));
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId("jersey-choose"));
  expect(alertSpy).toHaveBeenCalledWith(
    "Die 7 als deine Nummer festlegen?",
    "Danach änderst du sie nicht mehr selbst – nur noch über einen Antrag an den Vorstand.",
    expect.any(Array),
  );
  await answer("Festlegen");
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/membership/me/jersey-number", { number: 7, confirmed: true }));
  const shown = await screen.findByTestId("jersey-number");
  expect(shown).toHaveTextContent("7");
  expect(shown.props["data-fresh"]).toBe("1");
  expect(screen.getByTestId("jersey-glow")).toBeTruthy();
  expect(screen.getByTestId("jersey-notice")).toHaveTextContent("Die 7 gehört jetzt dir.");
  expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
  expect(screen.queryByTestId("jersey-input")).toBeNull();
});

test("„Bewegung reduzieren“: die Nummer blendet nur ein - kein Anheben, kein Aufleuchten; die Vibration bleibt", async () => {
  jest.spyOn(reanimated, "useReducedMotion").mockReturnValue(true);
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(new Promise<boolean>(() => undefined));
  mockGet.mockResolvedValue({ data: open });
  mockPost.mockImplementation(async (url: string, body: { number: number }) => (url.endsWith("/check") ? checkReply(body) : { data: fixed }));
  await render(<MemberJerseyNumber />);
  await fireEvent.press(await screen.findByTestId("jersey-grid-7"));
  await waitFor(() => expect(screen.getByTestId("jersey-choose")).toBeEnabled());
  await fireEvent.press(screen.getByTestId("jersey-choose"));
  await answer("Festlegen");
  expect(await screen.findByTestId("jersey-number")).toHaveTextContent("7");
  expect(screen.queryByTestId("jersey-glow")).toBeNull();
  expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
});

test("abgebrochene Bestätigung schickt nichts", async () => {
  mockGet.mockResolvedValue({ data: open });
  mockPost.mockImplementation(async (_url: string, body: { number: number }) => checkReply(body));
  await render(<MemberJerseyNumber />);
  await fireEvent.press(await screen.findByTestId("jersey-grid-0"));
  await waitFor(() => expect(screen.getByTestId("jersey-choose")).toBeEnabled());
  await fireEvent.press(screen.getByTestId("jersey-choose"));
  await answer("Abbrechen");
  expect(mockPost.mock.calls.filter(([url]) => url === "/membership/me/jersey-number")).toEqual([]);
});

test("409 beim Festlegen: „vergeben“, neu geprüft, der Knopf bleibt zu", async () => {
  let taken = false;
  mockGet.mockResolvedValue({ data: open });
  mockPost.mockImplementation(async (url: string, body: { number: number }) => {
    if (url.endsWith("/check")) {
      return taken ? { data: { number: body.number, free: false, reason: "taken", text: "Diese Nummer hat schon jemand." } } : checkReply(body);
    }
    taken = true;
    throw { response: { status: 409, data: { detail: "Diese Nummer hat sich gerade jemand anderes gesichert – such dir bitte eine andere aus." } } };
  });
  await render(<MemberJerseyNumber />);
  await fireEvent.press(await screen.findByTestId("jersey-grid-5"));
  await waitFor(() => expect(screen.getByTestId("jersey-choose")).toBeEnabled());
  await fireEvent.press(screen.getByTestId("jersey-choose"));
  await answer("Festlegen");
  expect(await screen.findByTestId("jersey-error")).toHaveTextContent(/gerade jemand anderes gesichert/);
  await waitFor(() => expect(screen.getByTestId("jersey-check")).toHaveTextContent("Diese Nummer hat schon jemand."));
  expect(screen.getByTestId("jersey-choose")).toBeDisabled();
  expect(screen.queryByTestId("jersey-number")).toBeNull();
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});

test("409 ohne Satz vom Server: es heißt „vergeben“", async () => {
  mockGet.mockResolvedValue({ data: open });
  mockPost.mockImplementation(async (url: string, body: { number: number }) => {
    if (url.endsWith("/check")) return checkReply(body);
    throw { response: { status: 409, data: {} } };
  });
  await render(<MemberJerseyNumber />);
  await fireEvent.press(await screen.findByTestId("jersey-grid-4"));
  await waitFor(() => expect(screen.getByTestId("jersey-choose")).toBeEnabled());
  await fireEvent.press(screen.getByTestId("jersey-choose"));
  await answer("Festlegen");
  expect(await screen.findByTestId("jersey-error")).toHaveTextContent("Diese Nummer hat schon jemand.");
});

test("alle vergeben: das steht da, statt Feld und Raster anzubieten", async () => {
  mockGet.mockResolvedValue({ data: { ...open, free_count: 0, free_numbers: [] } });
  await render(<MemberJerseyNumber />);
  expect(await screen.findByTestId("jersey-none-left")).toHaveTextContent(/Gerade ist keine Nummer frei/);
  expect(screen.queryByTestId("jersey-input")).toBeNull();
  expect(screen.queryByTestId("jersey-grid")).toBeNull();
});

test("Neuwahl freigegeben: der Hinweis steht über dem Feld", async () => {
  mockGet.mockResolvedValue({ data: { ...open, again: true } });
  await render(<MemberJerseyNumber />);
  expect(await screen.findByTestId("jersey-again")).toHaveTextContent(/such dir einmal eine neue aus/);
  expect(screen.getByTestId("jersey-input")).toBeTruthy();
});

test("festgelegt: Nummer groß, Feld fehlt in Dolibarr als ruhiger Satz, Antrag mit Grund senden, danach liegt er beim Vorstand", async () => {
  let view: Record<string, unknown> = {
    ...fixed,
    dolibarr: { state: "field_missing", text: "Deine Nummer ist hier gesichert; in die Mitgliederverwaltung trägt sie der Abgleich nach." },
    requests: [{ id: "r0", current: 5, wished: 7, status: "applied", status_label: "übernommen", decided_at: "2026-10-01T10:00:00+00:00" }],
  };
  mockGet.mockImplementation(async () => ({ data: view }));
  mockPost.mockImplementation(async (url: string, body: { number: number }) => {
    if (url.endsWith("/check")) return checkReply(body);
    view = { ...view, open_request: { id: "r1", current: 7, wished: 6, status: "received", received_at: "2026-10-26T11:00:00+00:00" } };
    return { data: view.open_request };
  });
  await render(<MemberJerseyNumber />);
  expect(await screen.findByTestId("jersey-number")).toHaveTextContent("7");
  expect(screen.getByTestId("jersey-number").props["data-fresh"]).toBeUndefined();
  expect(screen.getByTestId("jersey-set-by")).toHaveTextContent(/Von dir gewählt am 26\.10\.2026/);
  expect(screen.getByTestId("jersey-sync")).toHaveTextContent(/gesichert/);
  expect(screen.getByTestId("jersey-requests")).toHaveTextContent(/Statt 5: Wunsch 7/);
  expect(screen.queryByTestId("jersey-input")).toBeNull();

  await fireEvent.press(screen.getByTestId("jersey-ask"));
  const send = screen.getByTestId("jersey-request-send");
  expect(send).toBeDisabled();
  await fireEvent.press(screen.getByTestId("jersey-wish-grid-6"));
  expect(screen.getByTestId("jersey-wish").props.value).toBe("6");
  await fireEvent.changeText(screen.getByTestId("jersey-reason"), "Die 6 ist meine Glückszahl");
  await waitFor(() => expect(screen.getByTestId("jersey-request-send")).toBeEnabled());
  await fireEvent.press(screen.getByTestId("jersey-request-send"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/membership/me/jersey-number/requests", { wished: 6, reason: "Die 6 ist meine Glückszahl" }));
  expect(await screen.findByTestId("jersey-open-request")).toHaveTextContent(/Statt 7: Wunsch 6, eingereicht am 26\.10\.2026/);
  expect(screen.getByTestId("jersey-notice")).toHaveTextContent("Antrag gesendet – der Vorstand meldet sich.");
  expect(screen.queryByTestId("jersey-ask")).toBeNull();
});

test("Antrag ohne Wunsch: nur der Grund geht mit; Fehler des Servers stehen in der Karte", async () => {
  mockGet.mockResolvedValue({ data: fixed });
  mockPost.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Dein Antrag liegt schon beim Vorstand." } } });
  await render(<MemberJerseyNumber />);
  await fireEvent.press(await screen.findByTestId("jersey-ask"));
  await fireEvent.changeText(screen.getByTestId("jersey-reason"), "ab");
  expect(screen.getByTestId("jersey-request-send")).toBeDisabled();
  await fireEvent.changeText(screen.getByTestId("jersey-reason"), "Neue Saison, neue Nummer");
  await fireEvent.press(screen.getByTestId("jersey-request-send"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/membership/me/jersey-number/requests", { wished: null, reason: "Neue Saison, neue Nummer" }));
  expect(await screen.findByTestId("jersey-request-error")).toHaveTextContent("Dein Antrag liegt schon beim Vorstand.");
  await fireEvent.press(screen.getByTestId("jersey-request-cancel"));
  expect(screen.queryByTestId("jersey-request-form")).toBeNull();
  expect(screen.getByTestId("jersey-ask")).toBeTruthy();
});

test("Antrag offen: der Satz steht da, kein zweiter Antrag", async () => {
  mockGet.mockResolvedValue({ data: { ...fixed, set_by: "board", open_request: { id: "r2", current: 7, wished: null, status: "received", received_at: "2026-10-20T09:00:00+00:00" } } });
  await render(<MemberJerseyNumber />);
  expect(await screen.findByTestId("jersey-open-request")).toHaveTextContent(/Dein Antrag liegt beim Vorstand \(Statt 7: neu wählen, eingereicht am 20\.10\.2026\)/);
  expect(screen.getByTestId("jersey-set-by")).toHaveTextContent(/Vom Vorstand eingetragen/);
  expect(screen.queryByTestId("jersey-ask")).toBeNull();
});
