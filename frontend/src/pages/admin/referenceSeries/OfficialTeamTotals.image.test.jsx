import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Teamwertung laut Veranstalter per Bild (#1999): „Bild auslesen“ liest die Team-Tabelle (Team und Punkte), gelbe Zeilen
// halten das Übernehmen auf, bis jemand sie ändert oder „Passt so“ drückt. Nur erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { OfficialTeamTotals } = await import("./OfficialTeamTotals");

const BASE = "/reference-series/admin/series/serie-1/season-table";
const RESULT = {
  kind: "teams", detected: "teams",
  columns: [{ label: "Pos.", kind: "rank" }, { label: "Team", kind: "name" }, { label: "Runde 1", kind: "round" }, { label: "Punkte", kind: "total" }],
  rows: [
    { cells: ["1", "Probe Rot", "50", "555"], uncertain: [], read: {}, notes: [] },
    { cells: ["2", "Probe Blau", "--", "543"], uncertain: [3], read: { 3: "548" }, notes: ["Summe der Runden 0 ≠ Punkte 543"] },
  ],
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.get.mockResolvedValue({ data: { available: true, max_mb: 8, formats: ["image/png"] } });
  apiMock.post.mockResolvedValue({ data: RESULT });
});

test("Bild auslesen füllt Team und Punkte, gelbe Zeilen bis „Passt so“", async () => {
  const onChange = vi.fn();
  const onOpenChange = vi.fn();
  const onImage = vi.fn();
  render(<OfficialTeamTotals totals={{}} onChange={onChange} imageBase={BASE} onOpenChange={onOpenChange} onImage={onImage} />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith(`${BASE}/image`));
  const file = new File([new Uint8Array([137, 80, 78, 71])], "teams.png", { type: "image/png" });
  fireEvent.change(await screen.findByTestId("result-team-totals-image-file"), { target: { files: [file] } });
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(`${BASE}/image?table=teams`, file, { headers: { "Content-Type": "image/png" } }));
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ "Probe Rot": 555, "Probe Blau": 543 }));
  // Das Bild geht als Original „Tabelle“ ans Blatt - angehängt wird erst beim Übernehmen (#1933).
  expect(onImage).toHaveBeenCalledWith(file);
  const rows = screen.getAllByTestId("result-team-total");
  expect(rows[1]).toHaveAttribute("data-ocr-uncertain", "true");
  expect(within(rows[1]).getByTestId("result-team-total-ocr")).toHaveTextContent("gelesen: 548");
  expect(within(rows[1]).getByTestId("result-team-total-hint")).toHaveTextContent("Summe der Runden 0 ≠ Punkte 543");
  expect(onOpenChange).toHaveBeenLastCalledWith(1);
  expect(screen.getByTestId("result-team-totals-open")).toHaveTextContent("Eine Zeile aus dem Bild ist gelb");
  fireEvent.click(within(rows[1]).getByTestId("result-team-total-confirm"));
  expect(onOpenChange).toHaveBeenLastCalledWith(0);
  expect(screen.queryByTestId("result-team-totals-open")).toBeNull();
});

test("ändern ist prüfen: die gelbe Markierung fällt weg; ohne Pfad gibt es keinen Knopf", async () => {
  const onOpenChange = vi.fn();
  const { unmount } = render(<OfficialTeamTotals totals={{}} onChange={vi.fn()} onOpenChange={onOpenChange}
    initialRows={[{ team: "Probe Blau", points: "543", ocr: { read: "548" } }]} />);
  expect(screen.queryByTestId("result-team-totals-image")).toBeNull();
  expect(apiMock.get).not.toHaveBeenCalled();
  expect(onOpenChange).toHaveBeenLastCalledWith(1);
  fireEvent.change(screen.getByTestId("result-team-total-points"), { target: { value: "548" } });
  expect(onOpenChange).toHaveBeenLastCalledWith(0);
  unmount();
});
