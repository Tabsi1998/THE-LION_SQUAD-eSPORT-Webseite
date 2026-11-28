import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Abstimmungen am Event (#2612): Frage, Frist und Stand; wählen, abstimmen, ändern; Gründe für alle, die nicht
// abstimmen dürfen; das Ergebnis nur, wie eingestellt.

const apiMock = { put: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "" }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { EventPolls } = await import("./EventPolls");

const NOW = new Date("2026-12-20T10:00:00Z");
const OPTIONS = [{ code: "o1", label: "Rodelbahn A" }, { code: "o2", label: "Rodelbahn B" }];
const RESULT = { outcome_label: "Mehrheit", winner: "o2", winner_label: "Rodelbahn B", valid: 3,
  counts: [{ code: "o1", label: "Rodelbahn A", count: 1 }, { code: "o2", label: "Rodelbahn B", count: 2 }] };
const POLL = {
  id: "p1", question: "Welche Rodelbahn?", options: OPTIONS, max_choices: 1, multiple: false, status: "open",
  closes_at: "2026-12-23T17:00:00+00:00", results_visibility: "live", can_vote: true, reason: null, reason_text: "",
  rights: [{ right_id: "user:u1", for: "self", state: "open", choices: [], can_use: true }], result: RESULT, result_hidden: false,
};

beforeEach(() => vi.clearAllMocks());

function show(polls, extra = {}) {
  return render(<MemoryRouter><EventPolls event={{ id: "e1", polls }} now={NOW} {...extra} /></MemoryRouter>);
}

test("ohne Abstimmungen bleibt die Seite still", () => {
  show([]);
  expect(screen.queryByTestId("event-polls")).toBeNull();
});

test("Frist, Regel und Stand stehen da; wählen und abstimmen", async () => {
  apiMock.put.mockResolvedValue({ data: { ...POLL, rights: [{ ...POLL.rights[0], state: "used", choices: ["o2"] }] } });
  show([POLL]);
  expect(screen.getByTestId("event-poll-p1-deadline")).toHaveTextContent("Abstimmen bis Mi 23. Dezember · 18:00");
  expect(screen.getByTestId("event-poll-p1-rule")).toHaveTextContent("Eine Antwort · Ergebnis sofort sichtbar");
  expect(screen.getByTestId("event-poll-p1-status")).toHaveTextContent("Offen");
  expect(screen.getByTestId("event-poll-p1-result-o2")).toHaveAttribute("data-winner", "1");
  expect(screen.getByTestId("event-poll-p1-submit")).toBeDisabled();
  fireEvent.click(screen.getByTestId("ballot-option-user:u1-o2"));
  fireEvent.click(screen.getByTestId("event-poll-p1-submit"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/events/e1/polls/p1/vote", { choices: ["o2"] }, undefined));
  expect(await screen.findByTestId("event-poll-p1-own")).toHaveTextContent("Deine Stimme: Rodelbahn B");
  expect(screen.getByTestId("event-poll-p1-status")).toHaveTextContent("Abgestimmt");
  expect(screen.getByTestId("event-poll-p1-submit")).toHaveTextContent("Stimme ändern");
  expect(screen.getByTestId("event-poll-p1-submit")).toBeDisabled();
  expect(toastMock.success).toHaveBeenCalledWith("Danke – deine Stimme ist angekommen.");
});

test("mehrere Antworten bis zur Grenze, mit Zugangslink", async () => {
  apiMock.put.mockResolvedValue({ data: POLL });
  const multi = { ...POLL, max_choices: 2, multiple: true, options: [...OPTIONS, { code: "o3", label: "Vereinsheim" }] };
  show([multi], { accessToken: "abc" });
  for (const code of ["o1", "o2", "o3"]) fireEvent.click(screen.getByTestId(`ballot-option-user:u1-${code}`));
  expect(screen.getByTestId("ballot-option-user:u1-o3")).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByTestId("event-poll-p1-submit"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/events/e1/polls/p1/vote", { choices: ["o1", "o2"] }, { params: { access: "abc" } }));
});

test("ein Fehler steht an der Karte, die Auswahl bleibt", async () => {
  apiMock.put.mockRejectedValue({ response: { data: { detail: "Die Frist ist vorbei – die Abstimmung ist zu." } } });
  show([POLL]);
  fireEvent.click(screen.getByTestId("ballot-option-user:u1-o1"));
  fireEvent.click(screen.getByTestId("event-poll-p1-submit"));
  expect(await screen.findByTestId("event-poll-p1-message")).toHaveTextContent("Die Frist ist vorbei");
  expect(screen.getByTestId("ballot-option-user:u1-o1")).toHaveAttribute("aria-pressed", "true");
});

test("Warteliste und Gäste lesen den Grund; verdecktes Ergebnis sagt, wann es kommt", () => {
  const waiting = { ...POLL, can_vote: false, rights: [], reason: "waitlist", reason_text: "Du stehst auf der Warteliste – abstimmen kannst du, sobald du nachrückst.",
    result: null, result_hidden: true, results_visibility: "after_close" };
  show([waiting, { ...waiting, id: "p2", reason: "login", reason_text: "Abstimmen können nur Angemeldete – melde dich zuerst an." }]);
  expect(screen.getByTestId("event-poll-p1-reason")).toHaveTextContent("Warteliste");
  expect(screen.queryByTestId("event-poll-p1-submit")).toBeNull();
  expect(screen.getByTestId("event-poll-p1-hidden")).toHaveTextContent("Das Ergebnis erscheint nach der Frist (Mi 23. Dezember · 18:00).");
  expect(screen.getByTestId("event-poll-p2-reason")).toHaveTextContent("Anmelden");
});

test("beendet: Ergebnis statt Auswahl, kein Grund mehr", () => {
  show([{ ...POLL, status: "closed", can_vote: false, rights: [{ ...POLL.rights[0], state: "used", choices: ["o1"], can_use: false }] }]);
  expect(screen.getByTestId("event-poll-p1-status")).toHaveTextContent("Beendet");
  expect(screen.getByTestId("event-poll-p1-result")).toHaveTextContent("Ergebnis");
  expect(screen.getByTestId("event-poll-p1-own")).toHaveTextContent("Rodelbahn A");
  expect(screen.queryByTestId("event-poll-p1-submit")).toBeNull();
});

test("kaputte Daten reißen nichts mit", () => {
  show([null, { id: "p9", question: 3, options: "x", rights: {} }]);
  expect(screen.getByTestId("event-poll-p9")).toBeInTheDocument();
});
