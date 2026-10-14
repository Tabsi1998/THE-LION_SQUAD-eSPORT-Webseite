import React from "react";
import { Alert } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MemberConsents } from "./MemberConsents";
import { consentStateLine, type ConsentRow } from "../lib/consents";

// Meine Einwilligungen in der App (#1537) - wie im Web: Stand je Zweck, der Text zum Aufklappen (auch der zugestimmte),
// Zustimmen und Widerrufen nach einer Rückfrage, und ein Ladefehler steht da statt einer verschwundenen Karte.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));

const NEWS: ConsentRow = { code: "newsletter", label: "Newsletter", state: "given", version: 3, current_version: 3, moment: "2026-01-10T10:00:00+01:00",
  can_give: false, can_withdraw: true, text: "Newsletter, Fassung 3.", given_text: "Newsletter, Fassung 3.", text_changed: false };
const FOTOS: ConsentRow = { code: "fotos", label: "Fotos auf der Website", state: "none", version: 0, current_version: 2, moment: null,
  can_give: true, can_withdraw: false, text: "Fotos, Fassung 2.", given_text: null, text_changed: false };

/** Die Rückfrage im Stil der App: Alert mit Abbrechen und der Handlung - hier wird die Handlung gewählt. */
function confirmWith(choice: string) {
  return jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
    buttons?.find((button) => button.text === choice)?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

test("der Stand in Worten wie im Web", () => {
  expect(consentStateLine(NEWS)).toMatch(/^Zugestimmt am .+ \(Fassung 3\)$/);
  expect(consentStateLine({ ...NEWS, state: "withdrawn" })).toMatch(/^Widerrufen am /);
  expect(consentStateLine(FOTOS)).toBe("Noch nicht entschieden");
});

test("Abschnitt mit Titel, Stand und dem Text der zugestimmten Fassung zum Aufklappen", async () => {
  mockGet.mockResolvedValue({ data: { available: true, as_of: "2026-10-14T08:00:00Z", consents: [NEWS, FOTOS] } });
  await render(<MemberConsents />);
  await waitFor(() => expect(screen.getByTestId("membership-consents")).toBeTruthy());
  expect(mockGet).toHaveBeenCalledWith("/membership/me/consents");
  expect(screen.getByText("Meine Einwilligungen")).toBeTruthy();
  expect(screen.getByTestId("consent-state-newsletter")).toHaveTextContent(/Zugestimmt am .+ \(Fassung 3\)/);
  expect(screen.getByTestId("consent-state-fotos")).toHaveTextContent(/Noch nicht entschieden/);
  expect(screen.queryByText(/freiwillig|Pflicht/i)).toBeNull();

  expect(screen.queryByTestId("consent-given-text-newsletter")).toBeNull();
  await fireEvent.press(screen.getByTestId("consent-open-newsletter"));
  expect(screen.getByTestId("consent-given-text-newsletter")).toHaveTextContent(/Newsletter, Fassung 3\./);
  expect(screen.queryByTestId("consent-give-newsletter")).toBeNull();
});

test("neue Fassung: die zugestimmte und die neue stehen da; kennt die Website die alte nicht, sagt sie das", async () => {
  const changed = { ...NEWS, version: 2, can_give: true, given_text: "Newsletter, Fassung 2.", text_changed: true };
  const unknown = { ...FOTOS, state: "given" as const, version: 1, moment: "2026-01-10T10:00:00+01:00", can_withdraw: true, given_text: null, text_changed: true };
  mockGet.mockResolvedValue({ data: { available: true, consents: [changed, unknown] } });
  await render(<MemberConsents />);
  await waitFor(() => expect(screen.getByTestId("consent-changed-newsletter")).toHaveTextContent(/Text geändert/));
  await fireEvent.press(screen.getByTestId("consent-open-newsletter"));
  expect(screen.getByTestId("consent-given-text-newsletter")).toHaveTextContent(/Newsletter, Fassung 2\./);
  expect(screen.getByTestId("consent-current-text-newsletter")).toHaveTextContent(/Newsletter, Fassung 3\./);
  await fireEvent.press(screen.getByTestId("consent-open-fotos"));
  expect(screen.getByTestId("consent-given-missing-fotos")).toHaveTextContent(/^Den Text der Fassung vom \d\d\.\d\d\.\d{4}, der du zugestimmt hast, haben wir nicht\. Aktuelle Fassung:$/);
  expect(screen.getByTestId("consent-current-text-fotos")).toHaveTextContent(/Fotos, Fassung 2\./);
});

test("Zustimmen nach dem Lesen und der Rückfrage - mit der gezeigten Fassung", async () => {
  mockGet.mockResolvedValue({ data: { available: true, consents: [FOTOS] } });
  const given = { ...FOTOS, state: "given", version: 2, can_give: false, can_withdraw: true, given_text: FOTOS.text, moment: "2026-10-14T10:00:00+02:00" };
  mockPost.mockResolvedValue({ data: { ok: true, result: { code: "fotos", state: "given", version: 2, recorded: true }, consents: [given] } });
  const alert = confirmWith("Zustimmen");
  await render(<MemberConsents />);
  await waitFor(() => expect(screen.getByTestId("consent-open-fotos")).toBeTruthy());
  expect(screen.queryByTestId("consent-give-fotos")).toBeNull();
  await fireEvent.press(screen.getByTestId("consent-open-fotos"));
  expect(screen.getByTestId("consent-current-text-fotos")).toHaveTextContent(/Fotos, Fassung 2\./);
  await fireEvent.press(screen.getByTestId("consent-give-fotos"));
  expect(alert).toHaveBeenCalledWith(expect.stringContaining("Fotos auf der Website"), expect.any(String), expect.any(Array));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/membership/me/consents", { code: "fotos", decision: "given", version: 2 }));
  await waitFor(() => expect(screen.getByTestId("consent-state-fotos")).toHaveTextContent(/Zugestimmt/));
  expect(screen.getByTestId("consent-withdraw-fotos")).toBeTruthy();
});

test("Widerrufen erst nach der Rückfrage; Abbrechen schickt nichts", async () => {
  mockGet.mockResolvedValue({ data: { available: true, consents: [NEWS] } });
  mockPost.mockResolvedValue({ data: { ok: true, result: { code: "newsletter", state: "withdrawn", version: 3, recorded: true },
    consents: [{ ...NEWS, state: "withdrawn", can_withdraw: false, can_give: true, given_text: null }] } });
  let alert = confirmWith("Abbrechen");
  await render(<MemberConsents />);
  await waitFor(() => expect(screen.getByTestId("consent-withdraw-newsletter")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("consent-withdraw-newsletter"));
  expect(alert).toHaveBeenCalledWith(expect.stringContaining("widerrufen"), expect.any(String), expect.any(Array));
  expect(mockPost).not.toHaveBeenCalled();

  alert.mockRestore();
  alert = confirmWith("Widerrufen");
  await fireEvent.press(screen.getByTestId("consent-withdraw-newsletter"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/membership/me/consents", { code: "newsletter", decision: "withdrawn" }));
  await waitFor(() => expect(screen.getByTestId("consent-state-newsletter")).toHaveTextContent(/Widerrufen/));
  expect(screen.queryByTestId("consent-withdraw-newsletter")).toBeNull();
});

test("geht eine Entscheidung nicht durch, steht der Grund da", async () => {
  mockGet.mockResolvedValue({ data: { available: true, consents: [NEWS] } });
  mockPost.mockRejectedValue(new Error("Mitgliederverwaltung nicht erreichbar – doppelt gespeichert wird nichts."));
  confirmWith("Widerrufen");
  await render(<MemberConsents />);
  await waitFor(() => expect(screen.getByTestId("consent-withdraw-newsletter")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("consent-withdraw-newsletter"));
  await waitFor(() => expect(screen.getByTestId("consents-decide-error")).toHaveTextContent(/doppelt gespeichert wird nichts/));
  expect(screen.getByTestId("consent-state-newsletter")).toHaveTextContent(/Zugestimmt/);
});

test("Ladefehler: „nicht geladen“ mit „Nochmal versuchen“; ohne Zuordnung kein Abschnitt", async () => {
  mockGet.mockRejectedValueOnce(new Error("Network Error"));
  mockGet.mockResolvedValueOnce({ data: { available: false, reason: "unavailable", text: "Die Mitgliederverwaltung antwortet gerade nicht." } });
  mockGet.mockResolvedValueOnce({ data: { available: true, consents: [FOTOS] } });
  const first = await render(<MemberConsents />);
  await waitFor(() => expect(screen.getByTestId("consents-error")).toHaveTextContent(/nicht geladen/));
  await fireEvent.press(screen.getByTestId("consents-retry"));
  await waitFor(() => expect(screen.getByTestId("consents-error")).toHaveTextContent(/antwortet gerade nicht/));
  await fireEvent.press(screen.getByTestId("consents-retry"));
  await waitFor(() => expect(screen.getByTestId("consent-fotos")).toBeTruthy());
  expect(screen.queryByTestId("consents-error")).toBeNull();
  await first.unmount();

  mockGet.mockResolvedValue({ data: { available: false, reason: "not_linked" } });
  await render(<MemberConsents />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(4));
  expect(screen.queryByTestId("membership-consents")).toBeNull();
});
