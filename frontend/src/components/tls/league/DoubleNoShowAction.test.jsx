import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// „Beide nicht erschienen“ (E.1, #1625): der Knopf nur vor dem Spiel - wie der Server; befangen nur der Superadmin mit
// Grund für die Notausnahme, sonst der Satz statt des Knopfs (Codex zu E.1).
const apiMock = { post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { DoubleNoShowAction } = await import("./DoubleNoShowAction");

const base = { id: "m1", tournament_id: "t1", status: "scheduled", results: [] };
const URL = "/admin/leagues/staffeln/t1/matches/m1/double-no-show";

beforeEach(() => {
  for (const fn of [...Object.values(apiMock), ...Object.values(toastMock)]) fn.mockReset();
  apiMock.post.mockResolvedValue({ data: {} });
  apiMock.delete.mockResolvedValue({ data: {} });
});

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

test("befangen ohne Notausnahme: der Satz statt des Knopfs", () => {
  render(<DoubleNoShowAction match={base} conflict={{ kind: "involved", override: false }} />);
  expect(screen.getByTestId("match-double-no-show-own")).toHaveTextContent("Über dein eigenes Team entscheidet eine andere Person.");
  expect(screen.queryByTestId("match-double-no-show")).toBeNull();
});

test("befangener Superadmin: werten nur mit Grund für die Notausnahme, der mitgeht", async () => {
  render(<DoubleNoShowAction match={base} conflict={{ kind: "involved", override: true }} />);
  fireEvent.click(screen.getByTestId("match-double-no-show"));
  fireEvent.change(screen.getByTestId("match-double-no-show-text"), { target: { value: "Beide nicht in der Lobby" } });
  fireEvent.click(screen.getByTestId("match-double-no-show-save"));
  expect(apiMock.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("match-double-no-show-conflict-reason"), { target: { value: "Keine zweite Person erreichbar" } });
  fireEvent.click(screen.getByTestId("match-double-no-show-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(URL, { note: "Beide nicht in der Lobby", conflict_reason: "Keine zweite Person erreichbar" }));
});

test("befangener Superadmin: neu ansetzen schickt den Grund ebenso", async () => {
  render(<DoubleNoShowAction match={{ ...base, status: "forfeit", double_forfeit: true, results: [{ registration_id: "a" }] }}
    conflict={{ kind: "involved", override: true }} />);
  fireEvent.click(screen.getByTestId("match-double-no-show-undo"));
  fireEvent.change(screen.getByTestId("match-double-no-show-text"), { target: { value: "Neuer Termin" } });
  fireEvent.change(screen.getByTestId("match-double-no-show-conflict-reason"), { target: { value: "Keine zweite Person erreichbar" } });
  fireEvent.click(screen.getByTestId("match-double-no-show-save"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith(URL, { data: { reason: "Neuer Termin", conflict_reason: "Keine zweite Person erreichbar" } }));
});

test("ohne Befangenheit geht kein Grund der Notausnahme mit", async () => {
  render(<DoubleNoShowAction match={base} />);
  fireEvent.click(screen.getByTestId("match-double-no-show"));
  expect(screen.queryByTestId("match-double-no-show-conflict-reason")).toBeNull();
  fireEvent.change(screen.getByTestId("match-double-no-show-text"), { target: { value: "Beide nicht in der Lobby" } });
  fireEvent.click(screen.getByTestId("match-double-no-show-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(URL, { note: "Beide nicht in der Lobby" }));
});
