import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MemberMeetingsScreen, meetingWhen } from "./MemberMeetingsScreen";

// Versammlungen und Abstimmungen (#327): Einladung mit Zusage, Antrag, Stimme nur nach Bestätigung;
// ohne Weg zur Akte der Grund.

const mockGet = jest.fn();
const mockPut = jest.fn();
const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), put: (...args: unknown[]) => mockPut(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigation = { navigate: jest.fn() } as never;
const route = { key: "meetings", name: "MemberMeetings" } as never;

const meeting = {
  id: 7, kind: "general", kind_label: "Generalversammlung", title: "Generalversammlung 2026", day: "2026-10-24", time: "18:00", timezone: "Europe/Vienna",
  format: "hybrid", format_label: "vor Ort und online", place: "Vereinsheim", access: "https://meet.example.test/gv", status: "invited", status_label: "eingeladen",
  agenda: ["Begrüßung", "Entlastung"], voting: true, response: "", response_label: "noch keine Antwort", responded_at: "", motion_deadline: "2026-10-21",
  motions: [], upcoming: true, can_respond: true, can_motion: true, motion_late: false,
};
const ballot = {
  id: 3, meeting_id: 7, meeting: "Generalversammlung 2026", day: "2026-10-24", item: 3, kind: "resolution", kind_label: "Beschluss", question: "Entlastung des Vorstands",
  status: "open", status_label: "offen", closes: "", timezone: "Europe/Vienna", options: [{ code: "yes", label: "Ja" }, { code: "no", label: "Nein" }],
  rights: [{ right_id: 1012, for: "self", name: "", state: "open", reason: "own", reason_text: "dein eigenes Stimmrecht", option: "", option_label: "", can_use: true }],
  can_vote: true, result: null,
};
const view = { available: true, meetings: [meeting], ballots: [ballot], meetings_reason: null, ballots_reason: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: view });
  mockPut.mockResolvedValue({ data: meeting });
  mockPost.mockResolvedValue({ data: {} });
});

test("Einladung mit Tagesordnung; Zusage und Antrag gehen an den Server", async () => {
  await render(<MemberMeetingsScreen navigation={navigation} route={route} confirmVote={async () => true} />);
  await waitFor(() => expect(screen.getByTestId("meeting-7")).toBeTruthy());
  expect(meetingWhen(meeting)).toContain("18:00 Uhr");
  expect(screen.getByTestId("meeting-7-agenda")).toBeTruthy();
  expect(screen.getByText(/noch keine Antwort/)).toBeTruthy();

  await fireEvent.press(screen.getByTestId("meeting-7-respond-yes"));
  await waitFor(() => expect(mockPut).toHaveBeenCalledWith("/membership/me/meetings/7/response", { response: "yes" }));

  await fireEvent.changeText(screen.getByTestId("meeting-7-motion-title"), "Mehr Turniere");
  await fireEvent.changeText(screen.getByTestId("meeting-7-motion-text"), "Zwei pro Jahr.");
  await fireEvent.press(screen.getByTestId("meeting-7-motion-submit"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/membership/me/meetings/7/motions", { title: "Mehr Turniere", text: "Zwei pro Jahr." }));
});

test("Stimme nur nach Bestätigung; abgelehnt schickt nichts", async () => {
  const no = jest.fn(async (_title: string, _message: string) => false);
  const { rerender } = await render(<MemberMeetingsScreen navigation={navigation} route={route} confirmVote={no} />);
  await waitFor(() => expect(screen.getByTestId("ballot-3")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("ballot-3-vote-1012-yes"));
  await waitFor(() => expect(no).toHaveBeenCalled());
  expect(mockPost).not.toHaveBeenCalled();

  const yes = jest.fn(async (_title: string, _message: string) => true);
  await rerender(<MemberMeetingsScreen navigation={navigation} route={route} confirmVote={yes} />);
  await fireEvent.press(screen.getByTestId("ballot-3-vote-1012-no"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/membership/me/ballots/3/votes", { right_id: 1012, option: "no" }));
  expect(yes.mock.calls[0][1]).toContain("Nein");
});

test("ohne Weg zur Akte steht der Grund", async () => {
  mockGet.mockResolvedValue({ data: { available: false, reason: "not_bound", text: "Dafür muss dein Konto verbunden sein.", meetings: [], ballots: [] } });
  await render(<MemberMeetingsScreen navigation={navigation} route={route} confirmVote={async () => true} />);
  await waitFor(() => expect(screen.getByTestId("meetings-unavailable")).toBeTruthy());
  expect(screen.getByText(/verbunden sein/)).toBeTruthy();
});
