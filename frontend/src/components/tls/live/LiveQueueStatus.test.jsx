import { act, render, screen } from "@testing-library/react";

// Spieler-Sicht (#1556): „Du bist als Nächstes an Station 2 · ca. 18:40“ - auf der Turnierseite die eigenen Spiele,
// auf der Matchseite genau dieses Spiel.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
const live = { resources: null, options: null };
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (load, resources, options) => { Object.assign(live, { resources, options, load }); } }));
const { LiveQueueStatus } = await import("./LiveQueueStatus");
const { QUEUE_STALE_MAX_MS, QUEUE_TIMEOUT_MS } = await import("@/lib/liveQueue");

const NEXT = { match_id: "m1", state: "queued", position: 1, station_text: "Station 2 · Switch 2", forecast_at: "2026-10-31T17:40:00Z", delay_minutes: 11 };

beforeEach(() => { apiMock.get.mockReset(); });

test("Turnierseite: das eigene nächste Spiel aus /live-queue/me", async () => {
  apiMock.get.mockResolvedValue({ data: { applies: true, entries: [NEXT] } });
  render(<LiveQueueStatus tournamentId="t1" />);
  const box = await screen.findByTestId("live-queue-status");
  expect(apiMock.get).toHaveBeenCalledWith("/tournaments/t1/live-queue/me", { timeout: QUEUE_TIMEOUT_MS });
  expect(box).toHaveTextContent("Du bist als Nächstes an Station 2 · Switch 2");
  expect(box).toHaveTextContent("ca. 18:40 · +11 Min.");
  expect(box).toHaveAttribute("data-tone", "next");
});

test("Matchseite: dieses Spiel aus der öffentlichen Warteschlange; aufgerufen übernimmt die Aufruf-Karte", async () => {
  apiMock.get.mockResolvedValue({ data: { applies: true, matches: { m1: { ...NEXT, state: "running" } } } });
  const { unmount } = render(<LiveQueueStatus tournamentId="t1" matchId="m1" hideCalled />);
  expect(await screen.findByTestId("live-queue-status")).toHaveTextContent("Läuft an Station 2 · Switch 2");
  expect(apiMock.get).toHaveBeenCalledWith("/tournaments/t1/live-queue", { timeout: QUEUE_TIMEOUT_MS });
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

// #2440: Ein gescheiterter Abruf (Netz, Server) lässt die Zeile stehen - nur 404/403 nimmt sie weg. Online kein Takt.
test("scheitert ein späterer Abruf, bleibt der letzte Stand; 404 nimmt ihn weg; online fragt nichts im Takt", async () => {
  apiMock.get.mockResolvedValue({ data: { applies: true, entries: [NEXT] } });
  render(<LiveQueueStatus tournamentId="t1" />);
  await screen.findByTestId("live-queue-status");
  expect(live.options).toMatchObject({ pollMs: 60000 });
  apiMock.get.mockRejectedValue(Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }));
  await act(async () => { await live.load(); });
  expect(screen.getByTestId("live-queue-status")).toHaveTextContent("Du bist als Nächstes an Station 2 · Switch 2");
  apiMock.get.mockRejectedValue(Object.assign(new Error("503"), { response: { status: 503 } }));
  await act(async () => { await live.load(); });
  expect(screen.getByTestId("live-queue-status")).toBeInTheDocument();
  apiMock.get.mockRejectedValue(Object.assign(new Error("404"), { response: { status: 404 } }));
  await act(async () => { await live.load(); });
  expect(screen.queryByTestId("live-queue-status")).toBeNull();
  expect(live.options).toMatchObject({ pollMs: 0, fallbackMs: 0 });
});

