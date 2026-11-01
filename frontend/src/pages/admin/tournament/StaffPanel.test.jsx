import { fireEvent, render, screen } from "@testing-library/react";

// Helfer-Einsatz (#2111, TA25): der Bereich kommt aus einer Auswahl dieses Turniers - keine rohe Kennung mehr als
// Freitext; die Liste nennt den Bereich beim Namen.

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(async () => ({ data: [] })), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }, formatRequestError: (_e, f) => f }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/components/tls/PersonPicker", () => ({ PersonPicker: () => <div data-testid="person-picker" /> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { TournamentStaffPanel, scopeChoices } = await import("./StaffPanel");

const STAGES = [{ id: "st-1", name: "Turnierbaum", number: 1 }];
const STATIONS = [{ id: "sta-1", name: "A" }];
const MATCHES = [
  { id: "m-1", section: "WB", round_name: "Halbfinale", match_key: "C" },
  { id: "m-prev", section: "WB", match_key: "X", is_preview: true },
];

test("die Auswahl kennt Phasen, Stationen und echte Spiele - keine Vorschau", () => {
  const choices = scopeChoices({ stages: STAGES, stations: STATIONS, matches: MATCHES });
  expect(choices.stage).toEqual([["st-1", "Turnierbaum"]]);
  expect(choices.station).toEqual([["sta-1", "Station A"]]);
  expect(choices.match).toEqual([["m-1", "Winner Bracket · Halbfinale · C"]]);
});

test("kein Freitext für die Kennung, die Liste nennt den Bereich beim Namen", () => {
  const staff = [
    { id: "a-1", role: "scorekeeper", scope: "stage", scope_id: "st-1", is_active: true, user: { display_name: "Hanna" } },
    { id: "a-2", role: "referee", scope: "station", scope_id: null, is_active: true, user: { display_name: "Paul" } },
  ];
  render(<TournamentStaffPanel tournamentId="t-1" staff={staff} onChanged={() => {}} stages={STAGES} stations={STATIONS} matches={MATCHES} />);
  expect(screen.queryByText("Bereich-ID")).toBeNull();
  expect(screen.queryByTestId("tournament-staff-scope-id")).toBeNull();
  fireEvent.change(screen.getByTestId("tournament-staff-scope"), { target: { value: "stage" } });
  const which = screen.getByTestId("tournament-staff-scope-id");
  expect([...which.querySelectorAll("option")].map((option) => option.textContent)).toEqual(["Alle Phasen", "Turnierbaum"]);
  expect(screen.getAllByText("Turnierbaum").length).toBeGreaterThan(1);
  expect(screen.getByText("Alle Stationen")).toBeInTheDocument();
});
