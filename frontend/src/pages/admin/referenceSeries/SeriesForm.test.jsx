import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Saison bearbeiten: eigene Teams als Liste (#1926) - das alte Feld wird das erste Team, weitere kommen dazu, jedes mit
// Schreibweisen. Nur erfundene Namen.

const apiMock = { post: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeriesForm } = await import("./SeriesForm");

const LINEAGE = { id: "spur-1", title: "Probe Rennliga", kind: "racing" };

beforeEach(() => {
  apiMock.patch.mockReset().mockResolvedValue({ data: {} });
  apiMock.post.mockReset().mockResolvedValue({ data: {} });
});

test("eine alte Saison zeigt ihr Team als erstes der Liste; weitere Teams mit Schreibweisen gehen mit", async () => {
  const onSaved = vi.fn();
  render(<SeriesForm series={{ id: "serie-1", season: "2026", status: "active", team_name: "Probe Löwen", rules: {} }} lineage={LINEAGE} onClose={() => {}} onSaved={onSaved} />);
  const list = screen.getByTestId("series-own-teams");
  expect(within(list).getAllByTestId("series-own-team-name").map((input) => input.value)).toEqual(["Probe Löwen"]);

  fireEvent.click(screen.getByTestId("series-own-team-add"));
  fireEvent.click(screen.getByTestId("series-own-team-add"));
  const names = within(list).getAllByTestId("series-own-team-name");
  fireEvent.change(names[1], { target: { value: "Probe-DarkFriday" } });
  fireEvent.change(within(list).getAllByTestId("series-own-team-aliases")[1], { target: { value: "PDF Racing, PDF" } });
  fireEvent.change(names[2], { target: { value: "Probe Löwen C" } });
  fireEvent.click(within(list).getAllByTestId("series-own-team-remove")[0]);
  expect(within(list).getAllByTestId("series-own-team-name").map((input) => input.value)).toEqual(["Probe-DarkFriday", "Probe Löwen C"]);

  fireEvent.click(screen.getByTestId("series-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/reference-series/admin/series/serie-1", expect.objectContaining({
    own_teams: [{ name: "Probe-DarkFriday", aliases: ["PDF Racing", "PDF"] }, { name: "Probe Löwen C", aliases: [] }],
  })));
  expect(onSaved).toHaveBeenCalled();
});

test("Saison abbrechen (#1960): Tag, Grund und Nachfolger; Teamwertung nach aktueller Besetzung; Mindestzahl", async () => {
  const lineage = { ...LINEAGE, series: [{ id: "serie-1", season: "2026", tier: "F2" }, { id: "serie-2", season: "2026", tier: "F2 Neustart" }, { id: "alt", season: "2025", status: "archived" }] };
  render(<SeriesForm series={{ id: "serie-1", season: "2026", tier: "F2", status: "active", rules: { team_scoring: { enabled: true } } }} lineage={lineage} onClose={() => {}} onSaved={() => {}} />);
  expect(screen.queryByTestId("series-cancel-reason")).toBeNull();
  fireEvent.change(screen.getByTestId("series-status"), { target: { value: "cancelled" } });
  fireEvent.change(screen.getByTestId("series-cancel-reason"), { target: { value: "Neustart mit anderem Auto" } });
  fireEvent.change(screen.getByTestId("series-cancelled-on"), { target: { value: "2026-11-20" } });
  expect(within(screen.getByTestId("series-successor")).getAllByRole("option").map((option) => option.textContent)).toEqual(["—", "2026 · F2 Neustart"]);
  fireEvent.change(screen.getByTestId("series-successor"), { target: { value: "serie-2" } });
  fireEvent.change(screen.getByTestId("series-rules-team-mode"), { target: { value: "current_lineup" } });
  fireEvent.change(screen.getByTestId("series-rules-min-participants"), { target: { value: "8" } });
  fireEvent.click(screen.getByTestId("series-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/reference-series/admin/series/serie-1", expect.objectContaining({
    status: "cancelled", cancelled_on: "2026-11-20", cancel_reason: "Neustart mit anderem Auto", successor_id: "serie-2",
    rules: expect.objectContaining({ min_participants: 8, team_scoring: expect.objectContaining({ enabled: true, mode: "current_lineup" }) }),
  })));
});

test("eine neue Saison lässt sich nicht als abgebrochen anlegen", () => {
  render(<SeriesForm series={null} lineage={LINEAGE} onClose={() => {}} onSaved={() => {}} />);
  expect(within(screen.getByTestId("series-status")).queryByRole("option", { name: "Abgebrochen" })).toBeNull();
});

test("das letzte Team entfernen lässt ein leeres Feld stehen", () => {
  render(<SeriesForm series={{ id: "serie-1", season: "2026", own_teams: [{ name: "Probe Löwen", aliases: [] }], rules: {} }} lineage={LINEAGE} onClose={() => {}} onSaved={() => {}} />);
  fireEvent.click(screen.getByTestId("series-own-team-remove"));
  expect(screen.getAllByTestId("series-own-team-name").map((input) => input.value)).toEqual([""]);
});
