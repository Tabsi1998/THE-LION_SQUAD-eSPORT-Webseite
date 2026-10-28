import { act, fireEvent, render, screen } from "@testing-library/react";

// Ergebnis-Fenster (#1156): ohne Zahlentastatur eintragen - Plus/Minus, Best-of antippen, Zielreihenfolge oder Punkte.
// Vor dem Speichern steht der Satz, gespeichert wird mit „hold“ (10 Sekunden „Rückgängig“), korrigiert nur mit Grund.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ResultWindow } = await import("./ResultWindow");
const { ResultUndoBar, useResultUndo } = await import("./ResultUndoBar");

const DUEL = {
  id: "m1", kind: "duel", best_of: 1, ranking_mode: "higher_score", allows_draw: false, label: "Halbfinale A", station_text: "PC 3",
  participants: [{ registration_id: "a", name: "NeonFalke" }, { registration_id: "b", name: "PixelPanther" }],
  advance: { 1: { text: "ins Finale", flow: "W" } }, has_result: false, result: [],
};

beforeEach(() => {
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { held: true, hold: { id: "h1", undo_seconds: 10 } } });
  window.localStorage.clear();
});

test("1 gegen 1: Plus und Minus, Satz vor dem Speichern, gespeichert wird mit Rückgängig-Frist", async () => {
  const saved = vi.fn();
  render(<ResultWindow entry={DUEL} onClose={() => {}} onSaved={saved} />);
  expect(screen.getByTestId("result-window")).toHaveAttribute("data-kind", "score");
  fireEvent.click(screen.getByTestId("result-save"));
  expect(screen.getByTestId("result-error")).toHaveTextContent("Gleichstand geht in diesem Spiel nicht");
  expect(apiMock.post).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId("result-score-a-plus"));
  fireEvent.click(screen.getByTestId("result-score-a-plus"));
  fireEvent.click(screen.getByTestId("result-score-b-plus"));
  expect(screen.getByTestId("result-sentence")).toHaveTextContent("NeonFalke gewinnt 2:1 – weiter ins Finale");
  await act(async () => { fireEvent.click(screen.getByTestId("result-save")); });
  expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/result", {
    results: [{ registration_id: "a", rank: 1, score: 2 }, { registration_id: "b", rank: 2, score: 1 }], hold: true, reason: null,
  });
  expect(saved).toHaveBeenCalledWith({ matchId: "m1", hold: { id: "h1", undo_seconds: 10 }, sentence: "NeonFalke gewinnt 2:1 – weiter ins Finale" });
});

test("„Nicht erschienen“ ist ein Tipp - die andere Seite gewinnt kampflos", async () => {
  render(<ResultWindow entry={DUEL} onClose={() => {}} onSaved={() => {}} />);
  fireEvent.click(screen.getByTestId("result-flag-b-no_show"));
  expect(screen.getByTestId("result-sentence")).toHaveTextContent("NeonFalke gewinnt kampflos, PixelPanther ist nicht erschienen – weiter ins Finale");
  await act(async () => { fireEvent.click(screen.getByTestId("result-save")); });
  expect(apiMock.post.mock.calls[0][1].results).toEqual([{ registration_id: "a", rank: 1 }, { registration_id: "b", rank: 2, forfeit: true }]);
});

test("Best-of: je Spiel den Sieger antippen, der Endstand ergibt sich", () => {
  render(<ResultWindow entry={{ ...DUEL, best_of: 3 }} onClose={() => {}} onSaved={() => {}} />);
  expect(screen.getByTestId("result-window")).toHaveAttribute("data-kind", "bestof");
  fireEvent.click(screen.getByTestId("result-game-1-a"));
  fireEvent.click(screen.getByTestId("result-game-2-b"));
  fireEvent.click(screen.getByTestId("result-game-3-a"));
  expect(screen.getByTestId("result-sentence")).toHaveTextContent("NeonFalke gewinnt 2:1");
});

test("Durchgang: Umschalter Reihenfolge | Punkte, die letzte Wahl bleibt", () => {
  const heat = { ...DUEL, kind: "heat", participants: [...DUEL.participants, { registration_id: "c", name: "LunaRacer" }], advance: { 1: { text: "ins Finale", flow: "W" } } };
  const { unmount } = render(<ResultWindow entry={heat} onClose={() => {}} onSaved={() => {}} />);
  expect(screen.getByTestId("result-window")).toHaveAttribute("data-kind", "order");
  fireEvent.click(screen.getByTestId("result-order-c"));
  fireEvent.click(screen.getByTestId("result-order-a"));
  fireEvent.click(screen.getByTestId("result-order-b"));
  expect(screen.getByTestId("result-sentence")).toHaveTextContent("Weiter: LunaRacer");
  fireEvent.click(screen.getByTestId("result-heat-mode-points"));
  expect(window.localStorage.getItem("tls_result_heat_mode")).toBe("points");
  unmount();
  render(<ResultWindow entry={heat} onClose={() => {}} onSaved={() => {}} />);
  expect(screen.getByTestId("result-window")).toHaveAttribute("data-kind", "points");
});

