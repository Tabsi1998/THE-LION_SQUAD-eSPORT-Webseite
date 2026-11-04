import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Veto je Season (#1618): Vorgaben sichtbar, Vorschlag übernehmen, Prüfung live mit den Sätzen des Servers, Speichern schickt die
// bereinigte Vorlage, Fehler des Servers stehen beim Kasten. Erfundene Modi.

const apiMock = { get: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeasonVetoRulesPanel } = await import("./SeasonVetoRulesPanel");

const DEFAULTS = { enabled: false, team_a: "home", step_seconds: 60, steps: [] };
const MODES = [{ mode: "hp", label: "Stellung", maps: 2 }, { mode: "snd", label: "Suchen", maps: 2 }];
const STEPS = [
  { kind: "pick", mode: "hp", team: "A", position: 1 }, { kind: "pick", mode: "hp", team: "B", position: 3 },
  { kind: "ban", mode: "snd", team: "B", position: null }, { kind: "decider", mode: "snd", team: null, position: 2 },
];
const STATE = { veto_rules: null, active: false, defaults: DEFAULTS, problems: [], modes: MODES, best_of: 3, game_mode_order: ["hp", "snd", "hp"], map_repeat: "other_mode", has_checkin: true, staffeln: 1 };

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.put.mockReset();
});

test("ältere Season: Hinweis, Vorschlag übernehmen, Prüfung grün, Speichern schickt die Vorlage", async () => {
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/proposal") ? { steps: STEPS, problems: [] } : STATE }));
  apiMock.put.mockResolvedValue({ data: { ...STATE, veto_rules: { enabled: true, team_a: "home", step_seconds: 60, steps: STEPS }, active: true, staffeln_updated: 1 } });
  render(<SeasonVetoRulesPanel seasonId="s1" />);
  expect(await screen.findByTestId("veto-rules-inactive")).toBeInTheDocument();
  expect(screen.getByTestId("veto-rules-empty")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("veto-rules-propose"));
  await waitFor(() => expect(screen.getByTestId("veto-rules-steps").children).toHaveLength(4));
  expect(screen.getByTestId("veto-rules-enabled")).toBeChecked();
  expect(screen.getByTestId("veto-step-3-sentence")).toHaveTextContent("Die übrige Map wird Map 2 (Suchen)");
  expect(screen.getByTestId("veto-rules-ok")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("veto-rules-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/veto-rules", { enabled: true, team_a: "home", step_seconds: 60, steps: STEPS }));
  await waitFor(() => expect(screen.queryByTestId("veto-rules-inactive")).toBeNull());
});

test("Prüfung live: doppelte Position und zu kleiner Pool sperren das Speichern, Schritte lassen sich ordnen und löschen", async () => {
  apiMock.get.mockResolvedValue({ data: { ...STATE, veto_rules: { enabled: true, team_a: "draw", step_seconds: 45, steps: STEPS }, active: true } });
  render(<SeasonVetoRulesPanel seasonId="s1" />);
  expect(await screen.findByTestId("veto-rules-seconds")).toHaveValue(45);
  expect(screen.getByTestId("veto-rules-team-a")).toHaveValue("draw");
  fireEvent.change(screen.getByTestId("veto-step-1-position"), { target: { value: "1" } });
  expect(screen.getByTestId("veto-rules-problems")).toHaveTextContent("Position 1 ist mehrfach belegt (Schritt 1 und 2).");
  expect(screen.getByTestId("veto-rules-problems")).toHaveTextContent("Position 3 ist nicht belegt");
  expect(screen.getByTestId("veto-rules-save")).toBeDisabled();
  fireEvent.change(screen.getByTestId("veto-step-1-position"), { target: { value: "3" } });
  expect(screen.queryByTestId("veto-rules-problems")).toBeNull();
  fireEvent.click(screen.getByTestId("veto-rules-add"));
  expect(screen.getByTestId("veto-rules-problems")).toHaveTextContent("Stellung: 1 Sperre und 2 Wahlen brauchen 3 Maps – der Pool hat 2.");
  fireEvent.click(screen.getByTestId("veto-step-4-remove"));
  expect(screen.queryByTestId("veto-rules-problems")).toBeNull();
  fireEvent.click(screen.getByTestId("veto-step-3-up"));
  expect(screen.getByTestId("veto-rules-problems")).toHaveTextContent("Suchen: Der Decider muss der letzte Schritt seines Modus sein.");
  fireEvent.click(screen.getByTestId("veto-step-2-down"));
  expect(screen.queryByTestId("veto-rules-problems")).toBeNull();
  // Aus: nichts wird geprüft, der Entwurf bleibt speicherbar.
  fireEvent.click(screen.getByTestId("veto-rules-enabled"));
  fireEvent.change(screen.getByTestId("veto-step-1-position"), { target: { value: "1" } });
  expect(screen.queryByTestId("veto-rules-problems")).toBeNull();
  expect(screen.getByTestId("veto-rules-save")).not.toBeDisabled();
});

test("ein Fehler des Servers steht beim Kasten, Probleme des gespeicherten Stands auch", async () => {
  apiMock.get.mockResolvedValue({ data: { ...STATE, veto_rules: { enabled: true, team_a: "home", step_seconds: 60, steps: STEPS }, active: true,
    problems: ["Mit „jede Map nur einmal je Serie“ lässt sich die Vorlage mit diesem Pool nicht zu Ende spielen – bitte Sperren oder Pool anpassen."], has_checkin: false } });
  apiMock.put.mockRejectedValue({ response: { data: { detail: "Die Vorlage passt noch nicht: Stellung: 2 Wahlen brauchen 2 Maps – der Pool hat 1." } } });
  render(<SeasonVetoRulesPanel seasonId="s1" />);
  expect(await screen.findByTestId("veto-rules-problems")).toHaveTextContent("jede Map nur einmal je Serie");
  expect(screen.getByTestId("veto-rules-no-checkin")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("veto-rules-save"));
  expect(await screen.findByTestId("veto-rules-error")).toHaveTextContent("Die Vorlage passt noch nicht");
});
