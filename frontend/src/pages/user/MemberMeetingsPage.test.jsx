import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Versammlungen und Abstimmungen (#327): Einladung mit Tagesordnung und Zu-/Absage, Antrag mit Frist, Stimme
// nur nach Bestätigung und nur mit nutzbarem Stimmrecht, Ergebnis nach Bestätigung; ohne Weg zur Akte der Grund.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
let confirmAnswer = true;
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "") }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => confirmAnswer }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: MemberMeetingsPage, formatDay, meetingWhen } = await import("./MemberMeetingsPage");

const MEETING = {
  id: 7, kind: "general", kind_label: "Generalversammlung", title: "Generalversammlung 2026", day: "2026-10-24", time: "18:00", timezone: "Europe/Vienna",
  format: "hybrid", format_label: "vor Ort und online", place: "Vereinsheim", access: "https://meet.example.test/gv", status: "invited", status_label: "eingeladen",
  agenda: ["Begrüßung", "Entlastung des Vorstands"], voting: true, response: "", response_label: "noch keine Antwort", responded_at: "",
  motion_deadline: "2026-10-21", motions: [{ external_id: "web-motion-1", title: "Neue Trikots", text: "Bitte Budget.", received_at: "2026-09-25T10:00:00Z", late: false, status: "received", status_label: "eingegangen" }],
  upcoming: true, can_respond: true, can_motion: true, motion_late: false,
};
const BALLOT = {
  id: 3, meeting_id: 7, meeting: "Generalversammlung 2026", day: "2026-10-24", item: 3, kind: "resolution", kind_label: "Beschluss", question: "Entlastung des Vorstands",
  status: "open", status_label: "offen", closes: "19:30", timezone: "Europe/Vienna",
  options: [{ code: "yes", label: "Ja" }, { code: "no", label: "Nein" }, { code: "abstain", label: "Enthaltung" }],
  rights: [
    { right_id: 1012, for: "self", name: "", state: "open", reason: "own", reason_text: "dein eigenes Stimmrecht", option: "", option_label: "", can_use: true },
    { right_id: 2020, for: "proxy", name: "Anna Muster", state: "used", reason: "proxy", reason_text: "Vollmacht", option: "yes", option_label: "Ja", can_use: false },
  ],
  can_vote: true, result: null,
};
const VIEW = { available: true, reason: null, text: "", meetings: [MEETING], ballots: [BALLOT], meetings_reason: null, meetings_text: "", ballots_reason: null, ballots_text: "" };

beforeEach(() => {
  vi.clearAllMocks();
  confirmAnswer = true;
  apiMock.get.mockResolvedValue({ data: VIEW });
  apiMock.put.mockResolvedValue({ data: { ...MEETING, response: "yes", response_label: "zugesagt" } });
  apiMock.post.mockResolvedValue({ data: {} });
});

test("Helfer: Tag und Zeit lesbar", () => {
  expect(formatDay("2026-10-24")).toBe("24.10.2026");
  expect(meetingWhen(MEETING)).toBe("24.10.2026 · 18:00 Uhr");
});

test("Einladung: Tagesordnung, Online-Zugang, Zusage und Antrag gehen an den Server", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><MemberMeetingsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("meeting-7")).toBeInTheDocument());
  expect(screen.getByTestId("meeting-7")).toHaveTextContent("Generalversammlung 2026");
  expect(screen.getByTestId("meeting-7-agenda")).toHaveTextContent("Entlastung des Vorstands");
  expect(screen.getByTestId("meeting-7-access")).toHaveAttribute("href", "https://meet.example.test/gv");
  expect(screen.getByTestId("meeting-7-response")).toHaveTextContent("noch keine Antwort");
  expect(screen.getByTestId("meeting-7-motion-deadline")).toHaveTextContent("bis 21.10.2026");
  expect(screen.getByTestId("motion-web-motion-1")).toHaveTextContent("eingegangen");

  await user.click(screen.getByTestId("meeting-7-respond-yes"));
  expect(apiMock.put).toHaveBeenCalledWith("/membership/me/meetings/7/response", { response: "yes" });

  expect(screen.getByTestId("meeting-7-motion-submit")).toBeDisabled();
  await user.type(screen.getByTestId("meeting-7-motion-title"), "Mehr Turniere");
  await user.type(screen.getByTestId("meeting-7-motion-text"), "Bitte zwei Turniere pro Jahr.");
  await user.click(screen.getByTestId("meeting-7-motion-submit"));
  expect(apiMock.post).toHaveBeenCalledWith("/membership/me/meetings/7/motions", { title: "Mehr Turniere", text: "Bitte zwei Turniere pro Jahr." });
});

test("Abstimmung: Stimme nur nach Bestätigung, genutzte Vollmacht zeigt die Antwort, Ergebnis nach Bestätigung", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><MemberMeetingsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("ballot-3")).toBeInTheDocument());
  expect(screen.getByTestId("ballot-3-status")).toHaveTextContent("offen");
  expect(screen.getByTestId("ballot-3-right-2020-used")).toHaveTextContent("abgestimmt: Ja");
  expect(screen.queryByTestId("ballot-3-vote-2020-yes")).toBeNull();

  confirmAnswer = false;
  await user.click(screen.getByTestId("ballot-3-vote-1012-no"));
  expect(apiMock.post).not.toHaveBeenCalled();
  confirmAnswer = true;
  await user.click(screen.getByTestId("ballot-3-vote-1012-yes"));
  expect(apiMock.post).toHaveBeenCalledWith("/membership/me/ballots/3/votes", { right_id: 1012, option: "yes" });

  apiMock.get.mockResolvedValue({ data: { ...VIEW, ballots: [{ ...BALLOT, status: "evaluated", status_label: "ausgezählt", can_vote: false,
    result: { revision: 1, outcome: "passed", outcome_label: "angenommen", passed: true, valid: 44, abstain: 2, counts: [{ code: "yes", label: "Ja", count: 41 }, { code: "no", label: "Nein", count: 3 }, { code: "abstain", label: "Enthaltung", count: 2 }], winner: "", winner_label: "" } }] } });
  render(<MemoryRouter><MemberMeetingsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("ballot-3-result")).toBeInTheDocument());
  expect(screen.getByTestId("ballot-3-result")).toHaveTextContent("angenommen");
  expect(screen.getByTestId("ballot-3-result")).toHaveTextContent("Ja 41 · Nein 3 · Enthaltung 2 · gültig 44");
});

test("ohne Weg zur Akte steht der Grund, mit Bindung ohne Fähigkeit der Grund je Teil", async () => {
  apiMock.get.mockResolvedValue({ data: { available: false, reason: "not_bound", text: "Dafür muss dein Konto verbunden sein.", meetings: [], ballots: [] } });
  const { unmount } = render(<MemoryRouter><MemberMeetingsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("meetings-unavailable")).toHaveTextContent("verbunden sein"));
  expect(screen.getByText("Zu Meine Mitgliedschaft")).toBeInTheDocument();
  unmount();

  apiMock.get.mockResolvedValue({ data: { ...VIEW, meetings: [], ballots: [], meetings_reason: null, ballots_reason: "no_capability_votes", ballots_text: "Deine Verbindung erlaubt Abstimmungen noch nicht." } });
  render(<MemoryRouter><MemberMeetingsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("ballots-reason")).toHaveTextContent("Abstimmungen noch nicht"));
  expect(screen.getByTestId("meetings-empty")).toBeInTheDocument();
});
