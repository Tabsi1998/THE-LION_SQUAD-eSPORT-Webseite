import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ReportSheet } from "./ReportSheet";

// Meldung an die Moderation (#414): Grund wählen, mindestens fünf Zeichen, dann derselbe Aufruf
// wie auf der Website; Direktnachricht mit message_id, Gruppenchat ohne.

const mockPost = jest.fn();
jest.mock("../lib/api", () => ({
  api: { post: (...args: unknown[]) => mockPost(...args), get: jest.fn(), delete: jest.fn() },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockResolvedValue({ data: { ok: true } });
});

test("ohne Beschreibung kein Senden; mit Grund und Text geht die Meldung mit message_id raus", async () => {
  const onClose = jest.fn();
  const onSent = jest.fn();
  await render(<ReportSheet draft={{ targetUserId: "u-2", targetName: "Max", direct: true, message: { id: "m-1", message: "Blöder Spruch", sender_id: "u-2" } }} onClose={onClose} onSent={onSent} />);

  expect(screen.getByText("Nachricht melden")).toBeTruthy();
  expect(screen.getByText("„Blöder Spruch“")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("report-submit"));
  expect(mockPost).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId("report-category-hate"));
  await fireEvent.changeText(screen.getByTestId("report-details"), "Beleidigt mich seit Tagen");
  await fireEvent.press(screen.getByTestId("report-submit"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/moderation/reports", { target_user_id: "u-2", category: "hate", details: "Beleidigt mich seit Tagen", message_id: "m-1" }));
  expect(onSent).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

test("im Gruppenchat wandert der Text in die Beschreibung; ein Fehler bleibt im Blatt stehen", async () => {
  mockPost.mockRejectedValueOnce(new Error("Zu viele Meldungen"));
  await render(<ReportSheet draft={{ targetUserId: "u-3", targetName: "Moe", message: { id: "g-1", message: "Kauft hier!", user_id: "u-3" } }} onClose={jest.fn()} />);
  await fireEvent.changeText(screen.getByTestId("report-details"), "Werbung im Chat");
  await fireEvent.press(screen.getByTestId("report-submit"));
  await waitFor(() => expect(screen.getByText("Zu viele Meldungen")).toBeTruthy());
  expect(mockPost).toHaveBeenCalledWith("/moderation/reports", { target_user_id: "u-3", category: "harassment", details: "Werbung im Chat\n\nGemeldete Nachricht (g-1): „Kauft hier!“", message_id: null });
});

test("zu ist zu: ohne Entwurf wird nichts gezeigt", async () => {
  await render(<ReportSheet draft={null} onClose={jest.fn()} />);
  expect(screen.queryByTestId("report-sheet")).toBeNull();
});
