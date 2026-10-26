import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Saison bearbeiten: eigene Teams als Liste (#1926) - das alte Feld wird das erste Team, weitere kommen dazu, jedes mit
// Schreibweisen. Nur erfundene Namen.

const apiMock = { post: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeriesForm } = await import("./SeriesForm");
const { RACING_PROFILE, SERIES_PROFILE } = await import("@/lib/seriesKinds.fixture");

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

const TFT_LINEAGE = { id: "spur-2", title: "Probe TFT", kind: "series" };
const TFT_RULES = { points_mode: "scheme", points_by_place: [35, 30, 26], tiebreakers: ["wins", "top_n", "countback"], tiebreak_top_n: 4,
  day_rounds: { count: 5, points_by_place: [8, 7, 6, 5, 4, 3, 2, 1] }, double_up: false, double_up_points: "best_player_place",
  team_scoring: { enabled: false } };
const SCHEMES = [
  { id: "organizer", name: "Punkte laut Veranstalter", kinds: ["series", "racing", "team_league"], rules: { points_mode: "organizer" } },
  { id: "formula_1", name: "Formel 1", kinds: ["racing"], rules: { points_by_place: [25, 18, 15] } },
  { id: "tft", name: "TFT-Turniertag", kinds: ["series"], rules: TFT_RULES },
];

test("Art-Profil (#2024): eine neue Turnierserie startet mit der TFT-Vorlage, ohne F1-Boni und Teamwertung, mit Double Up", async () => {
  const profile = { ...SERIES_PROFILE, default_rules: TFT_RULES };
  render(<SeriesForm series={null} lineage={TFT_LINEAGE} schemes={SCHEMES} defaultRules={{ points_by_place: [25, 18] }} profile={profile} onClose={() => {}} onSaved={() => {}} />);
  expect(screen.getByTestId("series-scheme")).toHaveValue("tft");
  expect(within(screen.getByTestId("series-scheme")).getAllByRole("option").map((option) => option.value)).toEqual(["", "organizer", "tft"]);
  expect(screen.getByTestId("series-rules-day-rounds")).toHaveValue(5);
  expect(screen.queryByTestId("series-rules-fastest-lap")).toBeNull();
  expect(screen.queryByTestId("series-rules-dnf")).toBeNull();
  expect(screen.queryByTestId("series-rules-team-section")).toBeNull();
  expect(screen.getByTestId("series-rules-double-up-section")).toHaveTextContent("Double Up");
  expect(screen.getByTestId("series-planned-rounds").closest("[data-testid='series-dates']")).toHaveTextContent("Geplante Turniertage");
  fireEvent.click(screen.getByTestId("series-rules-double-up-on"));
  fireEvent.change(screen.getByTestId("series-season"), { target: { value: "2026" } });
  fireEvent.click(screen.getByTestId("series-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series", expect.objectContaining({
    points_scheme_id: "tft", rules: expect.objectContaining({ double_up: true, day_rounds: { count: 5, points_by_place: [8, 7, 6, 5, 4, 3, 2, 1] } }),
  })));
});

test("Art-Profil (#2024): die Rennliga behält Boni, Ausfall und Teamwertung, aber keine Namen ohne Tag", () => {
  render(<SeriesForm series={{ id: "serie-1", season: "2026", rules: {} }} lineage={LINEAGE} profile={RACING_PROFILE} onClose={() => {}} onSaved={() => {}} />);
  expect(screen.getByTestId("series-rules-fastest-lap")).toBeInTheDocument();
  expect(screen.getByTestId("series-rules-team-section")).toBeInTheDocument();
  expect(screen.queryByTestId("series-rules-double-up-section")).toBeNull();
  expect(screen.queryByTestId("series-hide-tags")).toBeNull();
});

test("das letzte Team entfernen lässt ein leeres Feld stehen", () => {
  render(<SeriesForm series={{ id: "serie-1", season: "2026", own_teams: [{ name: "Probe Löwen", aliases: [] }], rules: {} }} lineage={LINEAGE} onClose={() => {}} onSaved={() => {}} />);
  fireEvent.click(screen.getByTestId("series-own-team-remove"));
  expect(screen.getAllByTestId("series-own-team-name").map((input) => input.value)).toEqual([""]);
});
