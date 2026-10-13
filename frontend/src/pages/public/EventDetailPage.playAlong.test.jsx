import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// „Spielst du auch mit?“ (#1184) auf der Event-Seite: nach der Event-Anmeldung kommt der zweite Schritt - nur, wenn das
// Event Turniere oder Fast Laps hat. Kam man von einem Turnier mit Event-Pflicht (#875), geht es danach dorthin zurück.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback, resolveMediaUrl: (u) => u }));
const authState = { user: { id: "u1", username: "paula" } };
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T10:00:00Z"));
  apiMock.get.mockReset();
  apiMock.post.mockReset();
});
afterEach(() => vi.useRealTimers());

const CUP = { id: "t1", slug: "lan-cup", title: "LAN-Cup", status: "registration_open", team_mode: "solo", start_date: "2026-10-31T16:00:00+00:00" };
const EVENT = {
  id: "e1", slug: "lan", name: "Vereins-LAN", status: "registration_open", visibility: "public", has_registration: true,
  public_phase: { state: "registration_open" }, start_date: "2026-10-31T14:00:00+00:00", registrations: [], sponsors: [], albums: [], news: [],
  tournaments: [CUP], f1_challenges: [], registration_summary: { registered_count: 0, reserved_seats: 0 },
};
const OPTIONS = { show: true, entries: [{ kind: "tournament", id: "t1", slug: "lan-cup", title: "LAN-Cup", start_date: CUP.start_date, mode: "Einzel", team: false,
  fee: null, spots_left: 7, full: false, selectable: true, reason: null, captain: false, my_status: null }] };

function renderPage(event, path = "/events/lan") {
  apiMock.get.mockImplementation(async (url) => (url.endsWith("/play-along") ? { data: OPTIONS } : { data: event }));
  apiMock.post.mockResolvedValue({ data: { id: "r1", status: "registered" } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/events/:slug" element={<EventDetailPage />} />
        <Route path="/tournaments/:slug" element={<div data-testid="tournament-page">Turnierseite</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function registerForEvent() {
  fireEvent.click(await screen.findByTestId("event-register-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/events/e1/registrations", expect.anything(), expect.anything()));
}

test("nach der Event-Anmeldung kommt „Spielst du auch mit?“ - „Nein danke“ schließt", async () => {
  renderPage(EVENT);
  await registerForEvent();
  expect(await screen.findByTestId("play-along-sheet")).toBeInTheDocument();
  expect(screen.getByTestId("play-along-row-t1")).toHaveTextContent("LAN-Cup");
  fireEvent.click(screen.getByTestId("play-along-skip"));
  expect(screen.queryByTestId("play-along-sheet")).toBeNull();
  expect(screen.queryByTestId("tournament-page")).toBeNull();
});

test("ohne Turniere und Fast Laps bleibt es ein Schritt", async () => {
  renderPage({ ...EVENT, tournaments: [] });
  await registerForEvent();
  // Nur die Event-Abrufe zählen - Freunde beim Event und der einmalige Hinweis (#1188) fragen eigens.
  await waitFor(() => expect(apiMock.get.mock.calls.filter(([url]) => !url.includes("friends"))).toHaveLength(2));
  expect(screen.queryByTestId("play-along-sheet")).toBeNull();
  expect(apiMock.get.mock.calls.some(([url]) => url.endsWith("/play-along"))).toBe(false);
});

test("vom Turnier mit Event-Pflicht gekommen: das Turnier ist vorausgewählt, danach geht es zurück", async () => {
  renderPage(EVENT, "/events/lan?turnier=lan-cup");
  await registerForEvent();
  expect(await screen.findByTestId("play-along-check-t1")).toBeChecked();
  fireEvent.click(screen.getByTestId("play-along-skip"));
  expect(await screen.findByTestId("tournament-page")).toBeInTheDocument();
});
