import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Tabelle der Liga-Staffel in der Verwaltung (E.1, #1625): Gleichstand sehen, Reihenfolge mit Grund festlegen,
// Entscheid zurücknehmen; dazu die Tabellenregeln der Season als Formular.
const apiMock = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeasonTableLinks, StaffelTablePanel } = await import("./SeasonTablePanel");
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
  render(<StaffelTablePanel tournamentId="t1" label="Liga 1 · Staffel A" canDecide />);
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
  const { unmount } = render(<StaffelTablePanel tournamentId="t1" label="Liga 1 · Staffel A" canDecide />);
  fireEvent.click(await screen.findByTestId("season-decision-remove-d0"));
  const sheet = await screen.findByTestId("table-decision-remove-sheet");
  fireEvent.change(within(sheet).getByTestId("table-decision-remove-reason"), { target: { value: "Ergebnis korrigiert" } });
  fireEvent.click(within(sheet).getByTestId("table-decision-remove-save"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/leagues/staffeln/t1/table-decision/d0", { data: { reason: "Ergebnis korrigiert" } }));
  unmount();

  render(<StaffelTablePanel tournamentId="t1" label="Liga 1 · Staffel A" canDecide={false} />);
  await screen.findByTestId("season-tie-t1-1");
  expect(screen.queryByTestId("season-tie-decide-1")).toBeNull();
  expect(screen.queryByTestId("season-decision-remove-d0")).toBeNull();
});

test("befangen (eigenes Team): der Satz statt der Knöpfe - der Superadmin nur mit Grund für die Notausnahme", async () => {
  const own = { ...TABLE, superadmin: false, ties: [{ ...TABLE.ties[0], own_team: true }], decisions: [{ ...TABLE.decisions[0], own_team: true }] };
  apiMock.get.mockResolvedValue({ data: own });
  const { unmount } = render(<StaffelTablePanel tournamentId="t1" label="Liga 1 · Staffel A" canDecide />);
  expect(await screen.findByTestId("season-tie-own-1")).toHaveTextContent("Über dein eigenes Team entscheidet eine andere Person.");
  expect(screen.queryByTestId("season-tie-decide-1")).toBeNull();
  expect(screen.getByTestId("season-decision-own-d0")).toBeInTheDocument();
  expect(screen.queryByTestId("season-decision-remove-d0")).toBeNull();
  unmount();

  apiMock.get.mockResolvedValue({ data: { ...own, superadmin: true } });
  render(<StaffelTablePanel tournamentId="t1" label="Liga 1 · Staffel A" canDecide />);
  fireEvent.click(await screen.findByTestId("season-tie-decide-1"));
  const sheet = await screen.findByTestId("table-decision-sheet");
  fireEvent.change(within(sheet).getByTestId("table-decision-reason"), { target: { value: "Losentscheid vor Zeugen" } });
  fireEvent.click(within(sheet).getByTestId("table-decision-save"));
  expect(apiMock.put).not.toHaveBeenCalled();
  fireEvent.change(within(sheet).getByTestId("table-decision-conflict-reason"), { target: { value: "Keine zweite Person erreichbar" } });
  fireEvent.click(within(sheet).getByTestId("table-decision-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/staffeln/t1/table-decision",
    { registration_ids: ["r1", "r2"], reason: "Losentscheid vor Zeugen", conflict_reason: "Keine zweite Person erreichbar" }));

  fireEvent.click(await screen.findByTestId("season-decision-remove-d0"));
  const remove = await screen.findByTestId("table-decision-remove-sheet");
  fireEvent.change(within(remove).getByTestId("table-decision-remove-reason"), { target: { value: "Ergebnis korrigiert" } });
  fireEvent.change(within(remove).getByTestId("table-decision-remove-conflict-reason"), { target: { value: "Keine zweite Person erreichbar" } });
  fireEvent.click(within(remove).getByTestId("table-decision-remove-save"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/leagues/staffeln/t1/table-decision/d0",
    { data: { reason: "Ergebnis korrigiert", conflict_reason: "Keine zweite Person erreichbar" } }));
});

test("der Season-Reiter Tabelle führt je Staffel zur Staffel-Seite - ohne eigenen Entscheid (#2262, Nr. 190)", () => {
  render(<MemoryRouter><SeasonTableLinks divisions={DIVISIONS} /></MemoryRouter>);
  expect(screen.getByTestId("season-table-open-t1")).toHaveAttribute("href", "/admin/leagues/staffeln/t1#tabelle");
  expect(screen.getByTestId("season-table-open-t1")).toHaveTextContent("Liga 1 · Staffel A");
  // Vor dem Start gibt es noch keine Tabelle - kein Weg auf eine leere Seite.
  expect(screen.queryByTestId("season-table-open-t2")).toBeNull();
  expect(screen.getByTestId("season-table-none-t2")).toHaveTextContent("Liga 1 · Staffel B");
  expect(screen.getByTestId("season-table-none-t2")).toHaveTextContent("noch keine Tabelle");
  expect(screen.queryByTestId("season-tie-decide-1")).toBeNull();
  expect(apiMock.get).not.toHaveBeenCalled();
});

