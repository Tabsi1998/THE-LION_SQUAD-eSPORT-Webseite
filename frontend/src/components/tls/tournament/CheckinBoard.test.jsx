import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Reiter „Check-in“ der Turnierleitung (#1161): Suche, Zähler „N von M da“, der beim Tippen sofort stimmt (und bei einem
// Fehler zurückspringt), Team-Zeilen mit Aufstellung oder Mitgliedern, offenes Startgeld als Etikett. Namen sind erfunden.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API_BASE: "", formatApiError: (value) => value }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
const { CheckinBoard } = await import("./CheckinBoard");
const { toast } = await import("sonner");

const solo = (id, name, extra = {}) => ({ id, name, ingame_name: "", team_tag: "", status: "approved", checked_in: false, kind: "solo", fee: null, ...extra });

const SOLO_BOARD = {
  applies: true, team_mode: false, tournament: { id: "t1", slug: "lan-cup", self_checkin: false },
  rows: [
    solo("r1", "Anton", { status: "checked_in", checked_in: true, checked_in_at: "2026-11-14T17:04:00+00:00" }),
    solo("r2", "Zoë Ångström", { fee: "open" }),
    solo("r3", "Berta", { ingame_name: "B3rta" }),
    solo("r4", "Carl", { status: "no_show" }),
    solo("r5", "Dora", { status: "pending" }),
  ],
};

const member = (id, name, extra = {}) => ({ id, name, role: "member", leader: false, present: false, ...extra });
const TEAM_BOARD = {
  applies: true, team_mode: true, tournament: { id: "t2", slug: "team-cup", self_checkin: true },
  rows: [
    {
      id: "lsw", name: "Löwen mit einem sehr langen Teamnamen für die Turnierleitung am Einlass", team_tag: "LSW", kind: "team",
      status: "approved", checked_in: false, fee: "open", fee_cents: 5000, fee_currency: "EUR", lineup_set: false, members_present: 2,
      members: Array.from({ length: 10 }, (_, index) => member(`u${index}`, index === 7 ? "Maximilian-Alexander von Hohenzollern-Sigmaringen" : `Mitglied ${index}`,
        { leader: index === 0, present: index === 0 || index === 3 })),
    },
    {
      id: "flk", name: "Falken", team_tag: "FLK", kind: "team", status: "checked_in", checked_in: true, fee: "paid", lineup_set: true, members_present: 1,
      members: [member("a", "Ada", { role: "starter" }), member("b", "Bo", { role: "starter", present: true }), member("c", "Cy", { role: "substitute" })],
    },
  ],
};

function renderBoard(board) {
  apiMock.get.mockResolvedValue({ data: board });
  return render(<CheckinBoard slug={board.tournament.slug} tournamentId={board.tournament.id} />);
}

const counter = () => screen.getByTestId("lead-checkin-counter");

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

test("Zähler, Etiketten und Suche - ohne Akzente, auch nach dem Spielnamen", async () => {
  renderBoard(SOLO_BOARD);
  await screen.findByTestId("lead-checkin-list");
  expect(apiMock.get).toHaveBeenCalledWith("/tournaments/lan-cup/lead/checkin");
  expect(counter()).toHaveTextContent("1 von 5 da");
  expect(screen.getByTestId("lead-checkin-summary")).toHaveTextContent("3 fehlen noch · 1 nicht erschienen · 1 Startgeld offen");
  expect(screen.getByTestId("lead-checkin-fee-r2")).toHaveTextContent("Startgeld offen");
  expect(screen.getByTestId("lead-checkin-fee-r2")).not.toHaveTextContent("€");
  expect(screen.getByTestId("lead-checkin-row-r1")).toHaveTextContent("Da · 18:04");
  expect(screen.getByTestId("lead-checkin-row-r5")).toHaveTextContent("Freigabe offen");
  expect(screen.getByTestId("lead-checkin-row-r4")).toHaveTextContent("Nicht erschienen");
  expect(screen.getByTestId("lead-checkin-undo-r4")).toBeInTheDocument();

  fireEvent.change(screen.getByTestId("lead-checkin-search"), { target: { value: "zoe angst" } });
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByTestId("lead-checkin-row-r2")).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("lead-checkin-search"), { target: { value: "b3rta" } });
  expect(screen.getByTestId("lead-checkin-row-r3")).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("lead-checkin-search"), { target: { value: "niemand" } });
  expect(screen.getByTestId("lead-checkin-none")).toHaveTextContent("Niemand passt zu „niemand“.");

  fireEvent.change(screen.getByTestId("lead-checkin-search"), { target: { value: "" } });
  fireEvent.click(screen.getByTestId("lead-checkin-filter-missing"));
  expect(screen.getAllByRole("listitem").map((item) => item.dataset.testid)).toEqual(["lead-checkin-row-r2", "lead-checkin-row-r3", "lead-checkin-row-r5"]);
});

