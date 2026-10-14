import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Gewinne nach einer Korrektur (#1584): ein Gewinn, der nach einer Korrektur veröffentlichter Fast-Lap-Ergebnisse nicht
// mehr zur Rangfolge passt, wird nicht entzogen - er trägt den Vermerk „nach Korrektur prüfen“.

const apiMock = { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({
  api: apiMock,
  formatRequestError: (_err, fallback) => fallback,
  resolveMediaUrl: (value) => value || "",
}));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true, usePrompt: () => async () => "" }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const AdminPrizesPage = (await import("./AdminPrizesPage")).default;

const PRIZE = { id: "p-1", source_type: "fastlap", fastlap_challenge_title: "Hotlap", fastlap_source_label: "Spielberg", place: 1, prize_label: "1. Platz", prize_value: "Pokal", status: "picked_up", display_name: "Anna" };

test("ein Gewinn mit needs_review zeigt „Nach Korrektur prüfen“, andere nicht", async () => {
  apiMock.get.mockImplementation(async (url) => (String(url).startsWith("/prizes") ? { data: [PRIZE, { ...PRIZE, id: "p-2", needs_review: true, review_note: "Nach einer Korrektur der Ergebnisse nicht mehr auf diesem Platz - bitte prüfen." }] } : { data: [] }));
  render(<MemoryRouter><AdminPrizesPage /></MemoryRouter>);
  const flagged = await screen.findAllByTestId("prize-review-p-2");
  expect(flagged[0]).toHaveTextContent("Nach Korrektur prüfen");
  expect(screen.queryAllByTestId("prize-review-p-1")).toHaveLength(0);
});
