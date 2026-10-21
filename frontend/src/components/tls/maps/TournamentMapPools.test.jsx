import { render, screen, waitFor } from "@testing-library/react";

// Map-Pools auf der Turnierseite (#1616): der Pool des Turniers und eigene Pools von Phasen - ohne Pool nichts.
const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (url) => url || "" }));

const { TournamentMapPools } = await import("./TournamentMapPools");

const POOL = { id: "p1", origin: "tournament", modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: "nebel", name: "Nebelwerk" }] }] };

beforeEach(() => apiMock.get.mockReset());

test("zeigt den Pool des Turniers und den eigenen Pool des Finales", async () => {
  apiMock.get.mockResolvedValue({ data: { tournament: POOL, stages: [
    { stage_id: "s1", name: "Gruppen", pool: POOL },
    { stage_id: "s2", name: "Finale", pool: { ...POOL, id: "p2", origin: "stage", modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: "glut", name: "Glutsenke" }] }] } },
  ] } });
  render(<TournamentMapPools tournamentId="t1" />);
  await waitFor(() => expect(screen.getAllByTestId("map-pool")).toHaveLength(2));
  expect(apiMock.get).toHaveBeenCalledWith("/map-pools/tournaments/t1");
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Map-Pool", "Map-Pool · Finale"]);
  expect(screen.getByText("Glutsenke")).toBeInTheDocument();
});

test("ein Cup ohne Maps zeigt nichts – auch wenn der Abruf scheitert", async () => {
  apiMock.get.mockResolvedValueOnce({ data: { tournament: null, stages: [] } });
  const { container } = render(<TournamentMapPools tournamentId="t2" />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();

  apiMock.get.mockRejectedValueOnce(new Error("403"));
  const { container: failed } = render(<TournamentMapPools tournamentId="t3" />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  expect(failed).toBeEmptyDOMElement();
});
