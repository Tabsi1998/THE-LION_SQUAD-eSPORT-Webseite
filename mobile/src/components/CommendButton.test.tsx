import React from "react";
import { Alert } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { CommendButton } from "./CommendButton";

// GG nach dem Match (#616, App E13 #623): nur Beteiligte, nur nach dem Ende, einmal je Match - wie im Web.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (_err: unknown, fallback: string) => fallback,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

test("nach dem Ende: GG geben, danach „GG gegeben – danke fürs faire Spiel“", async () => {
  mockGet.mockResolvedValue({ data: { participant: true, completed: true, can_commend: true, given: false } });
  mockPost.mockResolvedValue({ data: { participant: true, completed: true, can_commend: false, given: true, already: false } });
  await render(<CommendButton matchId="m1" completed />);
  await waitFor(() => expect(screen.getByTestId("commend-button")).toBeTruthy());
  expect(mockGet).toHaveBeenCalledWith("/matches/m1/commend");
  await fireEvent.press(screen.getByTestId("commend-button"));
  await waitFor(() => expect(screen.getByTestId("commend-given")).toBeTruthy());
  expect(mockPost).toHaveBeenCalledWith("/matches/m1/commend");
  expect(screen.getByText("GG gegeben – danke fürs faire Spiel")).toBeTruthy();
});

test("schon gegeben: nur der Hinweis", async () => {
  mockGet.mockResolvedValue({ data: { participant: true, completed: true, can_commend: false, given: true } });
  await render(<CommendButton matchId="m1" completed />);
  await waitFor(() => expect(screen.getByText("GG gegeben")).toBeTruthy());
  expect(screen.queryByTestId("commend-button")).toBeNull();
});

test("nicht beteiligt, nicht beendet oder als Gast: nichts - und als Gast keine Anfrage", async () => {
  mockGet.mockResolvedValue({ data: { participant: false, completed: true, can_commend: false, given: false } });
  const first = await render(<CommendButton matchId="m1" completed />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId("commend-button")).toBeNull();
  await first.unmount();

  mockGet.mockClear();
  await render(<CommendButton matchId="m1" completed={false} />);
  await render(<CommendButton matchId="m1" completed enabled={false} />);
  expect(mockGet).not.toHaveBeenCalled();
  expect(screen.queryByTestId("commend-button")).toBeNull();
});

test("ein Fehler bleibt sichtbar, der Knopf bleibt", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockGet.mockResolvedValue({ data: { participant: true, completed: true, can_commend: true, given: false } });
  mockPost.mockRejectedValue(new Error("offline"));
  await render(<CommendButton matchId="m1" completed />);
  await waitFor(() => expect(screen.getByTestId("commend-button")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("commend-button"));
  await waitFor(() => expect(alert).toHaveBeenCalledWith("GG hat nicht geklappt", "Bitte später noch einmal versuchen."));
  expect(screen.getByTestId("commend-button")).toBeTruthy();
  alert.mockRestore();
});
