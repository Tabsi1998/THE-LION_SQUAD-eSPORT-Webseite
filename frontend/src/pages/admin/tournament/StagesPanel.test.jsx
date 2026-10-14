import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Spieldauer in den Phasen und im Matchplan (#1554): kein eingefrorener Wert mehr - ohne eigenen Wert steht da,
// woher die Dauer kommt (Phase, Turnier, Spiel), und Speichern schickt „leer“ als null.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback, formatApiError: (_e, f) => f }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/components/tls/results/ResultWindow", () => ({ ResultWindowLoader: () => null }));
vi.mock("@/components/tls/results/ResultUndoBar", () => ({ ResultUndoBar: () => null, useResultUndo: () => ({ start: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { TournamentStagesPanel } = await import("./StagesPanel");

const GAME = { match_modes: [{ mode: "gp4", label: "Grand Prix 4 Rennen", minutes: 12 }], setup_minutes: 3 };
const STAGE = { id: "s1", name: "Vorrunde", stage_type: "ffa_custom_bracket", match_type: "ffa", status: "pending", settings: { match_size: 4 } };
const MATCH = {
  id: "m1", stage_id: "s1", match_key: "A", round: 1, status: "scheduled", scheduled_at: "2026-10-31T10:00:00Z",
  slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }], results: [],
};
const PLAN_RIGHTS = () => ({ plan: true, results: false });

function panel(props = {}) {
  return render(
    <TournamentStagesPanel
      tournamentId="t1"
      stages={[STAGE]}
      matches={[MATCH]}
      registrations={[{ id: "r1", display_name: "A" }, { id: "r2", display_name: "B" }]}
      rightsForMatch={PLAN_RIGHTS}
      onChanged={() => {}}
      {...props}
    />,
  );
}

beforeEach(() => {
  apiMock.patch.mockReset();
  apiMock.patch.mockResolvedValue({ data: {} });
});

// Matchplan ersetzt die alte Matchplanung (Praxis nach #1589): im Reiter „Spiele“ stehen keine Felder mehr für Zeit,
// Station und Dauer je Spiel - nur der Hinweis und der Weg in den Matchplan. Die Felder prüft MatchPlanPanel.test.jsx.
test("Spiele: keine Planungsfelder mehr, Hinweis und Weg in den Matchplan", () => {
  const onOpenMatchplan = vi.fn();
  panel({ tournament: { match_duration_minutes: 45 }, durationGame: GAME, onOpenMatchplan });
  expect(screen.queryByLabelText("Dauer in Minuten")).toBeNull();
  expect(screen.queryByLabelText("Station")).toBeNull();
  expect(screen.queryByText("Planung speichern")).toBeNull();
  expect(screen.getByTestId("stages-matchplan-hint")).toHaveTextContent("Zeiten und Stationen planst du im Matchplan");
  fireEvent.click(screen.getByRole("button", { name: "Zum Matchplan" }));
  expect(onOpenMatchplan).toHaveBeenCalled();
  // Gelesen wird der Termin weiter an der Karte.
  expect(screen.getByText(/Termin offen|31\.10\./)).toBeInTheDocument();
});

test("Phase: leere Spieldauer erbt und geht als null an den Server", async () => {
  panel({ mode: "settings", canEditSettings: true, tournament: {}, durationGame: GAME });
  const duration = screen.getByTestId("stage-duration-s1");
  expect(duration).toHaveValue(null);
  expect(screen.getByTestId("stage-duration-source-s1")).toHaveTextContent("vom Spiel: 15 Min.");
  fireEvent.click(screen.getByTestId("stage-save-s1"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  expect(apiMock.patch.mock.calls[0][1].settings.duration_minutes).toBeNull();

  fireEvent.change(duration, { target: { value: "25" } });
  fireEvent.click(screen.getByTestId("stage-save-s1"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(2));
  expect(apiMock.patch.mock.calls[1][1].settings.duration_minutes).toBe(25);
});
