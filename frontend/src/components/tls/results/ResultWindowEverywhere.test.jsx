import { act, fireEvent, render, screen } from "@testing-library/react";

// Ein Ergebnis-Fenster für alle Wege (#1370): Turnierleitung und Matchseite öffnen es mit der Beschreibung des Spiels,
// Matchplan und Stationen laden sie über die Matchseite - es ist überall derselbe Baustein, und dieselbe Eingabe ergibt
// dieselbe Anfrage. Namen sind erfunden.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value, formatRequestError: (_e, fallback) => fallback }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => vi.fn(async () => true) }));

const { ResultWindow, ResultWindowLoader } = await import("./ResultWindow");
const { TournamentStagesPanel } = await import("@/pages/admin/tournament/StagesPanel");

const ENTRY = {
  id: "m1", kind: "duel", best_of: 1, ranking_mode: "higher_score", allows_draw: false, has_result: false, result: [], label: "Viertelfinale",
  participants: [{ registration_id: "r1", name: "Lions Rocket" }, { registration_id: "r2", name: "Boost und Burger" }], advance: { 1: { text: "ins Halbfinale", flow: "W" } },
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.get.mockResolvedValue({ data: { result_entry: ENTRY } });
  apiMock.post.mockResolvedValue({ data: { held: true, hold: { id: "h1" } } });
});

async function enterThreeOne() {
  for (let step = 0; step < 3; step += 1) fireEvent.click(screen.getByTestId("result-score-r1-plus"));
  fireEvent.click(screen.getByTestId("result-score-r2-plus"));
  expect(screen.getByTestId("result-sentence")).toHaveTextContent("Lions Rocket gewinnt 3:1 – weiter ins Halbfinale");
  await act(async () => { fireEvent.click(screen.getByTestId("result-save")); });
  return apiMock.post.mock.calls.at(-1);
}

test("direkt (Turnierleitung, Matchseite) und geladen (Matchplan, Stationen): dieselbe Anfrage", async () => {
  const { unmount } = render(<ResultWindow entry={ENTRY} onClose={() => {}} onSaved={() => {}} />);
  const direct = await enterThreeOne();
  unmount();

  render(<ResultWindowLoader matchId="m1" onClose={() => {}} onSaved={() => {}} />);
  await screen.findByTestId("result-window");
  expect(apiMock.get).toHaveBeenCalledWith("/matches/m1/page");
  const loaded = await enterThreeOne();
  expect(loaded).toEqual(direct);
  expect(direct).toEqual(["/matches/m1/result", { results: [{ registration_id: "r1", rank: 1, score: 3 }, { registration_id: "r2", rank: 2, score: 1 }], hold: true, reason: null }]);
});

test("geladen: wer gleich beim Erscheinen tippt, verliert keinen Tipp - ein später Effekt setzt nichts zurück", async () => {
  render(<ResultWindowLoader matchId="m1" onClose={() => {}} onSaved={() => {}} />);
  // Ohne den Umweg über findBy: getippt wird im selben Takt, in dem das Fenster erscheint - also bevor React die Effekte
  // des Aufbaus nachholt. Unter Last auf GitHub ist genau das passiert (aus 3:1 wurde 2:1).
  await new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector("[data-testid='result-score-r1-plus']")) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(document.body, { subtree: true, childList: true });
  });
  const request = await enterThreeOne();
  expect(request[1].results).toEqual([{ registration_id: "r1", rank: 1, score: 3 }, { registration_id: "r2", rank: 2, score: 1 }]);
});

test("Matchplan: „Ergebnis eintragen“ öffnet das Fenster - ohne Zahlenfelder, ohne „DNF“ und „Forfeit“", async () => {
  const match = {
    id: "m1", stage_id: "s1", match_key: "VF-1", round: 1, round_name: "Viertelfinale", section: "main", status: "in_progress",
    slots: [{ slot: 1, status: "filled", registration_id: "r1" }, { slot: 2, status: "filled", registration_id: "r2" }],
  };
  render(
    <TournamentStagesPanel tournamentId="t1" stages={[{ id: "s1", name: "K.-o.", stage_type: "single_elimination", stage_number: 1, settings: {} }]} matches={[match]}
      registrations={[{ id: "r1", display_name: "Lions Rocket" }, { id: "r2", display_name: "Boost und Burger" }]} isAdmin={false} isModerator canRecordResults onChanged={() => {}} onSaveMatchMeta={() => {}} />,
  );
  expect(screen.queryByText(/DNF|Forfeit/)).toBeNull();
  fireEvent.click(await screen.findByTestId("matchplan-result-m1"));
  expect(await screen.findByTestId("result-window")).toBeInTheDocument();
  expect(screen.getByTestId("result-flag-r1-no_show")).toHaveTextContent("Nicht erschienen");
});
