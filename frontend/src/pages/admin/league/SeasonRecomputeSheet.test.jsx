import { render, screen } from "@testing-library/react";

// „Übernahme neu berechnen“ (#1627, docs/LIGA.md „F.2a“): Ein Abgemeldeter, den die Korrektur zum Aufsteiger macht, gibt den
// Aufstiegsplatz frei - die Vorschau sagt das in Klartext. Nur erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeasonRecomputeSheet } = await import("./SeasonRecomputeSheet");

test("ein frei gewordener Aufstiegsplatz steht als „Platz frei“ in der Vorschau", async () => {
  apiMock.get.mockResolvedValue({ data: {
    can_run: true, problems: [], stamp: "abc", predecessor: { id: "s1", name: "Season 1" }, manual: [], unchanged: 6,
    changes: [{ kind: "place", application_id: "a2", squad_id: "q2", display_name: "Rudel Zwei · Eins", from_label: "Liga 2", to_label: "Liga 1" }],
  } });
  render(<SeasonRecomputeSheet season={{ id: "s2", name: "Season 2" }} onClose={() => {}} onDone={() => {}} />);
  const row = await screen.findByTestId("recompute-change-q2");
  expect(row).toHaveTextContent("Platz frei");
  expect(row).toHaveTextContent("abgemeldet – der Platz in Liga 1 ist frei");
});
