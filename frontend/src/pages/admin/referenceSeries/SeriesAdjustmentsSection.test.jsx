import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Anpassungen der Saison (#1960): Liste mit „−5“, Teilnehmer bzw. Team, Grund, Termin und Tag; anlegen (Grund und Tag
// Pflicht, echtes Minus geht), bearbeiten und entfernen - alles über den Server. Nur erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler", formatRequestError: () => "Fehler", resolveMediaUrl: (url) => url }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeriesAdjustmentsSection } = await import("./SeriesAdjustmentsSection");

const ADJUSTMENTS = [
  { id: "a1", kind: "participant", participant_id: "p1", team: null, points: -5, reason: "Nichtteilnahme nach Anmeldung", day: "2026-11-02", round_id: "r2" },
  { id: "a2", kind: "team", participant_id: null, team: "Probe Löwen", points: 2, reason: "Korrektur laut Veranstalter", day: "2026-11-03", round_id: null },
];
const SERIES = { id: "serie-1", adjustments: ADJUSTMENTS, own_teams: [{ name: "Probe Löwen" }] };

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  apiMock.get.mockImplementation(async (url) => (url.endsWith("/participants")
    ? { data: { participants: [{ id: "p1", name: "Probe Lion Eins", default_team: "Probe Löwen" }, { id: "p2", name: "Fremd Eins", default_team: "Fremd Rot" }] } }
    : { data: { rounds: [{ id: "r1", code: "R1", position: 1 }, { id: "r2", code: "R2", position: 2 }] } }));
  apiMock.post.mockResolvedValue({ data: { adjustments: [] } });
  apiMock.patch.mockResolvedValue({ data: { adjustments: [] } });
  apiMock.delete.mockResolvedValue({ data: { adjustments: [] } });
});

test("Liste: Punkte als Zeichen, für wen, Grund, Termin und Tag", async () => {
  render(<SeriesAdjustmentsSection series={SERIES} onChanged={vi.fn()} />);
  await waitFor(() => expect(screen.getAllByTestId("adjustment-row")[0]).toHaveTextContent("Probe Lion Eins"));
  const [first, second] = screen.getAllByTestId("adjustment-row");
  expect(first).toHaveTextContent("−5Probe Lion EinsFahrerNichtteilnahme nach Anmeldung · R2 · 02.11.2026");
  expect(second).toHaveTextContent("+2Probe LöwenTeamKorrektur laut Veranstalter · 03.11.2026");
});

test("Anlegen: Pflichtfelder, echtes Minus, Termin - dann rechnet der Server neu", async () => {
  const onChanged = vi.fn();
  render(<SeriesAdjustmentsSection series={{ ...SERIES, adjustments: [] }} onChanged={onChanged} />);
  expect(await screen.findByTestId("adjustments-empty")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("adjustment-new"));
  const sheet = await screen.findByTestId("adjustment-sheet");
  fireEvent.change(within(sheet).getByTestId("adjustment-reason"), { target: { value: "Probe" } });
  fireEvent.change(within(sheet).getByTestId("adjustment-points"), { target: { value: "0" } });
  fireEvent.click(screen.getByTestId("adjustment-save"));
  const errors = await screen.findByTestId("adjustment-errors");
  expect(errors).toHaveTextContent("Punkte als Zahl zwischen −1000 und 1000, nicht 0");
  expect(errors).toHaveTextContent("Teilnehmer fehlt.");
  expect(apiMock.post).not.toHaveBeenCalled();

  await waitFor(() => expect(within(sheet).getByTestId("adjustment-participant").querySelectorAll("option").length).toBe(3));
  fireEvent.change(within(sheet).getByTestId("adjustment-participant"), { target: { value: "p2" } });
  fireEvent.change(within(sheet).getByTestId("adjustment-points"), { target: { value: "−5" } });
  fireEvent.change(within(sheet).getByTestId("adjustment-reason"), { target: { value: "Video fehlt" } });
  fireEvent.change(within(sheet).getByTestId("adjustment-day"), { target: { value: "2026-11-04" } });
  fireEvent.change(within(sheet).getByTestId("adjustment-round"), { target: { value: "r1" } });
  fireEvent.click(screen.getByTestId("adjustment-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/adjustments", {
    kind: "participant", participant_id: "p2", team: null, points: -5, reason: "Video fehlt", day: "2026-11-04", round_id: "r1",
  }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});

test("Bearbeiten und Entfernen gehen an genau diese Anpassung", async () => {
  render(<SeriesAdjustmentsSection series={SERIES} onChanged={vi.fn()} />);
  await screen.findAllByTestId("adjustment-row");
  fireEvent.click(screen.getAllByTestId("adjustment-edit")[1]);
  const sheet = await screen.findByTestId("adjustment-sheet");
  expect(within(sheet).getByTestId("adjustment-team")).toHaveValue("Probe Löwen");
  fireEvent.change(within(sheet).getByTestId("adjustment-points"), { target: { value: "3" } });
  fireEvent.click(screen.getByTestId("adjustment-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/adjustments/a2", expect.objectContaining({ kind: "team", team: "Probe Löwen", points: 3 })));
  fireEvent.click(screen.getAllByTestId("adjustment-remove")[0]);
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/adjustments/a1"));
});
