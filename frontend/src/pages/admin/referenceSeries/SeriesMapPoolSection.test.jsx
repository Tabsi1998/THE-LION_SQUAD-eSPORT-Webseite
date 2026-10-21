import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Map-Pool der Saison (#1616): der Vorstand wählt aus der Bibliothek des Spiels der Spur, übernimmt bei Bedarf den
// Pool der Vorsaison. Ohne Spiel der Spur bleibt Freitext - nur erfundene Map-Namen.
const apiMock = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler"), resolveMediaUrl: (url) => url || "" }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeriesMapPoolSection } = await import("./SeriesMapPoolSection");
const { toast } = await import("sonner");

const GAME = { id: "g1", name: "Probe Shooter", modes: [{ mode: "snd", label: "Suchen & Zerstören" }] };
const LIBRARY = [{ id: "hafen", name: "Hafenkante", modes: ["snd"] }, { id: "nebel", name: "Nebelwerk", modes: ["snd"] }];
const PREVIOUS = { id: "alt", version: 4, origin: "reference_series", modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: "hafen", name: "Hafenkante" }] }] };

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.put.mockReset().mockResolvedValue({ data: {} });
});

test("übernimmt den Pool der Vorsaison und speichert ihn für diese Saison", async () => {
  apiMock.get.mockResolvedValue({ data: { game: GAME, library: LIBRARY, pool: null, previous: PREVIOUS } });
  render(<MemoryRouter><SeriesMapPoolSection series={{ id: "s1" }} /></MemoryRouter>);
  const copy = await screen.findByTestId("series-map-pool-copy");
  expect(apiMock.get).toHaveBeenCalledWith("/map-pools/reference-series/s1");
  fireEvent.change(copy, { target: { value: "previous" } });
  fireEvent.click(screen.getByTestId("series-map-pool-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/map-pools/reference-series/s1",
    { modes: [{ mode: "snd", map_ids: ["hafen"] }], expected_version: 0 }));
});

test("ohne Spiel der Spur sagt der Abschnitt, dass Freitext bleibt", async () => {
  apiMock.get.mockResolvedValue({ data: { game: null, library: [], pool: null, previous: null } });
  render(<MemoryRouter><SeriesMapPoolSection series={{ id: "s1" }} /></MemoryRouter>);
  expect(await screen.findByTestId("series-map-pool-no-game")).toHaveTextContent("Freitext");
});

test("hat inzwischen jemand anderes gespeichert (409), kommt der Hinweis und der neue Stand", async () => {
  const detail = "Der Map-Pool wurde inzwischen geändert - bitte neu laden.";
  apiMock.get.mockResolvedValue({ data: { game: GAME, library: LIBRARY, pool: null, previous: PREVIOUS } });
  apiMock.put.mockRejectedValueOnce({ response: { status: 409, data: { detail } } });
  render(<MemoryRouter><SeriesMapPoolSection series={{ id: "s1" }} /></MemoryRouter>);
  fireEvent.change(await screen.findByTestId("series-map-pool-copy"), { target: { value: "previous" } });
  fireEvent.click(screen.getByTestId("series-map-pool-save"));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(detail));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
});
