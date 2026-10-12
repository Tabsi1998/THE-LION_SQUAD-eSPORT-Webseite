import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// „Live“ ist ein Reiter der Event-Seite (#1183): die alte Adresse /events/<slug>/live führt dorthin, der Zugangslink
// bleibt dran. Der Reiter zeigt, was läuft und als Nächstes kommt - aus den Bäumen und Stationen des Events.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));

const { default: EventLivePage, EventLiveBoard } = await import("./EventLivePage");

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-20T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

test("alte Live-Adresse führt auf den Reiter „Live“ der Event-Seite - mit Zugangslink", async () => {
  render(
    <MemoryRouter initialEntries={["/events/gamers-fest/live?access=abc"]}>
      <Routes>
        <Route path="/events/:slug/live" element={<EventLivePage />} />
        <Route path="/events/:slug" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByTestId("where")).toHaveTextContent("/events/gamers-fest?tab=live&access=abc");
  expect(apiMock.get).not.toHaveBeenCalled();
});

test("der Reiter zeigt laufende Spiele und die Turniere des Events", async () => {
  const event = {
    id: "e1", slug: "gamers-fest", name: "Gamers Fest", status: "live", start_date: "2026-06-20T08:00:00Z", end_date: "2026-06-21T18:00:00Z",
    tournaments: [{ id: "t1", slug: "cup", title: "Sommer-Cup", status: "live", public_phase: { state: "live", label: "Läuft" } }], f1_challenges: [],
  };
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/tournaments/t1/bracket") {
      return { data: { registrations: [{ id: "r1", display_name: "NeonFalke" }, { id: "r2", display_name: "LunaByte" }],
        matches_v2: [{ id: "m1", round: 1, status: "in_progress", slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }] }] } };
    }
    return { data: [] };
  });
  render(<MemoryRouter><EventLiveBoard event={event} /></MemoryRouter>);
  expect(await screen.findByTestId("event-live-board")).toHaveTextContent("Jetzt läuft");
  expect(screen.getByTestId("event-live-board")).toHaveTextContent("Sommer-Cup");
  expect(apiMock.get.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining(["/tournaments/t1/bracket", "/stations?event_id=e1", "/stations?tournament_id=t1"]));
});
