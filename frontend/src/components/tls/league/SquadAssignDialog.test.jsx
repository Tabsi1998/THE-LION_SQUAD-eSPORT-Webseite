import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// „Co-Team zuteilen“ (#1649): erst Hauptteam, dann Co-Team; Co-Teams mit Grund sind nicht wählbar; ein Fehler des
// Servers steht verständlich im Dialog. Erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({
  api: apiMock,
  formatRequestError: (err, fallback) => err?.response?.data?.detail || fallback,
}));
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
const { SquadAssignDialog, canAssignSquads } = await import("./SquadAssignDialog");

const CANDIDATES = {
  min_squad_size: 4,
  max_participants: 8,
  seats_taken: 3,
  teams: [
    {
      id: "t-loewen", name: "Loewen", tag: "LOE", in_staffel: false,
      squads: [
        { id: "s-a", name: "Rudel A", display_name: "Loewen · Rudel A", member_count: 5, captain: { id: "u1", display_name: "Mila" }, vice_captain: null, problems: [] },
        { id: "s-c", name: "Rudel C", display_name: "Loewen · Rudel C", member_count: 2, captain: null, vice_captain: null, problems: ["Rudel C hat 2 Spieler im Kader – die Liga verlangt mindestens 4."] },
      ],
    },
    { id: "t-falken", name: "Falken", tag: "FAL", in_staffel: true, squads: [{ id: "s-h", name: "Horst", display_name: "Falken · Horst", member_count: 4, problems: ["schon drin"] }] },
  ],
};

const TOURNAMENT = { id: "liga-a", team_mode: "team", format: "league" };

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  toastMock.success.mockReset();
  apiMock.get.mockResolvedValue({ data: CANDIDATES });
});

test("canAssignSquads: nur Team-Turniere im Format Liga oder mit Liga-Rahmen", () => {
  expect(canAssignSquads(TOURNAMENT)).toBe(true);
  expect(canAssignSquads({ team_mode: "team", format: "single_elim", league_context: { staffel: "A" } })).toBe(true);
  expect(canAssignSquads({ team_mode: "team", format: "single_elim" })).toBe(false);
  expect(canAssignSquads({ team_mode: "solo", format: "league" })).toBe(false);
  expect(canAssignSquads(null)).toBe(false);
});

