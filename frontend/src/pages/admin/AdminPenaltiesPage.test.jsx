import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Strafenliste (#2130): jede Zeile führt in die Verwaltung; Strafzeit und ungültige Runde lassen sich zurücknehmen,
// nach der Veröffentlichung nur mit Begründung. Erfundene Daten.

const apiMock = { get: vi.fn(), patch: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
const confirmMock = vi.fn(async () => true);
const promptMock = vi.fn(async () => "");
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_error, fallback) => fallback }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock, usePrompt: () => promptMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { default: AdminPenaltiesPage } = await import("./AdminPenaltiesPage");

const LAP = { ref_id: "lap-1", kind: "lap_penalty", label: "+5s Strafzeit", reason: "Abkürzung", issued_by_name: "Leitung", context_title: "Fast Lap", admin_url: "/admin/f1/c-1?track=t-1", results_locked: false };
const FORFEIT = { ref_id: "m-1", kind: "match_forfeit", label: "Kampflos verloren", reason: "Nicht erschienen", issued_by_name: "Leitung", context_title: "Cup", admin_url: "/admin/tournaments/t-9" };

function renderPage(items) {
  apiMock.get.mockResolvedValue({ data: { count: items.length, counts: { all: items.length }, items } });
  return render(<MemoryRouter><AdminPenaltiesPage /></MemoryRouter>);
}

beforeEach(() => {
  apiMock.patch.mockReset();
  apiMock.patch.mockResolvedValue({ data: {} });
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
  promptMock.mockReset();
  promptMock.mockResolvedValue("");
});

test("jede Zeile führt in die Verwaltung; Zurücknehmen nur bei Fast-Lap-Strafen", async () => {
  renderPage([LAP, FORFEIT]);
  expect(await screen.findByTestId("pen-open-lap-1")).toHaveAttribute("href", "/admin/f1/c-1?track=t-1");
  expect(screen.getByTestId("pen-open-m-1")).toHaveAttribute("href", "/admin/tournaments/t-9");
  expect(screen.getByTestId("pen-take-back-lap-1")).toBeInTheDocument();
  expect(screen.queryByTestId("pen-take-back-m-1")).toBeNull();
});

test("Zurücknehmen fragt nach, nimmt Strafe und „ungültig“ weg und lädt neu", async () => {
  renderPage([LAP]);
  fireEvent.click(await screen.findByTestId("pen-take-back-lap-1"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/f1/times/lap-1", { penalty_seconds: 0, is_invalid: false }));
  expect(confirmMock).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(apiMock.get.mock.calls.length).toBeGreaterThanOrEqual(2));
});

test("Abbrechen ändert nichts", async () => {
  confirmMock.mockResolvedValue(false);
  renderPage([LAP]);
  fireEvent.click(await screen.findByTestId("pen-take-back-lap-1"));
  await waitFor(() => expect(confirmMock).toHaveBeenCalled());
  expect(apiMock.patch).not.toHaveBeenCalled();
});

test("nach der Veröffentlichung nur mit Begründung; ohne Text passiert nichts", async () => {
  renderPage([{ ...LAP, results_locked: true }]);
  fireEvent.click(await screen.findByTestId("pen-take-back-lap-1"));
  await waitFor(() => expect(promptMock).toHaveBeenCalledTimes(1));
  expect(apiMock.patch).not.toHaveBeenCalled();
  promptMock.mockResolvedValueOnce("Video zeigt: Runde war sauber");
  fireEvent.click(screen.getByTestId("pen-take-back-lap-1"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/f1/times/lap-1", { penalty_seconds: 0, is_invalid: false, change_reason: "Video zeigt: Runde war sauber" }));
});
