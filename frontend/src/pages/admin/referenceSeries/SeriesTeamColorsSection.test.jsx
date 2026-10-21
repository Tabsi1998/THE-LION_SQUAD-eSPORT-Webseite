import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Teamfarben der Saison (#1950): Teams mit Farbe und Vorschlag aus dem Ergebnis-Bild, Vorschläge übernehmen, leeren,
// speichern. Nur erfundene Namen.

const apiMock = { get: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler") }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeriesTeamColorsSection } = await import("./SeriesTeamColorsSection");

const URL = "/reference-series/admin/series/serie-1/team-colors";
const TEAMS = [
  { team: "Fremd Blau", color: null, suggestion: "#3b82f6", own: false },
  { team: "Fremd Rot", color: "#ef4444", suggestion: null, own: false },
  { team: "Probe Löwen", color: null, suggestion: null, own: true },
];

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.put.mockReset();
  apiMock.get.mockResolvedValue({ data: { teams: TEAMS } });
});

test("zeigt die Teams mit Farbe, Vorschlag und Vereins-Marke; Speichern erst nach einer Änderung", async () => {
  render(<SeriesTeamColorsSection series={{ id: "serie-1" }} />);
  const rows = await screen.findAllByTestId("series-colors-row");
  expect(apiMock.get).toHaveBeenCalledWith(URL);
  expect(rows).toHaveLength(3);
  expect(within(rows[1]).getByTestId("series-colors-hex")).toHaveValue("#ef4444");
  expect(within(rows[0]).getByTestId("series-colors-suggestion")).toBeInTheDocument();
  expect(within(rows[2]).getByText("Verein")).toBeInTheDocument();
  expect(screen.getByTestId("series-colors-save")).toBeDisabled();
});

test("Vorschläge übernehmen, eine Farbe leeren und speichern", async () => {
  apiMock.put.mockResolvedValue({ data: { teams: [{ ...TEAMS[0], color: "#3b82f6" }, { ...TEAMS[1], color: null }, TEAMS[2]] } });
  render(<SeriesTeamColorsSection series={{ id: "serie-1" }} />);
  fireEvent.click(await screen.findByTestId("series-colors-take-all"));
  const rows = screen.getAllByTestId("series-colors-row");
  expect(within(rows[0]).getByTestId("series-colors-hex")).toHaveValue("#3b82f6");
  fireEvent.click(within(rows[1]).getByTestId("series-colors-clear"));
  fireEvent.click(screen.getByTestId("series-colors-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith(URL, { colors: { "Fremd Blau": "#3b82f6", "Fremd Rot": null, "Probe Löwen": null } }));
  expect(toastMock.success).toHaveBeenCalledWith("Teamfarben gespeichert.");
});

test("ein falscher Farbwert hält das Speichern auf", async () => {
  render(<SeriesTeamColorsSection series={{ id: "serie-1" }} />);
  const rows = await screen.findAllByTestId("series-colors-row");
  fireEvent.change(within(rows[2]).getByTestId("series-colors-hex"), { target: { value: "gold" } });
  expect(screen.getByTestId("series-colors-save")).toBeDisabled();
  expect(screen.getByText("Farbe als #rrggbb, etwa #29b6e8.")).toBeInTheDocument();
});
