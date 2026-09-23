import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Kalender (#402): Monatsraster mit Punkten je Art, Termine des gewählten Tags, Abo-Adresse;
// ohne Login der Hinweis, mit Login das „Angemeldet“ vom Server.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const CalendarPage = (await import("./CalendarPage")).default;

// Mittag statt Mitternacht: die CI läuft in UTC (#374).
const ITEMS = [
  { id: "e-fest", kind: "event", slug: "sommerfest", title: "Sommerfest", start: "2099-10-05T18:00:00+02:00", end: "2099-10-05T22:00:00+02:00", status: "scheduled", phase: { label: "Angekündigt", state: "scheduled" }, location: "Vereinsheim, Telfs", path: "/events/sommerfest", visibility: "public", mine: false, marker: null },
  { id: "t-cup-anmeldeschluss", kind: "tournament", slug: "autumn-cup", title: "Anmeldeschluss: Autumn Cup", start: "2099-10-05T12:00:00+02:00", end: null, status: "registration_open", phase: null, location: "Mario Kart 8", path: "/tournaments/autumn-cup", visibility: "public", mine: true, marker: "registration_close" },
  { id: "t-cup", kind: "tournament", slug: "autumn-cup", title: "Autumn Cup", start: "2099-10-12T19:00:00+02:00", end: null, status: "registration_open", phase: { label: "Anmeldung offen", state: "registration_open" }, location: "Mario Kart 8", path: "/tournaments/autumn-cup", visibility: "public", mine: true, marker: null },
];

beforeEach(() => {
  apiMock.get.mockReset();
});

test("Raster mit Punkten, Tag antippen zeigt seine Termine, Abo-Adresse und Login-Hinweis", async () => {
  apiMock.get.mockResolvedValue({ data: { items: ITEMS, signed_in: false, feed_path: "/api/calendar/feed.ics" } });
  render(<MemoryRouter><CalendarPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("calendar-title")).toHaveTextContent("Oktober 2099"));

  expect(screen.getByTestId("calendar-dot-2099-10-05-event")).toBeInTheDocument();
  expect(screen.getByTestId("calendar-dot-2099-10-05-tournament")).toBeInTheDocument();
  expect(screen.queryByTestId("calendar-dot-2099-10-06-event")).toBeNull();
  expect(screen.getByTestId("calendar-day-2099-10-12").className).toContain("border-[#FFD700]");

  await userEvent.click(screen.getByTestId("calendar-day-2099-10-05"));
  const day = screen.getByTestId("calendar-day-items");
  expect(day).toHaveTextContent("5. Oktober");
  expect(within(day).getByTestId("calendar-item-event-e-fest")).toHaveAttribute("href", "/events/sommerfest");
  expect(within(day).getByTestId("calendar-item-tournament-t-cup-anmeldeschluss")).toHaveTextContent("Anmeldeschluss");
  expect(within(day).getByTestId("calendar-item-tournament-t-cup-anmeldeschluss")).toHaveTextContent("Angemeldet");

  await userEvent.click(screen.getByTestId("calendar-day-2099-10-06"));
  expect(screen.getByTestId("calendar-day-empty")).toBeInTheDocument();

  expect(screen.getByTestId("calendar-feed-url")).toHaveValue(`${window.location.origin}/api/calendar/feed.ics`);
  expect(screen.getByTestId("calendar-webcal").getAttribute("href")).toMatch(/^webcal:\/\/.*\/api\/calendar\/feed\.ics$/);
  expect(screen.getByTestId("calendar-login-hint")).toBeInTheDocument();
  expect(within(screen.getByTestId("calendar-upcoming")).getAllByRole("link")).toHaveLength(3);
});

test("Arten lassen sich ausblenden, die letzte bleibt; mit Login kein Hinweis", async () => {
  apiMock.get.mockResolvedValue({ data: { items: ITEMS, signed_in: true, feed_path: "/api/calendar/feed.ics" } });
  render(<MemoryRouter><CalendarPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("calendar-title")).toHaveTextContent("Oktober 2099"));
  expect(screen.queryByTestId("calendar-login-hint")).toBeNull();

  await userEvent.click(screen.getByTestId("calendar-kind-tournament"));
  expect(screen.queryByTestId("calendar-dot-2099-10-05-tournament")).toBeNull();
  expect(screen.getByTestId("calendar-dot-2099-10-05-event")).toBeInTheDocument();
  await userEvent.click(screen.getByTestId("calendar-kind-fastlap"));
  await userEvent.click(screen.getByTestId("calendar-kind-event"));
  expect(screen.getByTestId("calendar-dot-2099-10-05-event")).toBeInTheDocument();

  await userEvent.click(screen.getByTestId("calendar-next"));
  expect(screen.getByTestId("calendar-title")).toHaveTextContent("November 2099");
  await userEvent.click(screen.getByTestId("calendar-prev"));
  await userEvent.click(screen.getByTestId("calendar-prev"));
  expect(screen.getByTestId("calendar-title")).toHaveTextContent("September 2099");
});
