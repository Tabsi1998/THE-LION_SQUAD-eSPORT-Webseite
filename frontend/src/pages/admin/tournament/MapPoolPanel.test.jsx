import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Reiter „Maps“ im Turnier (#1616): Pool des Turniers und eigene Pools je Phase - nur erfundene Map-Namen.
const apiMock = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler"), resolveMediaUrl: (url) => url || "" }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { MapPoolPanel } = await import("./MapPoolPanel");
const { toast } = await import("sonner");

const GAME = { id: "g1", name: "Probe Shooter", modes: [{ mode: "snd", label: "Suchen & Zerstören" }] };
const LIBRARY = [{ id: "hafen", name: "Hafenkante", modes: ["snd"] }, { id: "nebel", name: "Nebelwerk", modes: ["snd"] }];
const POOL = { id: "p1", version: 1, origin: "tournament", stale: false, outdated_map_ids: [],
  modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: "nebel", name: "Nebelwerk" }] }] };

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.put.mockReset();
  apiMock.delete.mockReset();
  apiMock.get.mockResolvedValue({ data: { game: GAME, library: LIBRARY, tournament: POOL, stages: [
    { stage_id: "s1", name: "Gruppenphase", number: 1, pool: null },
    { stage_id: "s2", name: "Finale", number: 2, pool: { ...POOL, id: "p2", origin: "stage" } },
  ] } });
  apiMock.put.mockResolvedValue({ data: {} });
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
});

function renderPanel() {
  return render(<MemoryRouter><MapPoolPanel tournamentId="t1" /></MemoryRouter>);
}

test("zeigt den Pool des Turniers und je Phase, woher ihr Pool kommt", async () => {
  renderPanel();
  await screen.findByTestId("tournament-pool");
  expect(apiMock.get).toHaveBeenCalledWith("/map-pools/tournaments/t1/admin");
  expect(screen.getByTestId("stage-pool-row-s1")).toHaveTextContent("übernimmt den Pool des Turniers");
  expect(screen.getByTestId("stage-pool-row-s2")).toHaveTextContent("eigener Pool · Version 1");
});

test("speichert den Pool des Turniers und legt für eine Phase einen eigenen an", async () => {
  renderPanel();
  await screen.findByTestId("tournament-pool");
  fireEvent.click(screen.getByRole("checkbox", { name: "Hafenkante in Suchen & Zerstören" }));
  fireEvent.click(screen.getByTestId("tournament-pool-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/map-pools/tournaments/t1",
    { modes: [{ mode: "snd", map_ids: ["nebel", "hafen"] }], expected_version: 1 }));

  fireEvent.click(screen.getByTestId("stage-pool-edit-s1"));
  const copy = await screen.findByTestId("stage-pool-s1-copy");
  fireEvent.change(copy, { target: { value: "tournament" } });
  fireEvent.click(screen.getByTestId("stage-pool-s1-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/map-pools/tournaments/t1/stages/s1",
    { modes: [{ mode: "snd", map_ids: ["nebel"] }], expected_version: 0 }));
});

test("ein eigener Pool der Phase lässt sich entfernen – dann gilt wieder der des Turniers", async () => {
  renderPanel();
  await screen.findByTestId("tournament-pool");
  fireEvent.click(screen.getByTestId("stage-pool-edit-s2"));
  fireEvent.click(await screen.findByTestId("stage-pool-s2-clear"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/map-pools/tournaments/t1/stages/s2"));
});

// Gleichzeitig geändert (409): Hinweis zeigen und den aktuellen Stand neu laden, statt mit dem alten weiterzumachen.
test("ein Pool, den inzwischen jemand anderes geändert hat, wird mit Hinweis neu geladen", async () => {
  const detail = "Der Map-Pool wurde inzwischen geändert - bitte neu laden.";
  apiMock.put.mockRejectedValueOnce({ response: { status: 409, data: { detail } } });
  renderPanel();
  await screen.findByTestId("tournament-pool");
  expect(apiMock.get).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("checkbox", { name: "Hafenkante in Suchen & Zerstören" }));
  fireEvent.click(screen.getByTestId("tournament-pool-save"));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(detail));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
});
