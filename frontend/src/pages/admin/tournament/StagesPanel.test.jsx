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

// Weiterkommen je Phase (#1590): leer erbt; ein Modus geht mit Schalter-Spiegel mit, die Show-Minuten nur bei der Show.
test("Phase: Weiterkommen mit vier Modi, Show-Minuten nur bei der Show-Auslosung", async () => {
  panel({ mode: "settings", canEditSettings: true, tournament: {}, durationGame: GAME });
  const select = screen.getByTestId("stage-advancement-s1");
  expect(select).toHaveValue("");
  expect(screen.queryByTestId("stage-advancement-s1-hint")).toBeNull();
  fireEvent.click(screen.getByTestId("stage-save-s1"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  expect(apiMock.patch.mock.calls[0][1].settings).toMatchObject({ advancement_mode: null, randomize_advancement_rounds: null, draw_show_minutes: null });

  fireEvent.change(select, { target: { value: "instant" } });
  expect(screen.getByTestId("stage-advancement-s1-hint")).toHaveTextContent(/sofort auf einen zufälligen freien Platz/);
  expect(screen.queryByTestId("stage-advancement-s1-minutes")).toBeNull();
  fireEvent.change(select, { target: { value: "draw_show" } });
  fireEvent.change(screen.getByTestId("stage-advancement-s1-minutes"), { target: { value: "7" } });
  fireEvent.click(screen.getByTestId("stage-save-s1"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(2));
  expect(apiMock.patch.mock.calls[1][1].settings).toMatchObject({ advancement_mode: "draw_show", randomize_advancement_rounds: true, draw_show_minutes: 7 });
});

test("Phase: der alte Schalter wird als Modus vorbelegt", () => {
  panel({ mode: "settings", canEditSettings: true, tournament: {}, durationGame: GAME, stages: [{ ...STAGE, settings: { match_size: 4, randomize_advancement_rounds: true } }] });
  expect(screen.getByTestId("stage-advancement-s1")).toHaveValue("draw_round");
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

// Regeln dieser Phase (#1636): im Betrieb nur für die Turnierleitung, aufklappbar; Speichern schickt nur die Regel-Felder,
// damit Name, Status und Aufbau nicht mit einem alten Stand überschrieben werden.
test("Regeln dieser Phase: nur mit Leitungsrecht sichtbar", () => {
  panel({ tournament: {}, durationGame: GAME });
  expect(screen.queryByTestId("stage-rules-toggle-s1")).toBeNull();
});

test("Regeln dieser Phase: Austragung mit Erklärung, Speichern nur mit Regel-Feldern", async () => {
  const stage = { ...STAGE, status: "running", settings: { match_size: 4, schema: "x", advancement_mode: "draw_round" } };
  panel({ canEditSettings: true, tournament: {}, durationGame: GAME, stages: [stage] });
  const toggle = screen.getByTestId("stage-rules-toggle-s1");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByTestId("stage-rules-save-s1")).toBeNull();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByTestId("stage-rules-event-mode-hint-s1")).toHaveTextContent("wie es beim Turnier eingestellt ist");
  fireEvent.change(screen.getByTestId("stage-rules-event-mode-s1"), { target: { value: "local" } });
  expect(screen.getByTestId("stage-rules-event-mode-hint-s1")).toHaveTextContent("Stationen");
  fireEvent.click(screen.getByTestId("stage-rules-save-s1"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  const [url, body] = apiMock.patch.mock.calls[0];
  expect(url).toBe("/tournaments/t1/stages/s1");
  expect(Object.keys(body)).toEqual(["settings"]);
  expect(body.settings).toMatchObject({ event_mode: "local", match_size: 4, schema: "x", advancement_mode: "draw_round", duration_minutes: null });
  // Die Spielliste bleibt darunter.
  expect(screen.getByTestId("stages-matchplan-hint")).toBeInTheDocument();
});

// Codex zu #1636: Nach dem Neuladen derselben Phase folgt das Formular dem neuen Stand - Speichern schreibt keine alten
// Werte zurück; Show-Auslosung mit Minuten und ein gespeichertes Grand Final bleiben erhalten.
test("Regeln dieser Phase: neuer Stand der Phase ersetzt das Formular, nichts geht verloren", async () => {
  const first = { ...STAGE, updated_at: "1", settings: { match_size: 4, event_mode: "online" } };
  const props = { canEditSettings: true, tournament: {}, durationGame: GAME };
  const view = panel({ ...props, stages: [first] });
  fireEvent.click(screen.getByTestId("stage-rules-toggle-s1"));
  const toggle = screen.getByTestId("stage-rules-toggle-s1");
  expect(document.getElementById(toggle.getAttribute("aria-controls"))).not.toBeNull();
  expect(screen.getByTestId("stage-rules-event-mode-s1")).toHaveValue("online");

  const reloaded = {
    ...first, updated_at: "2",
    settings: { match_size: 4, event_mode: "local", advancement_mode: "draw_show", randomize_advancement_rounds: true, draw_show_minutes: 7, grand_final: "single" },
  };
  view.rerender(
    <TournamentStagesPanel tournamentId="t1" stages={[reloaded]} matches={[MATCH]} registrations={[]} rightsForMatch={PLAN_RIGHTS} onChanged={() => {}} {...props} />,
  );
  await waitFor(() => expect(screen.getByTestId("stage-rules-event-mode-s1")).toHaveValue("local"));
  fireEvent.click(screen.getByTestId("stage-rules-save-s1"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  expect(apiMock.patch.mock.calls[0][1].settings).toMatchObject({
    event_mode: "local", advancement_mode: "draw_show", randomize_advancement_rounds: true, draw_show_minutes: 7, grand_final: "single",
  });
});

// Liga-Staffel (#2109, S23): keine „Regeln dieser Phase“ (Vor Ort schaltete die Spielwochen ab), kein Stations-Hinweis.
test("Staffel: keine Regeln je Phase, der Hinweis spricht von Spielwochen statt Stationen", () => {
  const staffel = { league_context: { league_id: "l1", season_id: "s1", division_id: "d1", staffel: "A" }, format: "league" };
  panel({ canEditSettings: true, tournament: staffel, durationGame: GAME, onOpenMatchplan: () => {} });
  expect(screen.queryByTestId("stage-rules-toggle-s1")).toBeNull();
  const hint = screen.getByTestId("stages-matchplan-hint");
  expect(hint).toHaveTextContent("Spielwochen");
  expect(hint).not.toHaveTextContent("Station");
});