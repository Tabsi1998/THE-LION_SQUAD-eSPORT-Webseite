import { render, screen } from "@testing-library/react";

// Spieler-Sicht (#1556): „Du bist als Nächstes an Station 2 · ca. 18:40“ - auf der Turnierseite die eigenen Spiele,
// auf der Matchseite genau dieses Spiel.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
const live = { resources: null, options: null };
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (load, resources, options) => { Object.assign(live, { resources, options }); } }));
const { LiveQueueStatus } = await import("./LiveQueueStatus");

const NEXT = { match_id: "m1", state: "queued", position: 1, station_text: "Station 2 · Switch 2", forecast_at: "2026-10-31T17:40:00Z", delay_minutes: 11 };

beforeEach(() => { apiMock.get.mockReset(); });

test("Turnierseite: das eigene nächste Spiel aus /live-queue/me", async () => {
  apiMock.get.mockResolvedValue({ data: { applies: true, entries: [NEXT] } });
  render(<LiveQueueStatus tournamentId="t1" />);
  const box = await screen.findByTestId("live-queue-status");
  expect(apiMock.get).toHaveBeenCalledWith("/tournaments/t1/live-queue/me");
  expect(box).toHaveTextContent("Du bist als Nächstes an Station 2 · Switch 2");
  expect(box).toHaveTextContent("ca. 18:40 · +11 Min.");
  expect(box).toHaveAttribute("data-tone", "next");
});

test("Matchseite: dieses Spiel aus der öffentlichen Warteschlange; aufgerufen übernimmt die Aufruf-Karte", async () => {
  apiMock.get.mockResolvedValue({ data: { applies: true, matches: { m1: { ...NEXT, state: "running" } } } });
  const { unmount } = render(<LiveQueueStatus tournamentId="t1" matchId="m1" hideCalled />);
  expect(await screen.findByTestId("live-queue-status")).toHaveTextContent("Läuft an Station 2 · Switch 2");
  expect(apiMock.get).toHaveBeenCalledWith("/tournaments/t1/live-queue");
  unmount();

  apiMock.get.mockResolvedValue({ data: { applies: true, matches: { m1: { ...NEXT, state: "called" } } } });
  render(<LiveQueueStatus tournamentId="t1" matchId="m1" hideCalled />);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByTestId("live-queue-status")).toBeNull();
});

test("online, ohne Spiel oder bei einem Fehler: nichts", async () => {
  apiMock.get.mockResolvedValue({ data: { applies: false, entries: [] } });
  const { container } = render(<LiveQueueStatus tournamentId="t1" />);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(container).toBeEmptyDOMElement();
  apiMock.get.mockRejectedValue(new Error("offline"));
  const second = render(<LiveQueueStatus tournamentId="t1" />);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(second.container).toBeEmptyDOMElement();
});

// #1801: Die Warteschlange lädt nur bei Änderungen ihres Turniers nach - und, weil sich die Turniere eines Events
// Stationen teilen, bei denen der anderen Turniere desselben Events.
test("hört auf das eigene Turnier und sein Event", async () => {
  apiMock.get.mockResolvedValue({ data: { applies: true, entries: [NEXT] } });
  render(<LiveQueueStatus tournamentId="t1" eventId="e1" />);
  await screen.findByTestId("live-queue-status");
  expect(live.resources).toContain("stations");
  expect(live.options).toMatchObject({ tournamentId: "t1", eventId: "e1" });
});
