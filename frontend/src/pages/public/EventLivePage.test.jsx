import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Live-Seite nach dem Ende (#1221): die Adresse /events/<slug>/live eines beendeten Events führt auf die Event-Seite;
// solange es läuft, bleibt die Live-Seite. Die Uhr steht fest.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/Breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const EventLivePage = (await import("./EventLivePage")).default;

const EVENT = { id: "e1", slug: "gamers-fest", name: "Gamers Fest", status: "scheduled", start_date: "2026-06-20T08:00:00Z", end_date: "2026-06-21T18:00:00Z", tournaments: [], f1_challenges: [] };

function renderLive(event) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/gamers-fest") return { data: event };
    return { data: [] };
  });
  return render(
    <MemoryRouter initialEntries={["/events/gamers-fest/live"]}>
      <Routes>
        <Route path="/events/:slug/live" element={<EventLivePage />} />
        <Route path="/events/:slug" element={<div data-testid="event-page">Event-Seite</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-23T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

test("beendetes Event: die Live-Adresse führt auf die Event-Seite und lädt keine Spiele mehr", async () => {
  renderLive(EVENT);
  expect(await screen.findByTestId("event-page")).toBeInTheDocument();
  expect(apiMock.get.mock.calls.map(([url]) => url)).toEqual(["/events/gamers-fest"]);
});

test("laufendes Event: die Live-Seite bleibt", async () => {
  vi.setSystemTime(new Date("2026-06-20T10:00:00Z"));
  renderLive(EVENT);
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Gamers Fest");
  expect(screen.queryByTestId("event-page")).toBeNull();
});
