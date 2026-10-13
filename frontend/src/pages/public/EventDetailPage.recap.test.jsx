import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Rückblick (#1187) und Freunde (#1188) auf der Event-Seite: vor dem Ende Anmeldung und „Was läuft“ wie bisher, ohne
// Rückblick; nach dem letzten Tag (Wiener Tag) der Rückblick oben, Anmeldung und „Was läuft“ fallen weg.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (e, f) => f, resolveMediaUrl: (u) => u }));
const authState = { user: null };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/CookieConsent", () => ({ useCookieConsent: () => ({ hasConsent: () => true }) }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useCanonicalSlugRedirect", () => ({ useCanonicalSlugRedirect: () => {} }));
vi.mock("@/components/tls/RichContent", () => ({ RichContent: () => null }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/pages/public/EventLivePage", () => ({ EventLiveBoard: () => null }));

const EventDetailPage = (await import("./EventDetailPage")).default;

const EVENT = {
  id: "e1", slug: "sommer-lan", name: "Sommer-LAN", status: "scheduled", visibility: "public", has_registration: true,
  start_date: "2026-10-10T08:00:00Z", end_date: "2026-10-10T20:00:00Z",
  registrations: [], sponsors: [], albums: [], news: [], f1_challenges: [],
  own_registration: { id: "r1", status: "checked_in", seat_count: 1, companion_count: 0 },
  tournaments: [{ id: "t1", slug: "mk", title: "Mario Kart Cup", team_mode: "solo", status: "results_published", start_date: "2026-10-10T10:00:00Z" }],
};
const RECAP = {
  available: true, event_id: "e1", fastlaps: [], report: null,
  winners: [{ kind: "tournament", id: "t1", slug: "mk", title: "Mario Kart Cup", team: false, podium: [{ rank: 1, name: "Lena", team: false, detail: "2 Siege" }] }],
  numbers: { participants: 8, matches: 7, tournaments: 1, fastlaps: 0, photos: 0 },
  mine: { was_there: true, results: [{ kind: "tournament", id: "t1", slug: "mk", title: "Mario Kart Cup", rank: 3, of: 8, team_name: null }] },
};
const FRIENDS = { friends: [{ id: "u-finn", display_name: "Finn", avatar_url: null, username: null, where: [{ kind: "event" }] }], sharing: true, hint: false };

function renderAt(now, recap = RECAP) {
  vi.setSystemTime(new Date(now));
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/sommer-lan") return { data: EVENT };
    if (url === "/events/sommer-lan/recap") return { data: recap };
    if (url === "/events/sommer-lan/friends") return { data: FRIENDS };
    throw new Error(url);
  });
  return render(
    <MemoryRouter initialEntries={["/events/sommer-lan"]}>
      <Routes><Route path="/events/:slug" element={<EventDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  authState.user = { id: "u-lena", role: "player", areas: [] };
});
afterEach(() => vi.useRealTimers());

test("am letzten Tag (23:30 in Wien) noch kein Rückblick - Anmeldung und „Was läuft“ stehen", async () => {
  renderAt("2026-10-10T21:30:00Z");
  expect(await screen.findByTestId("event-yours")).toBeInTheDocument();
  expect(screen.getByTestId("event-whatson")).toBeInTheDocument();
  expect(screen.getByTestId("event-facts-own")).toHaveTextContent("Du bist dabei");
  expect(screen.queryByTestId("event-recap")).toBeNull();
  expect(apiMock.get).not.toHaveBeenCalledWith("/events/sommer-lan/recap", expect.anything());
  expect(await screen.findByTestId("event-friends")).toHaveTextContent("Von deinen Freunden dabei");
});

test("am Tag danach: Rückblick oben mit „Du warst dabei“, ohne Anmeldung und „Was läuft“", async () => {
  renderAt("2026-10-10T22:05:00Z");
  const recap = await screen.findByTestId("event-recap");
  expect(screen.getByTestId("event-recap-mine")).toHaveTextContent("Platz 3 von 8");
  expect(recap).toHaveTextContent("Lena");
  expect(screen.queryByTestId("event-yours")).toBeNull();
  expect(screen.queryByTestId("event-whatson")).toBeNull();
  expect(screen.queryByTestId("event-over")).toBeNull();
  expect(screen.getByTestId("event-facts-own")).toHaveTextContent("Du warst dabei");
  expect(screen.getByTestId("event-facts-own")).toHaveAttribute("href", "#rueckblick");
  expect(await screen.findByTestId("event-friends")).toHaveTextContent("Deine Freunde waren dabei");
  const order = [...document.querySelectorAll("[data-section]")].map((node) => node.getAttribute("data-section"));
  expect(order.slice(0, 2)).toEqual(["recap", "friends"]);
});

test("Gäste sehen den Rückblick ohne „Du warst dabei“ und fragen keine Freunde ab", async () => {
  authState.user = null;
  renderAt("2026-10-12T10:00:00Z", { ...RECAP, mine: null });
  expect(await screen.findByTestId("event-recap")).toBeInTheDocument();
  expect(screen.queryByTestId("event-recap-mine")).toBeNull();
  expect(apiMock.get).not.toHaveBeenCalledWith("/events/sommer-lan/friends");
});
