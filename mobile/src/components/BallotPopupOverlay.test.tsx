import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { BallotPopupOverlay, rightLabel } from "./BallotPopupOverlay";

// Abstimmung live (#844) in der App - wie im Web: Popup über jedem Screen, Antwort wählen, abgeben; „Später“ wird ein
// Band; geheime Wahl nur als Hinweis; Nicht-Mitglieder fragen gar nicht; ohne Feed fragt die App in kurzem Takt selbst.

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockAuth = { user: { id: "u1", is_club_member: true } as { id: string; is_club_member: boolean } };
jest.mock("../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: unknown, fallback: string) => {
    const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
    return detail || fallback;
  },
}));
jest.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../realtime/LiveChangesProvider", () => ({ useLiveRefresh: () => {} }));

const OPTIONS = [{ code: "yes", label: "Ja" }, { code: "no", label: "Nein" }];
const OWN = { right_id: 1012, for: "self", name: "", can_use: true };
const BALLOT = { id: 7, meeting: "Generalversammlung 2026", item: 3, kind_label: "Beschluss", question: "Entlastung des Vorstands", secret: false, can_vote: true, options: OPTIONS, rights: [OWN] };
const SECRET = { ...BALLOT, id: 8, question: "Wahl der Obfrau", secret: true, can_vote: false, rights: [{ ...OWN, right_id: 1013, can_use: false }] };

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.user = { id: "u1", is_club_member: true };
});

test("Beschriftung je Stimmrecht", () => {
  expect(rightLabel(OWN)).toBe("Deine Stimme");
  expect(rightLabel({ ...OWN, for: "proxy", name: "Anna Muster" })).toBe("Vollmacht für Anna Muster");
});

test("Antwort wählen, abgeben; danach ist das Popup weg", async () => {
  mockGet.mockResolvedValueOnce({ data: { available: true, ballots: [BALLOT], live: true, poll_seconds: 0 } })
    .mockResolvedValue({ data: { available: true, ballots: [], live: true, poll_seconds: 0 } });
  mockPost.mockResolvedValue({ data: {} });
  await render(<BallotPopupOverlay />);
  await waitFor(() => expect(screen.getByTestId("ballot-popup")).toBeTruthy());
  expect(screen.getByText("Entlastung des Vorstands")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("ballot-option-1012-yes"));
  await fireEvent.press(screen.getByTestId("ballot-popup-cast"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/membership/me/ballots/7/votes", { right_id: 1012, option: "yes" }));
  await waitFor(() => expect(screen.queryByTestId("ballot-popup")).toBeNull());
});

test("„Später“ wird ein Band; geheime Wahl nur als Hinweis", async () => {
  mockGet.mockResolvedValue({ data: { available: true, ballots: [BALLOT, SECRET], live: true, poll_seconds: 0 } });
  await render(<BallotPopupOverlay />);
  await waitFor(() => expect(screen.getByTestId("ballot-popup")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("ballot-popup-later"));
  await waitFor(() => expect(screen.getByTestId("ballot-popup-secret")).toBeTruthy());
  expect(screen.queryByTestId("ballot-popup-cast")).toBeNull();
  await fireEvent.press(screen.getByTestId("ballot-popup-later"));
  await waitFor(() => expect(screen.getByTestId("ballot-band")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("ballot-band"));
  await waitFor(() => expect(screen.getByText("Entlastung des Vorstands")).toBeTruthy());
});

test("Nicht-Mitglieder fragen gar nicht; ohne Feed fragt die App selbst nach", async () => {
  jest.useFakeTimers();
  try {
    mockGet.mockResolvedValue({ data: { available: true, ballots: [], live: true, poll_seconds: 15 } });
    const first = await render(<BallotPopupOverlay />);
    await act(async () => { await Promise.resolve(); });
    expect(mockGet).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(15000); await Promise.resolve(); });
    expect(mockGet).toHaveBeenCalledTimes(2);
    await first.unmount();

    mockGet.mockClear();
    mockAuth.user = { id: "u2", is_club_member: false };
    await render(<BallotPopupOverlay />);
    await act(async () => { jest.advanceTimersByTime(30000); await Promise.resolve(); });
    expect(mockGet).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