// #2440 (Review): Bei anhaltendem Serverfehler zeigt die Zeile „Letzter Stand vor X s“ - nach 3 Minuten ohne Erfolg fällt
// sie weg, damit kein falsches „Du bist dran“ stehen bleibt. Eine abgelaufene Sitzung (401 bei /me) nimmt sie sofort weg
// und beendet den Takt.
test("Serverfehler: Hinweis „Letzter Stand“, nach 3 Minuten ohne Erfolg weg", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  try {
    apiMock.get.mockResolvedValue({ data: { applies: true, entries: [NEXT] } });
    render(<LiveQueueStatus tournamentId="t1" />);
    await act(async () => {});
    expect(screen.getByTestId("live-queue-status")).toBeInTheDocument();
    expect(screen.queryByTestId("live-queue-status-stale")).toBeNull();
    apiMock.get.mockRejectedValue(Object.assign(new Error("503"), { response: { status: 503 } }));
    act(() => { vi.advanceTimersByTime(20000); });
    await act(async () => { await live.load(); });
    expect(screen.getByTestId("live-queue-status-stale")).toHaveTextContent("Letzter Stand vor 20 s");
    expect(screen.getByTestId("live-queue-status-stale-live")).toHaveTextContent("Verbindung gestört");
    act(() => { vi.advanceTimersByTime(QUEUE_STALE_MAX_MS - 20000 - 1000); });
    expect(screen.getByTestId("live-queue-status")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByTestId("live-queue-status")).toBeNull();
    // Gelingt es wieder, ist die Zeile zurück - ohne Hinweis.
    apiMock.get.mockResolvedValue({ data: { applies: true, entries: [NEXT] } });
    await act(async () => { await live.load(); });
    expect(screen.getByTestId("live-queue-status")).toBeInTheDocument();
    expect(screen.queryByTestId("live-queue-status-stale")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

// #2440 (Review): Scheitert schon der erste Abruf, fragt die Zeile im Takt weiter (mit wachsendem Abstand).
test("scheitert der erste Abruf, fragt die Zeile im Takt weiter; gelingt es, erscheint sie", async () => {
  apiMock.get.mockRejectedValue(Object.assign(new Error("503"), { response: { status: 503 } }));
  const { container } = render(<LiveQueueStatus tournamentId="t1" />);
  await act(async () => {});
  expect(container).toBeEmptyDOMElement();
  expect(live.options).toMatchObject({ pollMs: 60000, fallbackMs: 30000 });
  apiMock.get.mockResolvedValue({ data: { applies: true, entries: [NEXT] } });
  await act(async () => { await live.load(); });
  expect(screen.getByTestId("live-queue-status")).toBeInTheDocument();
});

test("abgelaufene Sitzung (401 bei /me): die Zeile fällt weg, der Takt endet", async () => {
  apiMock.get.mockResolvedValue({ data: { applies: true, entries: [NEXT] } });
  render(<LiveQueueStatus tournamentId="t1" />);
  await screen.findByTestId("live-queue-status");
  apiMock.get.mockRejectedValue(Object.assign(new Error("401"), { response: { status: 401 } }));
  await act(async () => { await live.load(); });
  expect(screen.queryByTestId("live-queue-status")).toBeNull();
  expect(live.options).toMatchObject({ pollMs: 0, fallbackMs: 0 });
});

test("Turniertag (#1169): ein eigenes aufgerufenes Spiel pausiert die Saison-Deko - die Matchseite fremder Spiele nicht", async () => {
  const { clearOwnMatches, ownMatchesPaused } = await import("@/seasons/matchPause");
  clearOwnMatches();
  apiMock.get.mockResolvedValue({ data: { applies: true, matches: { m1: { ...NEXT, state: "called" } } } });
  const { unmount } = render(<LiveQueueStatus tournamentId="t1" matchId="m1" />);
  await screen.findByTestId("live-queue-status");
  expect(ownMatchesPaused()).toBe(false);
  unmount();

  apiMock.get.mockResolvedValue({ data: { applies: true, entries: [{ ...NEXT, state: "called" }] } });
  render(<LiveQueueStatus tournamentId="t1" />);
  await screen.findByTestId("live-queue-status");
  expect(ownMatchesPaused()).toBe(true);
  clearOwnMatches();
});