test("geführt: Team wählen, Co-Team wählen, zuteilen", async () => {
  const onAssigned = vi.fn();
  apiMock.post.mockResolvedValue({ data: { registration: { id: "r1" } } });
  render(<SquadAssignDialog tournament={TOURNAMENT} onAssigned={onAssigned} />);

  fireEvent.click(screen.getByTestId("squad-assign-open"));
  await waitFor(() => expect(screen.getByTestId("squad-assign-team-t-loewen")).toBeInTheDocument());
  expect(apiMock.get).toHaveBeenCalledWith("/tournaments/liga-a/squad-candidates");
  expect(screen.getByTestId("squad-assign-seats")).toHaveTextContent("Mindestkader 4 · 3 von 8 Plätzen belegt");
  expect(screen.getByText("hat schon ein Co-Team in dieser Staffel")).toBeInTheDocument();
  expect(screen.getByText("2 Co-Teams, 1 zuteilbar")).toBeInTheDocument();
  expect(screen.getByTestId("squad-assign-confirm")).toBeDisabled();

  fireEvent.click(screen.getByTestId("squad-assign-team-t-loewen"));
  expect(screen.getByText("Schritt 2 von 2: Welches Co-Team spielt in dieser Staffel?")).toBeInTheDocument();
  expect(screen.getByTestId("squad-assign-squad-s-c")).toBeDisabled();
  expect(screen.getByText("Rudel C hat 2 Spieler im Kader – die Liga verlangt mindestens 4.")).toBeInTheDocument();
  expect(screen.getByText("5 im Kader · Captain Mila")).toBeInTheDocument();
  expect(screen.getByText("2 im Kader · ohne Captain – die Teamleitung handelt")).toBeInTheDocument();

  fireEvent.click(screen.getByTestId("squad-assign-squad-s-a"));
  fireEvent.click(screen.getByTestId("squad-assign-confirm"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/liga-a/squad-registrations", { team_id: "t-loewen", squad_id: "s-a" }));
  await waitFor(() => expect(onAssigned).toHaveBeenCalled());
  expect(toastMock.success).toHaveBeenCalledWith("Loewen · Rudel A ist in der Staffel.");
  expect(screen.queryByTestId("squad-assign-dialog")).not.toBeInTheDocument();
});

test("Spiel-ID je Spieler (#2108): fehlt sie, warnt der Dialog mit Namen – zuteilen geht trotzdem", async () => {
  const players = [
    { id: "u1", name: "Mila", state: "locked", ok: true, text: "Testloewe#1234567" },
    { id: "u2", name: "Tom", state: "missing", ok: false, text: null, reason: "Activision-ID fehlt im Profil." },
  ];
  apiMock.get.mockResolvedValue({ data: { ...CANDIDATES, id_label: "Activision-ID", teams: [{ ...CANDIDATES.teams[0], squads: [{ ...CANDIDATES.teams[0].squads[0], players }] }] } });
  apiMock.post.mockResolvedValue({ data: { registration: { id: "r1" }, ids_missing: ["Tom"] } });
  render(<SquadAssignDialog tournament={TOURNAMENT} onAssigned={vi.fn()} />);
  fireEvent.click(screen.getByTestId("squad-assign-open"));
  await waitFor(() => expect(screen.getByTestId("squad-assign-team-t-loewen")).toBeInTheDocument());
  fireEvent.click(screen.getByTestId("squad-assign-team-t-loewen"));

  expect(screen.getByTestId("squad-assign-ids-s-a")).toHaveTextContent("MilaTestloewe#1234567");
  expect(screen.getByTestId("squad-assign-ids-warning-s-a")).toHaveTextContent("Ohne gültige Activision-ID: Tom.");
  expect(screen.getByTestId("squad-assign-squad-s-a")).not.toBeDisabled();
  fireEvent.click(screen.getByTestId("squad-assign-squad-s-a"));
  fireEvent.click(screen.getByTestId("squad-assign-confirm"));

  await waitFor(() => expect(toastMock.warning).toHaveBeenCalled());
  expect(toastMock.warning.mock.calls[0][0]).toContain("Activision-ID fehlt: Tom");
});

test("ein Fehler des Servers steht verständlich im Dialog, der bleibt offen", async () => {
  apiMock.post.mockRejectedValue({ response: { status: 409, data: { detail: "Die Staffel ist voll (8 von 8 Plätzen)." } } });
  render(<SquadAssignDialog tournament={TOURNAMENT} onAssigned={vi.fn()} />);
  fireEvent.click(screen.getByTestId("squad-assign-open"));
  await waitFor(() => expect(screen.getByTestId("squad-assign-team-t-loewen")).toBeInTheDocument());
  fireEvent.click(screen.getByTestId("squad-assign-team-t-loewen"));
  fireEvent.click(screen.getByTestId("squad-assign-squad-s-a"));
  fireEvent.click(screen.getByTestId("squad-assign-confirm"));

  await waitFor(() => expect(screen.getByTestId("squad-assign-error")).toHaveTextContent("Die Staffel ist voll (8 von 8 Plätzen)."));
  expect(screen.getByTestId("squad-assign-dialog")).toBeInTheDocument();
  expect(apiMock.get).toHaveBeenCalledTimes(2);

  fireEvent.click(screen.getByText("Anderes Team"));
  expect(screen.getByText("Schritt 1 von 2: Zu welchem Team gehört das Co-Team?")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByTestId("squad-assign-dialog")).not.toBeInTheDocument();
});

test("nach einem Ladefehler lädt „Erneut laden“ nach; beim Öffnen steht der Fokus im Dialog", async () => {
  apiMock.get.mockRejectedValueOnce({ response: { status: 500, data: {} } });
  render(<SquadAssignDialog tournament={TOURNAMENT} onAssigned={vi.fn()} />);
  fireEvent.click(screen.getByTestId("squad-assign-open"));

  expect(screen.getByTestId("squad-assign-dialog")).toHaveFocus();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Co-Teams lassen sich gerade nicht laden."));
  fireEvent.click(screen.getByTestId("squad-assign-reload"));

  await waitFor(() => expect(screen.getByTestId("squad-assign-team-t-loewen")).toBeInTheDocument());
  expect(apiMock.get).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId("squad-assign-reload")).not.toBeInTheDocument();
});