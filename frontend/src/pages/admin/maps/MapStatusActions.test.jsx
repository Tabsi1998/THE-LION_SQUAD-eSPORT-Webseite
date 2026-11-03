import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Zustand einer Map (#2207): deaktivieren und archivieren mit Rückfrage, die betroffene Seasons nennt. Erfundene Namen.
const apiMock = { get: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
let confirmAnswer = true;
const confirmMock = vi.fn(async () => confirmAnswer);
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));

const { MapStatusActions, statusQuestion } = await import("./MapStatusActions");

const MAP = { id: "m1", slug: "hafenkante", name: "Hafenkante", status: "active" };
const SEASONS = [{ season_id: "s1", season_name: "Season 1", league_name: "Probe-Liga", status: "active", status_text: "läuft" }];

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.patch.mockReset();
  confirmMock.mockClear();
  confirmAnswer = true;
  Object.values(toastMock).forEach((fn) => fn.mockReset());
  apiMock.get.mockResolvedValue({ data: { pools: 2, affected_seasons: SEASONS } });
  apiMock.patch.mockResolvedValue({ data: { ...MAP, status: "inactive", warning: "Steht noch im Pool." } });
});

test("deaktivieren fragt nach und nennt die Seasons, in deren Pool die Map steht", async () => {
  const changed = vi.fn();
  render(<MapStatusActions gameId="g1" item={MAP} onChanged={changed} />);

  fireEvent.click(screen.getByTestId("game-map-status-hafenkante"));

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1/maps/m1", { status: "inactive" }));
  expect(apiMock.get).toHaveBeenCalledWith("/games/g1/maps/m1/usage");
  expect(confirmMock.mock.calls[0][0].description).toContain("Probe-Liga Season 1 (läuft)");
  expect(toastMock.warning).toHaveBeenCalledWith("Steht noch im Pool.");
  expect(changed).toHaveBeenCalled();
});

test("abbrechen ändert nichts, aktivieren fragt nicht", async () => {
  confirmAnswer = false;
  const { rerender } = render(<MapStatusActions gameId="g1" item={MAP} />);
  fireEvent.click(screen.getByTestId("game-map-archive-hafenkante"));
  await waitFor(() => expect(confirmMock).toHaveBeenCalled());
  expect(apiMock.patch).not.toHaveBeenCalled();

  rerender(<MapStatusActions gameId="g1" item={{ ...MAP, status: "inactive" }} />);
  fireEvent.click(screen.getByTestId("game-map-status-hafenkante"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1/maps/m1", { status: "active" }));
  expect(confirmMock).toHaveBeenCalledTimes(1);
});

test("eine archivierte Map hat nur „zurückholen“", () => {
  render(<MapStatusActions gameId="g1" item={{ ...MAP, status: "archived" }} />);
  expect(screen.getByLabelText("Hafenkante zurückholen")).toBeInTheDocument();
  expect(screen.queryByTestId("game-map-status-hafenkante")).toBeNull();
});

test("ohne betroffene Season sagt die Rückfrage nur, was der Zustand heißt", () => {
  expect(statusQuestion(MAP, "inactive", [])).toBe("Inaktiv heißt: in keinen neuen Pool wählbar. Wo sie schon steht, bleibt sie gültig.");
});
