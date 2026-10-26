import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Ergebnisblatt nach Art-Profil (#2024): eine Turnierserie hat keinen Ort im Kopf, unter „Mehr“ nur Strafpunkte und
// Gesamt, die Marken DNS, DSQ und „Ausgestiegen“, immer den Turniertag-Modus und Double Up aus der Saison; ein
// Turniertag ohne Datum fragt beim Veröffentlichen nach dem Tag (Vorschlag heute). Nur erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler") }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/vienna", async (original) => ({ ...(await original()), viennaDay: () => "2026-11-05" }));

const { ResultEntrySheet } = await import("./ResultEntrySheet");
const { SERIES_PROFILE } = await import("@/lib/seriesKinds.fixture");

const SERIES = { id: "serie-1", lineage: { title: "Probe Masters", kind: "series" }, access: { role: "board", can_publish: true } };
const OPEN_ROUND = { id: "t4", code: "T4", club_day: null, time: "19:00", venue: "Altort", country_code: "AT" };
const RULES = { points_mode: "scheme", points_by_place: [35, 30, 26], day_rounds: { count: 0, points_by_place: [8, 7, 6] }, double_up: true };
const PREVIEW = { version: 0, target: "sheet", can_save: true, errors: [], warnings: [], rows: [], unknown_names: [], standings: null, final: null, latest: null };

function load(round = OPEN_ROUND) {
  apiMock.get.mockResolvedValue({ data: {
    round, series: { id: "serie-1", kind: "series", rules: RULES, profile: SERIES_PROFILE },
    access: { role: "board", can_publish: true }, version: 0, sheet: null, target: "sheet", participants: [],
  } });
}

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  apiMock.post.mockResolvedValue({ data: PREVIEW });
  apiMock.put.mockResolvedValue({ data: { target: "sheet", version: 1, created_participants: [] } });
});

test("Turnierserie: kein Ort, nur Strafpunkte und Gesamt, Marken ohne F1, Turniertag immer, Double Up aus der Saison", async () => {
  load();
  render(<ResultEntrySheet series={SERIES} round={OPEN_ROUND} onClose={() => {}} onSaved={() => {}} />);
  const sheet = await screen.findByTestId("result-sheet");
  expect(within(sheet).getByTestId("result-round")).not.toHaveTextContent("Altort");
  // Turniertag-Modus auch ohne Runden-Vorgabe: GES P je Zeile.
  expect(within(sheet).getByTestId("result-row-day-points")).toBeInTheDocument();
  expect(within(sheet).getByTestId("result-double-up-toggle")).toBeChecked();
  const row = within(sheet).getByTestId("result-row");
  fireEvent.click(within(row).getByTestId("result-row-more"));
  expect(within(row).getByTestId("result-row-penalty")).toBeInTheDocument();
  expect(within(row).getByTestId("result-row-total")).toBeInTheDocument();
  for (const id of ["result-row-start", "result-row-grid", "result-row-time", "result-row-gap", "result-row-penalty-seconds", "result-row-mark-fastest_lap", "result-row-mark-pole", "result-row-mark-dnf"]) {
    expect(within(row).queryByTestId(id)).toBeNull();
  }
  expect(within(row).getByTestId("result-row-mark-left")).toBeInTheDocument();
});

test("Turniertag ohne Datum: beim Veröffentlichen der Tag, Vorschlag heute", async () => {
  load();
  render(<ResultEntrySheet series={SERIES} round={OPEN_ROUND} onClose={() => {}} onSaved={() => {}} />);
  const sheet = await screen.findByTestId("result-sheet");
  const day = within(sheet).getByTestId("result-round-day");
  expect(day).toHaveValue("2026-11-05");
  fireEvent.change(day, { target: { value: "2026-11-04" } });
  fireEvent.change(within(sheet).getByTestId("result-row-name"), { target: { value: "Probe Ada" } });
  fireEvent.click(within(sheet).getByTestId("result-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  fireEvent.click(await within(sheet).findByText("Veröffentlichen"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds/t4/results", expect.objectContaining({
    status: "published", round_day: "2026-11-04",
  })));
});

test("Vorschau einer Turnierserie: „Spieler“ und „Turniertag 4“", async () => {
  const { ResultPreview } = await import("./ResultPreview");
  const preview = { standings: { round_seq: 4, scopes: { drivers: [{ participant_id: "p1", name: "Probe Ada", rank: 1, points: 35 }] } }, unknown_names: [] };
  render(<ResultPreview preview={preview} general={[]} board profile={SERIES_PROFILE} />);
  expect(screen.getByTestId("result-preview")).toHaveTextContent("Stand nach diesem Termin (Turniertag 4)");
  expect(screen.getByTestId("preview-standings-drivers")).toHaveTextContent("Spieler");
  expect(screen.getByTestId("preview-standings-drivers")).not.toHaveTextContent("Fahrer");
});

test("ein Termin mit Datum fragt nicht nach dem Tag", async () => {
  load({ ...OPEN_ROUND, club_day: "2026-10-30" });
  render(<ResultEntrySheet series={SERIES} round={OPEN_ROUND} onClose={() => {}} onSaved={() => {}} />);
  await screen.findByTestId("result-sheet");
  await screen.findByTestId("result-rows");
  expect(screen.queryByTestId("result-round-day")).toBeNull();
});
