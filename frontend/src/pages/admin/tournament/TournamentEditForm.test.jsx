import { fireEvent, render, screen } from "@testing-library/react";

// Turnier bearbeiten (#1938): „Planung prüfen“ warnt bei widersprüchlichen Zeiten - wie beim Anlegen. Gespeichert wird
// trotzdem; die Warnung sagt nur, was nicht zusammenpasst.

const apiMock = { get: vi.fn(() => Promise.resolve({ data: [] })), patch: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (e, f) => f || String(e), formatRequestError: (_e, f) => f, resolveMediaUrl: (u) => u }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ can: () => false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true, usePrompt: () => async () => null }));

const { TournamentEditForm } = await import("./TournamentEditForm");

const BASE = { id: "t-1", title: "Probe-Cup", status: "check_in", format: "single_elim", team_mode: "solo", start_date: "2026-10-31T17:00:00+00:00" };

test("Check-in endet vor seiner Öffnung: die Warnung steht bei den Zeiten", async () => {
  render(<TournamentEditForm tournament={{ ...BASE, check_in_from: "2026-10-31T16:50:00+00:00", check_in_until: "2026-10-31T16:30:00+00:00" }} onSaved={() => {}} />);
  expect(await screen.findByTestId("tr-edit-planning-warnings")).toHaveTextContent("Der Check-in endet vor seiner Öffnung.");
});

test("stimmige Zeiten: keine Warnung - sie erscheint, sobald das Ende vor den Beginn rutscht", async () => {
  render(<TournamentEditForm tournament={{ ...BASE, check_in_from: "2026-10-31T16:00:00+00:00", check_in_until: "2026-10-31T16:45:00+00:00" }} onSaved={() => {}} />);
  const until = await screen.findByTestId("tr-edit-checkin-until");
  expect(screen.queryByTestId("tr-edit-planning-warnings")).toBeNull();
  fireEvent.change(until, { target: { value: "2026-10-31T19:30" } });
  expect(screen.getByTestId("tr-edit-planning-warnings")).toHaveTextContent("Der Check-in endet nach dem Turnierstart.");
});
