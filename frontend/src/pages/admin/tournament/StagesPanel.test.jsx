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
      onSaveMatchMeta={vi.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  apiMock.patch.mockReset();
  apiMock.patch.mockResolvedValue({ data: {} });
});

test("Matchplan: ohne eigene Dauer zeigt das Spiel die Dauer vom Turnier", () => {
  panel({ tournament: { match_duration_minutes: 45 }, durationGame: GAME });
  expect(screen.getByLabelText("Dauer in Minuten")).toHaveValue(null);
  expect(screen.getByLabelText("Dauer in Minuten")).toHaveAttribute("placeholder", "45");
  expect(screen.getByTestId("matchplan-duration-source-m1")).toHaveTextContent("vom Turnier: 45 Min.");
  expect(screen.getByTestId("matchplan-saved-m1")).toHaveTextContent("Dauer 45 Min.");
});

test("Matchplan: ohne Turnierwert kommt die Dauer vom Spiel", () => {
  panel({ tournament: {}, durationGame: GAME });
  expect(screen.getByTestId("matchplan-duration-source-m1")).toHaveTextContent("vom Spiel: 15 Min. (Grand Prix 4 Rennen)");
});

test("Matchplan: eine eigene Dauer steht im Feld", () => {
  panel({ matches: [{ ...MATCH, duration_minutes: 20 }], tournament: { match_duration_minutes: 45 } });
  expect(screen.getByLabelText("Dauer in Minuten")).toHaveValue(20);
  expect(screen.getByTestId("matchplan-saved-m1")).toHaveTextContent("Dauer 20 Min.");
  expect(screen.getByTestId("matchplan-duration-source-m1")).toHaveTextContent("Leer lassen: vom Turnier: 45 Min.");
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