test("Korrigieren braucht einen Grund und schickt force mit", async () => {
  const done = { ...DUEL, has_result: true, result: [{ registration_id: "a", rank: 1, score: 2 }, { registration_id: "b", rank: 2, score: 1 }] };
  render(<ResultWindow entry={done} onClose={() => {}} onSaved={() => {}} />);
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Ergebnis korrigieren");
  fireEvent.click(screen.getByTestId("result-score-b-plus"));
  fireEvent.click(screen.getByTestId("result-score-b-plus"));
  await act(async () => { fireEvent.click(screen.getByTestId("result-save")); });
  expect(screen.getByTestId("result-error")).toHaveTextContent("Grund der Korrektur");
  fireEvent.change(screen.getByTestId("result-reason"), { target: { value: "Stand vertauscht" } });
  await act(async () => { fireEvent.click(screen.getByTestId("result-save")); });
  expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/result?force=true", expect.objectContaining({ hold: true, reason: "Stand vertauscht" }));
});

function UndoHarness({ onDone }) {
  const undo = useResultUndo({ onDone });
  return (
    <>
      <button type="button" onClick={() => undo.start({ matchId: "m1", hold: { id: "h1" }, sentence: "NeonFalke gewinnt 2:1" })}>start</button>
      <ResultUndoBar undo={undo} />
    </>
  );
}

test("Rückgängig: 10 Sekunden lang, danach ist die Leiste weg", async () => {
  vi.useFakeTimers();
  try {
    const onDone = vi.fn();
    render(<UndoHarness onDone={onDone} />);
    fireEvent.click(screen.getByText("start"));
    expect(screen.getByTestId("result-undo")).toHaveTextContent("Rückgängig (10)");
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(screen.getByTestId("result-undo")).toHaveTextContent("Rückgängig (6)");
    await act(async () => { fireEvent.click(screen.getByTestId("result-undo")); });
    expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/result/undo", { hold_id: "h1" });
    expect(screen.queryByTestId("result-undo-bar")).toBeNull();

    fireEvent.click(screen.getByText("start"));
    await act(async () => { vi.advanceTimersByTime(10500); });
    expect(screen.queryByTestId("result-undo-bar")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test("inzwischen eingetragen (#2124): bei 409 fragt das Fenster „als Korrektur speichern?“ - dann mit Grund und force", async () => {
  apiMock.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Dieses Spiel hat inzwischen ein Ergebnis. Zum Ändern als Korrektur mit Grund speichern." } } });
  apiMock.get.mockResolvedValueOnce({ data: { result_entry: { ...DUEL, has_result: true } } });
  const saved = vi.fn();
  render(<ResultWindow entry={DUEL} onClose={() => {}} onSaved={saved} />);
  fireEvent.click(screen.getByTestId("result-score-a-plus"));
  await act(async () => { fireEvent.click(screen.getByTestId("result-save")); });
  expect(apiMock.get).toHaveBeenCalledWith("/matches/m1/page");
  expect(screen.getByTestId("result-correction-offer")).toHaveTextContent("Inzwischen ist ein Ergebnis eingetragen – als Korrektur speichern?");
  expect(screen.queryByTestId("result-error")).toBeNull();
  expect(screen.queryByTestId("result-reason")).toBeNull();

  fireEvent.click(screen.getByTestId("result-correction-accept"));
  expect(screen.getByRole("dialog", { name: "Ergebnis korrigieren" })).toBeInTheDocument();
  expect(screen.getByTestId("result-reason")).toHaveAttribute("maxLength", "500");
  fireEvent.change(screen.getByTestId("result-reason"), { target: { value: "Gleichzeitig eingetragen" } });
  await act(async () => { fireEvent.click(screen.getByTestId("result-save")); });
  expect(apiMock.post).toHaveBeenLastCalledWith("/matches/m1/result?force=true", expect.objectContaining({ reason: "Gleichzeitig eingetragen", hold: true }));
  expect(saved).toHaveBeenCalled();
});

test("409 ohne neues Ergebnis (etwa „wird gerade eingetragen“): der Satz des Servers, kein Korrektur-Angebot", async () => {
  apiMock.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Halbfinale A: dort wird gerade ein Ergebnis eingetragen. Bitte kurz warten." } } });
  apiMock.get.mockResolvedValueOnce({ data: { result_entry: { ...DUEL, has_result: false } } });
  render(<ResultWindow entry={DUEL} onClose={() => {}} onSaved={() => {}} />);
  fireEvent.click(screen.getByTestId("result-score-a-plus"));
  await act(async () => { fireEvent.click(screen.getByTestId("result-save")); });
  expect(screen.getByTestId("result-error")).toHaveTextContent("dort wird gerade ein Ergebnis eingetragen");
  expect(screen.queryByTestId("result-correction-offer")).toBeNull();
});