test("Tabelle der Staffel mit Zonen und PDF; ein Ladefehler zeigt sich mit „Nochmal versuchen“", async () => {
  const standings = [
    { registration_id: "r1", rank: 1, display_name: "Nordlicht", points: 9, played: 3, won: 3, lost: 0, zone: "promotion" },
    { registration_id: "r2", rank: 2, display_name: "Sturmfalke", points: 3, played: 3, won: 1, lost: 2, zone: "relegation" },
  ];
  apiMock.get.mockResolvedValue({ data: { ...TABLE, standings } });
  const { unmount } = render(<StaffelTablePanel tournamentId="t1" label="Liga 1 · Staffel A" pdfHref="/api/exports/tournaments/t1/standings.pdf" />);
  expect(await screen.findByTestId("standing-row-r1")).toHaveTextContent("Nordlicht");
  expect(screen.getByTestId("standing-zone-r1")).toBeInTheDocument();
  expect(screen.getByTestId("staffel-table-zones")).toBeInTheDocument();
  // Lange Namen: eigener Rahmen zum Wischen, der volle Name im title - öffentliche Tabellen tragen keinen.
  expect(screen.getByTestId("staffel-standings")).toContainElement(screen.getByTestId("standing-row-r1"));
  expect(within(screen.getByTestId("standing-row-r1")).getByText("Nordlicht")).toHaveAttribute("title", "Nordlicht");
  expect(screen.getByTestId("staffel-pdf-standings")).toHaveAttribute("href", "/api/exports/tournaments/t1/standings.pdf");
  unmount();

  apiMock.get.mockRejectedValueOnce({ response: { data: { detail: "Server weg" } } });
  render(<StaffelTablePanel tournamentId="t1" />);
  expect(await screen.findByTestId("staffel-table-error")).toHaveTextContent("Server weg");
  apiMock.get.mockResolvedValue({ data: TABLE });
  fireEvent.click(screen.getByRole("button", { name: "Nochmal versuchen" }));
  expect(await screen.findByTestId("season-ties-t1")).toBeInTheDocument();
});

test("abgeschlossene Staffel: statt der Knöpfe der Satz zum Wiederöffnen (#2262)", async () => {
  apiMock.get.mockResolvedValue({ data: { ...TABLE, closed: true } });
  render(<StaffelTablePanel tournamentId="t1" label="Liga 1 · Staffel A" canDecide />);
  expect(await screen.findByTestId("season-tie-t1-1")).toBeInTheDocument();
  expect(screen.getByTestId("staffel-ties-closed")).toHaveTextContent("erst nach dem Wiederöffnen");
  expect(screen.queryByTestId("season-tie-decide-1")).toBeNull();
  expect(screen.queryByTestId("season-decision-remove-d0")).toBeNull();
});

test("Meister-Gleichstand auf der Staffel-Seite: markiert, Art der Entscheidung Pflicht (#2262)", async () => {
  const methods = { playoff: "Entscheidungsspiel", lot: "Los", lead: "Entscheid der Leitung" };
  apiMock.get.mockResolvedValue({ data: { ...TABLE, methods, decisions: [],
    ties: [{ ...TABLE.ties[0], kind: "champion", method_required: true }, { rank: 3, registration_ids: ["r3", "r4"], names: ["Eisbär", "Wüstenfuchs"], points: 0, kind: "zone", method_required: false }] } });
  render(<StaffelTablePanel tournamentId="t1" label="Liga 1 · Staffel A" canDecide />);
  expect(await screen.findByTestId("season-tie-kind-t1-1")).toHaveTextContent("Meisterplatz");
  expect(screen.getByTestId("season-tie-kind-t1-3")).toHaveTextContent("Grenze zu Auf- oder Abstieg");

  fireEvent.click(screen.getByTestId("season-tie-decide-1"));
  const sheet = await screen.findByTestId("table-decision-sheet");
  expect(within(sheet).getByTestId("table-decision-method")).toBeRequired();
  expect(sheet).toHaveTextContent("Bitte wählen");
  fireEvent.change(within(sheet).getByTestId("table-decision-reason"), { target: { value: "Entscheidungsspiel 2:1 gewonnen" } });
  fireEvent.click(within(sheet).getByTestId("table-decision-save"));
  expect(apiMock.put).not.toHaveBeenCalled();
  fireEvent.change(within(sheet).getByTestId("table-decision-method"), { target: { value: "playoff" } });
  fireEvent.click(within(sheet).getByTestId("table-decision-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/staffeln/t1/table-decision",
    { registration_ids: ["r1", "r2"], reason: "Entscheidungsspiel 2:1 gewonnen", method: "playoff" }));
});

test("Gleichstand an der Zonengrenze: markiert, Art freiwillig", async () => {
  apiMock.get.mockResolvedValue({ data: { ...TABLE, decisions: [], methods: { playoff: "Entscheidungsspiel", lot: "Los", lead: "Entscheid der Leitung" },
    ties: [{ ...TABLE.ties[0], kind: "zone", method_required: false }] } });
  render(<StaffelTablePanel tournamentId="t1" canDecide />);
  fireEvent.click(await screen.findByTestId("season-tie-decide-1"));
  const sheet = await screen.findByTestId("table-decision-sheet");
  expect(within(sheet).getByTestId("table-decision-method")).not.toBeRequired();
  expect(sheet).toHaveTextContent("Keine Angabe");
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

test("Art der Entscheidung (F.1): im Reiter Tabelle freiwillig - gewählt geht sie mit", async () => {
  render(<StaffelTablePanel tournamentId="t1" label="Liga 1 · Staffel A" canDecide />);
  fireEvent.click(await screen.findByTestId("season-tie-decide-1"));
  const sheet = await screen.findByTestId("table-decision-sheet");
  expect(within(sheet).getByTestId("table-decision-method")).toHaveValue("");
  expect(sheet).toHaveTextContent("Keine Angabe");
  fireEvent.change(within(sheet).getByTestId("table-decision-method"), { target: { value: "lot" } });
  fireEvent.change(within(sheet).getByTestId("table-decision-reason"), { target: { value: "Losentscheid vor beiden Captains" } });
  fireEvent.click(within(sheet).getByTestId("table-decision-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/staffeln/t1/table-decision",
    { registration_ids: ["r1", "r2"], reason: "Losentscheid vor beiden Captains", method: "lot" }));
});