test("„Da“ zählt sofort mit und speichert über den Check-in-Weg", async () => {
  let answer;
  apiMock.post.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
  renderBoard(SOLO_BOARD);
  fireEvent.click(await screen.findByTestId("lead-checkin-here-r3"));
  // Noch keine Antwort vom Server - der Zähler stimmt trotzdem schon.
  expect(counter()).toHaveTextContent("2 von 5 da");
  expect(screen.getByTestId("lead-checkin-row-r3")).toHaveAttribute("data-status", "checked_in");
  expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/registrations/r3/checkin", { status: "checked_in" });
  await act(async () => answer({ data: { id: "r3", status: "checked_in", checked_in_at: "2026-11-14T17:10:00+00:00" } }));
  expect(counter()).toHaveTextContent("2 von 5 da");
  expect(screen.getByTestId("lead-checkin-row-r3")).toHaveTextContent("Da · 18:10");

  apiMock.post.mockResolvedValueOnce({ data: { id: "r3", status: "approved" } });
  fireEvent.click(screen.getByTestId("lead-checkin-undo-r3"));
  await waitFor(() => expect(counter()).toHaveTextContent("1 von 5 da"));
  expect(apiMock.post).toHaveBeenLastCalledWith("/tournaments/t1/registrations/r3/checkin", { status: "approved" });
});

test("geht das Speichern schief, springt die Zeile zurück und eine Meldung sagt es", async () => {
  apiMock.post.mockRejectedValueOnce({ response: { data: { detail: "Eine Turnieraktion wird bereits verarbeitet. Bitte erneut versuchen." } } });
  renderBoard(SOLO_BOARD);
  fireEvent.click(await screen.findByTestId("lead-checkin-here-r2"));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Zoë Ångström: Eine Turnieraktion wird bereits verarbeitet. Bitte erneut versuchen."));
  expect(counter()).toHaveTextContent("1 von 5 da");
  expect(screen.getByTestId("lead-checkin-row-r2")).toHaveAttribute("data-status", "approved");
});

test("„Nicht erschienen“ mit Nachrücker meldet es", async () => {
  apiMock.post.mockResolvedValueOnce({ data: { id: "r3", status: "no_show", waitlist_moved_up: ["r9"], placement: null } });
  renderBoard(SOLO_BOARD);
  fireEvent.click(await screen.findByTestId("lead-checkin-noshow-r3"));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Nicht erschienen gesetzt – 1 Person rückt von der Warteliste nach."));
  expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/registrations/r3/checkin", { status: "no_show" });
  expect(screen.getByTestId("lead-checkin-summary")).toHaveTextContent("2 nicht erschienen");
});

test("Team-Zeile: ein Team, zehn Mitglieder ohne Aufstellung - oder Spielt/Ersatz; Suche findet Mitglieder", async () => {
  renderBoard(TEAM_BOARD);
  const lions = await screen.findByTestId("lead-checkin-row-lsw");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(lions).toHaveTextContent("[LSW]");
  const members = within(screen.getByTestId("lead-checkin-members-lsw"));
  expect(members.getByText(/Keine Aufstellung – ganzes Team · 2 von 10 sagen „Ich bin da“/)).toBeInTheDocument();
  expect(members.getByText("Mitglied 0 (Leitung)", { exact: false })).toBeInTheDocument();
  expect(members.getByText("Maximilian-Alexander von Hohenzollern-Sigmaringen")).toBeInTheDocument();
  // Finanzen sehen den Betrag am Etikett.
  expect(screen.getByTestId("lead-checkin-fee-lsw")).toHaveTextContent(/Startgeld offen · €\s50,00/);

  const falcons = within(screen.getByTestId("lead-checkin-members-flk"));
  expect(falcons.getByText("Spielt")).toBeInTheDocument();
  expect(falcons.getByText("Ersatz")).toBeInTheDocument();
  expect(counter()).toHaveTextContent("1 von 2 da");

  fireEvent.change(screen.getByTestId("lead-checkin-search"), { target: { value: "hohenzollern" } });
  expect(screen.getAllByRole("listitem").map((item) => item.dataset.testid)).toEqual(["lead-checkin-row-lsw"]);
  expect(screen.getByTestId("lead-checkin-search")).toHaveAttribute("placeholder", "Team, Kürzel oder Mitglied suchen");
});
