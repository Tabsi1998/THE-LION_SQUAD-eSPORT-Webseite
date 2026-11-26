import React from "react";
import { Alert } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { DissolvedTeams } from "./DissolvedTeams";

// Team wiederherstellen (#2542, #2128 TM8, Web: pages/public/team/DissolvedTeams.jsx): Die frühere Teamleitung holt ein aufgelöstes Team
// innerhalb der Frist zurück. Hat ein anderes Team das Kürzel inzwischen, fragt die Zeile nach einem neuen.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
  resolveMediaUrl: (url: string) => url,
}));
jest.mock("../MediaImage", () => ({ MediaImage: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const TEAM = { id: "t9", name: "Alte Löwen", tag: "ALW", member_count: 4, days_left: 12 };
const conflict = Object.assign(new Error("Das Kürzel ALW hat inzwischen ein anderes Team. Bitte ein neues wählen."), { response: { status: 409 } });

beforeEach(() => {
  jest.clearAllMocks();
});

test("aufgelöstes Team mit Frist; Wiederherstellen fragt nach und holt es zurück", async () => {
  mockGet.mockResolvedValueOnce({ data: [TEAM] }).mockResolvedValueOnce({ data: [] });
  mockPost.mockResolvedValue({ data: { ok: true } });
  const alert = jest.spyOn(Alert, "alert").mockImplementation((_title, _text, buttons) => { void buttons?.[1]?.onPress?.(); });
  const onRestored = jest.fn();
  await render(<DissolvedTeams onRestored={onRestored} />);
  await waitFor(() => expect(screen.getByTestId("dissolved-team-t9")).toBeTruthy());
  expect(mockGet).toHaveBeenCalledWith("/teams/dissolved/mine");
  expect(screen.getByTestId("dissolved-team-t9")).toHaveTextContent(/\[ALW\] · 4 Mitglieder · noch 12 Tage/);
  await fireEvent.press(screen.getByTestId("dissolved-team-restore-t9"));
  expect(alert).toHaveBeenCalledWith("Team wiederherstellen?", expect.stringContaining("Alte Löwen kommt mit allen zurück"), expect.any(Array));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/teams/t9/restore", {}));
  await waitFor(() => expect(onRestored).toHaveBeenCalled());
  expect(screen.getByTestId("dissolved-teams-message")).toHaveTextContent("Alte Löwen ist wieder da.");
  alert.mockRestore();
});

test("Kürzel vergeben: neues Kürzel eingeben (groß, höchstens 8 Zeichen), dann ohne zweite Rückfrage", async () => {
  mockGet.mockResolvedValue({ data: [{ ...TEAM, member_count: 1, days_left: 1 }] });
  mockPost.mockRejectedValueOnce(conflict).mockResolvedValueOnce({ data: { ok: true } });
  const alert = jest.spyOn(Alert, "alert").mockImplementation((_title, _text, buttons) => { void buttons?.[1]?.onPress?.(); });
  await render(<DissolvedTeams />);
  await waitFor(() => expect(screen.getByTestId("dissolved-team-t9")).toHaveTextContent(/1 Mitglied · noch 1 Tag/));
  await fireEvent.press(screen.getByTestId("dissolved-team-restore-t9"));
  await waitFor(() => expect(screen.getByTestId("dissolved-team-error-t9")).toHaveTextContent(/Kürzel ALW/));
  const input = screen.getByTestId("dissolved-team-tag-t9");
  expect(screen.getByTestId("dissolved-team-restore-t9").props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.changeText(input, "neuerloewe");
  expect(screen.getByTestId("dissolved-team-tag-t9").props.value).toBe("NEUERLOE");
  alert.mockClear();
  await fireEvent.press(screen.getByTestId("dissolved-team-restore-t9"));
  expect(alert).not.toHaveBeenCalled();
  await waitFor(() => expect(mockPost).toHaveBeenLastCalledWith("/teams/t9/restore", { tag: "NEUERLOE" }));
  alert.mockRestore();
});

test("nichts aufgelöst oder ein älterer Server: nichts zu sehen", async () => {
  mockGet.mockResolvedValue({ data: [] });
  await render(<DissolvedTeams />);
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
  expect(screen.queryByTestId("dissolved-teams")).toBeNull();
  mockGet.mockRejectedValue(new Error("404"));
  await render(<DissolvedTeams />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  expect(screen.queryByTestId("dissolved-teams")).toBeNull();
});
