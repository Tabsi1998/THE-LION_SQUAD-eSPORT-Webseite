import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Tabelle der Liga-Staffel in der Verwaltung (E.1, #1625): Gleichstand sehen, Reihenfolge mit Grund festlegen,
// Entscheid zurücknehmen; dazu die Tabellenregeln der Season als Formular.
const apiMock = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeasonTablePanel } = await import("./SeasonTablePanel");
const { SeasonTableRules } = await import("./SeasonTableRules");
const { tableRulesToForm } = await import("@/lib/leagueTable");

const DIVISIONS = [{ label: "Liga 1", staffeln: [{ tournament_id: "t1", staffel: "A", status: "live" }, { tournament_id: "t2", staffel: "B", status: "draft" }] }];
const TABLE = {
  can_decide: true,
  rules: { tiebreakers: ["head_to_head", "score_diff", "score_for", "lead_decision"] },
  ties: [{ rank: 1, registration_ids: ["r1", "r2"], names: ["Nordlicht", "Sturmfalke"], points: 3 }],
  decisions: [{ id: "d0", registration_ids: ["r3", "r4"], names: ["Eisbär", "Wüstenfuchs"], reason: "Los vor Zeugen", decided_at: "2026-11-20T18:00:00+00:00", applies: false }],
};

beforeEach(() => {
  for (const fn of [...Object.values(apiMock), ...Object.values(toastMock)]) fn.mockReset();
  apiMock.get.mockResolvedValue({ data: TABLE });
  apiMock.put.mockResolvedValue({ data: {} });
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
});

test("zeigt nur gestartete Staffeln mit Gleichstand und legt die Reihenfolge mit Grund fest", async () => {
  render(<SeasonTablePanel divisions={DIVISIONS} canDecide />);
  const tie = await screen.findByTestId("season-tie-t1-1");
  expect(apiMock.get).toHaveBeenCalledTimes(1);
  expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/staffeln/t1/table");
  expect(tie).toHaveTextContent("Platz 1: Nordlicht, Sturmfalke");
  expect(screen.getByTestId("season-ties-t1")).toHaveTextContent("Punkte → Direkter Vergleich → Map-Differenz → Mehr gewonnene Maps → Entscheid der Leitung");
  expect(screen.getByTestId("season-decision-d0")).toHaveTextContent("Gilt nicht mehr");

  fireEvent.click(screen.getByTestId("season-tie-decide-1"));
  const sheet = await screen.findByTestId("table-decision-sheet");
  fireEvent.click(within(sheet).getByTestId("table-decision-down-0"));
  expect(within(sheet).getByTestId("table-decision-order")).toHaveTextContent(/Sturmfalke.*Nordlicht/);
  fireEvent.change(within(sheet).getByTestId("table-decision-reason"), { target: { value: "los" } });
  fireEvent.click(within(sheet).getByTestId("table-decision-save"));
  expect(toastMock.error).toHaveBeenCalled();
  expect(apiMock.put).not.toHaveBeenCalled();
  fireEvent.change(within(sheet).getByTestId("table-decision-reason"), { target: { value: "Losentscheid vor beiden Captains" } });
  fireEvent.click(within(sheet).getByTestId("table-decision-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/staffeln/t1/table-decision",
    { registration_ids: ["r2", "r1"], reason: "Losentscheid vor beiden Captains" }));
});

test("nimmt einen Entscheid mit Grund zurück - ohne Recht gibt es keine Knöpfe", async () => {
  const { unmount } = render(<SeasonTablePanel divisions={DIVISIONS} canDecide />);
  fireEvent.click(await screen.findByTestId("season-decision-remove-d0"));
  const sheet = await screen.findByTestId("table-decision-remove-sheet");
  fireEvent.change(within(sheet).getByTestId("table-decision-remove-reason"), { target: { value: "Ergebnis korrigiert" } });
  fireEvent.click(within(sheet).getByTestId("table-decision-remove-save"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/leagues/staffeln/t1/table-decision/d0", { data: { reason: "Ergebnis korrigiert" } }));
  unmount();

  render(<SeasonTablePanel divisions={DIVISIONS} canDecide={false} />);
  await screen.findByTestId("season-tie-t1-1");
  expect(screen.queryByTestId("season-tie-decide-1")).toBeNull();
  expect(screen.queryByTestId("season-decision-remove-d0")).toBeNull();
});

test("ohne gestartete Staffel bleibt das Feld weg", () => {
  const { container } = render(<SeasonTablePanel divisions={[{ label: "Liga 1", staffeln: [{ tournament_id: "t2", staffel: "B", status: "draft" }] }]} canDecide />);
  expect(container).toBeEmptyDOMElement();
  expect(apiMock.get).not.toHaveBeenCalled();
});

function RulesHarness({ initial }) {
  const [form, setForm] = useState(tableRulesToForm(initial));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <>
      <SeasonTableRules form={form} set={set} />
      <output data-testid="rules-state">{JSON.stringify(form)}</output>
    </>
  );
}

test("die Tabellenregeln der Season: Reihenfolge, Mini-Tabelle, Remis, Default-Win, Ausscheiden", () => {
  render(<RulesHarness initial={{}} />);
  const state = () => JSON.parse(screen.getByTestId("rules-state").textContent);
  expect(screen.queryByTestId("head-to-head-points")).toBeNull();
  fireEvent.click(screen.getByTestId("tiebreaker-score_diff"));
  fireEvent.click(screen.getByTestId("tiebreaker-head_to_head"));
  fireEvent.click(screen.getByTestId("tiebreaker-lead_decision"));
  expect(state().table_tiebreakers).toEqual(["score_for", "head_to_head", "lead_decision"]);
  fireEvent.click(screen.getByTestId("head-to-head-score_for"));
  expect(state().head_to_head_criteria).toEqual(["points", "score_diff"]);
  fireEvent.click(screen.getByTestId("season-form-allow-draws"));
  fireEvent.change(screen.getByTestId("season-form-forfeit-score"), { target: { value: "best_of" } });
  fireEvent.change(screen.getByTestId("season-form-exit-rule"), { target: { value: "all_for_opponents" } });
  expect(state()).toMatchObject({ allow_draws: false, forfeit_score: "best_of", exit_rule: "all_for_opponents" });
});
