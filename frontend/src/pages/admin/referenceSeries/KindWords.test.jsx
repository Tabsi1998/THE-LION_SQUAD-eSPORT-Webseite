import { fireEvent, render, screen, within } from "@testing-library/react";

// Begriffe und Felder der Art (#2024) in Saisontabelle, Anpassungen und Teilnehmer: eine Turnierserie spricht von
// Spielern, kennt keine Teamwertung und keine Startnummer. Nur erfundene Namen.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler"), formatRequestError: () => "Fehler", resolveMediaUrl: (url) => url }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeasonTableSection } = await import("./SeasonTableSection");
const { SeriesAdjustmentsSection } = await import("./SeriesAdjustmentsSection");
const { ParticipantEditSheet } = await import("./ParticipantEditSheet");
const { SERIES_PROFILE } = await import("@/lib/seriesKinds.fixture");

const SERIES = { id: "serie-1", lineage: { title: "Probe TFT", kind: "series" }, rules: { points_mode: "scheme" }, profile: SERIES_PROFILE, adjustments: [
  { id: "a1", kind: "participant", participant_id: "p1", points: -5, reason: "Nicht erschienen", day: "2026-10-01" },
] };

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  apiMock.get.mockResolvedValue({ data: { participants: [{ id: "p1", name: "Probe Ada" }], rounds: [] } });
});

test("Saisontabelle einer Turnierserie: Beispiel mit Spielern und Turniertagen", () => {
  render(<SeasonTableSection series={SERIES} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByTestId("season-table-toggle"));
  expect(screen.getByTestId("season-table-text").getAttribute("placeholder")).toMatch(/^Pos\tSpieler\tT1/);
  expect(screen.getByTestId("season-table-text").parentElement).toHaveTextContent("Spieler (auch Name#TAG)");
});

test("Anpassungen einer Turnierserie: nur Teilnehmer, als „Spieler“ beschriftet", async () => {
  render(<SeriesAdjustmentsSection series={SERIES} onChanged={vi.fn()} />);
  expect(within(screen.getByTestId("adjustment-row")).getByText("Spieler")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("adjustment-new"));
  const options = within(await screen.findByTestId("adjustment-kind")).getAllByRole("option").map((option) => option.textContent);
  expect(options).toEqual(["Teilnehmer (Gesamtwertung)"]);
});

test("Teilnehmer einer Turnierserie: ohne Startnummer", () => {
  render(<ParticipantEditSheet series={SERIES} row={{ id: "p1", name: "Probe Ada", link: "external" }} onClose={() => {}} onSaved={() => {}} />);
  expect(screen.queryByTestId("participant-edit-number")).toBeNull();
  expect(screen.getByTestId("participant-edit-team")).toBeInTheDocument();
});
