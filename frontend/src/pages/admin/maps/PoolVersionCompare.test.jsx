import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Zwei Versionen eines Map-Pools vergleichen (#2207). Erfundene Maps.
const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));

const { PoolVersionCompare } = await import("./PoolVersionCompare");

const VERSIONS = [
  { id: "v3", version: 3, saved_at: "2026-11-02T10:00:00+00:00", maps: 4, cleared: false },
  { id: "v2", version: 2, saved_at: "2026-11-01T10:00:00+00:00", maps: 3, cleared: false },
];
const DIFF = { same: false, modes: [{ mode: "stellung", label: "Stellung", added: [{ map_id: "g", name: "Glutsenke" }], removed: [{ map_id: "h", name: "Hafenkante" }], kept: 1, status: "changed" }] };

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.get.mockImplementation(async (url) => ({ data: url.endsWith("/versions") ? { versions: VERSIONS } : DIFF }));
});

test("vergleicht die beiden neuesten Versionen je Modus", async () => {
  render(<PoolVersionCompare baseUrl="/admin/leagues/seasons/s1/map-pool" version={3} />);

  await waitFor(() => expect(screen.getByTestId("pool-compare-base")).toHaveValue("2"));
  expect(screen.getByTestId("pool-compare-target")).toHaveValue("3");
  fireEvent.click(screen.getByTestId("pool-compare-run"));

  const row = await screen.findByTestId("pool-compare-mode-stellung");
  expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/seasons/s1/map-pool/compare", { params: { base: "2", target: "3" } });
  expect(row).toHaveTextContent("geändert · 1 geblieben");
  expect(row).toHaveTextContent("Hinzu: Glutsenke");
  expect(row).toHaveTextContent("Weg: Hafenkante");
});

test("mit nur einer Version gibt es nichts zu vergleichen", async () => {
  apiMock.get.mockResolvedValue({ data: { versions: VERSIONS.slice(0, 1) } });
  const { container } = render(<PoolVersionCompare baseUrl="/x" version={1} />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});
