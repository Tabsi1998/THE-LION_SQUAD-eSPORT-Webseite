import { render, screen } from "@testing-library/react";

// „Beide nicht erschienen“ (E.1, #1625): der Knopf nur vor dem Spiel - wie der Server (Codex zu E.1).
vi.mock("@/lib/api", () => ({ api: { post: vi.fn(), delete: vi.fn() }, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { DoubleNoShowAction } = await import("./DoubleNoShowAction");

const base = { id: "m1", tournament_id: "t1", status: "scheduled", results: [] };

test.each([
  ["angesetzt", base, "match-double-no-show"],
  ["gewertet", { ...base, status: "forfeit", double_forfeit: true, results: [{ registration_id: "a" }] }, "match-double-no-show-undo"],
])("%s: der passende Knopf", (_label, match, testId) => {
  render(<DoubleNoShowAction match={match} />);
  expect(screen.getByTestId(testId)).toBeInTheDocument();
});

test.each([
  ["läuft", { ...base, status: "in_progress" }],
  ["wartet auf Ergebnis", { ...base, status: "waiting_result" }],
  ["begonnen", { ...base, started_at: "2026-11-20T19:00:00+00:00" }],
  ["mit Meldung", { ...base, reports: [{ registration_id: "a" }] }],
  ["Ergebnis bereit", { ...base, pending_result: { id: "h1" } }],
  ["mit Ergebnis", { ...base, status: "completed", results: [{ registration_id: "a", rank: 1 }] }],
])("%s: kein Knopf", (_label, match) => {
  const { container } = render(<DoubleNoShowAction match={match} />);
  expect(container).toBeEmptyDOMElement();
});
