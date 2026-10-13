import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Events (#1182): das Event als Klammer um seine Turniere - aufklappbar, nicht doppelt; eine Filterzeile mit
// „Nur meine“ (#1189), der Umschalter „Turniere im Event“/„Zusätzlich einzeln“ merkt sich das Gerät.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (u) => u }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/LazyImg", () => ({ LazyImg: () => null }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
const authState = { user: null };
vi.mock("@/context/AuthContext", () => ({ useOptionalAuth: () => authState }));

const EventsPage = (await import("./EventsPage")).default;

const EVENTS = [
  { id: "e-lan", slug: "herbst-lan", name: "Herbst-LAN", event_type: "lan_party", status: "registration_open", visibility: "public", start_date: "2099-10-17T10:00:00+02:00" },
  { id: "e-fest", slug: "sommerfest", name: "Sommerfest", event_type: "general", status: "scheduled", visibility: "public", start_date: "2099-10-05T18:00:00+02:00" },
];
const TOURNAMENTS = [
  { id: "t-rocket", slug: "rocket-cup", title: "Rocket Cup", event_id: "e-lan", status: "registration_open", start_date: "2099-10-18T14:00:00+02:00", team_mode: "team", game: { name: "Rocket League" } },
  { id: "t-online", slug: "online-cup", title: "Online-Cup", status: "registration_open", start_date: "2099-10-10T19:00:00+02:00", team_mode: "solo" },
];
const FASTLAPS = [{ id: "f-lan", slug: "lan-lap", title: "LAN Fast Lap", event_id: "e-lan", status: "live", start_date: "2099-10-17T10:00:00+02:00" }];
const MINE = { events: {}, tournaments: { "t-rocket": { state: "approved", label: "Du bist dabei", team_name: "Lions Rocket" } }, fastlaps: {} };

function respond() {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/meta") return { data: { types: [], statuses: [] } };
    if (url.startsWith("/events")) return { data: EVENTS };
    if (url.startsWith("/tournaments")) return { data: TOURNAMENTS };
    if (url.startsWith("/f1/challenges")) return { data: FASTLAPS };
    if (url === "/calendar/mine") return { data: MINE };
    throw new Error(`unerwartet: ${url}`);
  });
}

async function renderPage() {
  render(<MemoryRouter initialEntries={["/events"]}><EventsPage /></MemoryRouter>);
  await screen.findByTestId("event-card-herbst-lan");
}

beforeEach(() => {
  apiMock.get.mockReset();
  window.localStorage.clear();
  authState.user = null;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2099-09-30T10:00:00Z"));
  respond();
});

afterEach(() => {
  vi.useRealTimers();
});

test("Turniere eines Events stehen aufklappbar in seiner Karte, nicht doppelt; ohne Event für sich", async () => {
  await renderPage();
  const lan = screen.getByTestId("event-card-herbst-lan");
  expect(within(lan).getByTestId("event-card-link-herbst-lan")).toHaveAttribute("href", "/events/herbst-lan");
  const toggle = within(lan).getByTestId("event-card-toggle-herbst-lan");
  expect(toggle).toHaveTextContent("1 Turnier · 1 Fast Lap");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByTestId("event-child-tournament-t-rocket")).toBeNull();
  expect(screen.queryByTestId("tournament-card-rocket-cup")).toBeNull();
  expect(screen.getByTestId("tournament-card-online-cup")).toHaveAttribute("href", "/tournaments/online-cup");

  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  const rocket = screen.getByTestId("event-child-tournament-t-rocket");
  expect(rocket).toHaveAttribute("href", "/tournaments/rocket-cup");
  expect(rocket).toHaveTextContent("Rocket League · Team");
  expect(screen.getByTestId("event-child-fastlap-f-lan")).toHaveAttribute("href", "/fastlap/lan-lap");
  // Ohne Konto: kein „Nur meine“, keine Etiketten, kein Abruf des eigenen Stands.
  expect(screen.queryByTestId("events-only-mine")).toBeNull();
  expect(screen.queryByTestId("event-child-mine-t-rocket")).toBeNull();
  expect(apiMock.get).not.toHaveBeenCalledWith("/calendar/mine");
});

test("„Zusätzlich einzeln“ zeigt das Turnier auch als Karte und bleibt am Gerät", async () => {
  await renderPage();
  await userEvent.click(screen.getByTestId("events-mode-separate"));
  expect(screen.getByTestId("tournament-card-rocket-cup")).toBeInTheDocument();
  expect(screen.getByTestId("tournament-card-event-t-rocket")).toHaveTextContent("gehört zu Herbst-LAN");
  expect(window.localStorage.getItem("tls_events_list_mode")).toBe("separate");
});

test("Filterzeile: Turniere zeigt alle Turniere einzeln, Events nur Events", async () => {
  await renderPage();
  await userEvent.click(screen.getByTestId("events-filter-tournaments"));
  expect(screen.queryByTestId("event-card-herbst-lan")).toBeNull();
  expect(screen.getByTestId("tournament-card-rocket-cup")).toBeInTheDocument();
  expect(screen.getByTestId("tournament-card-online-cup")).toBeInTheDocument();
  expect(screen.queryByTestId("events-mode")).toBeNull();
  await userEvent.click(screen.getByTestId("events-filter-events"));
  expect(screen.getByTestId("event-card-herbst-lan")).toBeInTheDocument();
  expect(screen.queryByTestId("tournament-card-online-cup")).toBeNull();
});

test("„Nur meine“: nur, wofür man selbst oder das Team dabei ist - mit dem eigenen Stand", async () => {
  authState.user = { id: "u-paula" };
  await renderPage();
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/calendar/mine"));
  await userEvent.click(screen.getByTestId("events-only-mine"));
  expect(screen.getByTestId("events-only-mine")).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByTestId("event-card-sommerfest")).toBeNull();
  expect(screen.queryByTestId("tournament-card-online-cup")).toBeNull();
  const lan = screen.getByTestId("event-card-herbst-lan");
  await userEvent.click(within(lan).getByTestId("event-card-toggle-herbst-lan"));
  expect(screen.getByTestId("event-child-mine-t-rocket")).toHaveTextContent("Du bist dabei · Lions Rocket");
  expect(screen.queryByTestId("event-child-fastlap-f-lan")).toBeNull();
});
