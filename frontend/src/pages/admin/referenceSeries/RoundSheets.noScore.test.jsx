import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Termin ohne Wertung mit Grund (#1960): der Grund nimmt den Termin aus der Wertung und geht mit kurzem Text an den
// Server; „Zählt zur Wertung“ wieder an nimmt ihn zurück. Nur erfundene Namen.

const apiMock = { post: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { RoundSheet } = await import("./RoundSheets");

const SERIES = { id: "serie-1", default_time: "20:00" };
const LINEAGE = { title: "Probe Racing", kind: "racing" };
const ROUND = { id: "r3", code: "R3", club_day: "2026-11-15", time: "20:00", kind: "regular", counts: true, counts_manual: false, country_auto: true };

beforeEach(() => {
  apiMock.patch.mockReset().mockResolvedValue({ data: {} });
});

test("Grund „zu wenig Fahrer“ mit Text - ohne Wertung, unterschieden von abgesagt", async () => {
  render(<RoundSheet series={SERIES} lineage={LINEAGE} round={ROUND} rounds={[ROUND]} version={4} onClose={() => {}} onSaved={() => {}} />);
  expect(screen.queryByTestId("round-no-score-note")).toBeNull();
  fireEvent.change(screen.getByTestId("round-no-score"), { target: { value: "too_few" } });
  expect(screen.getByTestId("round-counts")).not.toBeChecked();
  fireEvent.change(screen.getByTestId("round-no-score-note"), { target: { value: "Nur zwei Fahrer am Start" } });
  fireEvent.click(screen.getByTestId("round-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  const body = apiMock.patch.mock.calls[0][1];
  expect(body).toMatchObject({ no_score_reason: "too_few", no_score_note: "Nur zwei Fahrer am Start", expected_version: 4 });
  expect(body).not.toHaveProperty("counts");
});

test("wieder werten nimmt den Grund zurück", async () => {
  const round = { ...ROUND, counts: false, counts_manual: true, no_score_reason: "outage", no_score_note: "Server weg" };
  render(<RoundSheet series={SERIES} lineage={LINEAGE} round={round} rounds={[round]} version={5} onClose={() => {}} onSaved={() => {}} />);
  expect(screen.getByTestId("round-no-score")).toHaveValue("outage");
  fireEvent.click(screen.getByTestId("round-counts"));
  expect(screen.getByTestId("round-no-score")).toHaveValue("");
  fireEvent.click(screen.getByTestId("round-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  expect(apiMock.patch.mock.calls[0][1]).toMatchObject({ counts: true, no_score_reason: null });
});
