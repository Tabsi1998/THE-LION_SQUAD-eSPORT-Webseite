import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Kalender (#402): Monatsraster mit Punkten je Art, Termine des gewählten Tags, Abo-Adresse;
// ohne Login der Hinweis, mit Login das „Angemeldet“ vom Server. Seit #1271 öffnet er im aktuellen Monat mit „Heute“,
// Mehrtägiges ist ein Balken bzw. eine Zeile, am Handy startet die Liste; seit #1190 stehen Vereinstermine grün dabei.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
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

// Eine dreitägige LAN im Dezember, wie der Server sie liefert: ein Eintrag je Tag (#884) mit dem Namen des Events.
const LAN = [17, 18, 19].map((day, index) => ({
  id: `e-lan-tag-${index + 1}`, kind: "event", slug: "lan", title: `Herbst-LAN – Tag ${index + 1}/3`, start: `2099-12-${day}T10:00:00+01:00`, end: `2099-12-${day}T22:00:00+01:00`,
  status: "scheduled", phase: null, location: "Vereinsheim", path: "/events/lan", visibility: "public", mine: false, marker: "event_day", event_id: "e-lan", event_name: "Herbst-LAN",
}));

const CLUB = [
  { id: "meeting-7", kind: "club", club_kind: "meeting", title: "Generalversammlung 2099", start: "2099-10-24T16:00:00+00:00", end: "2099-10-24T18:00:00+00:00", all_day: false, day: "2099-10-24", status: "invited", phase: { label: "Eingeladen", state: "invited" }, location: "Vereinsheim", path: "/members/meetings?meeting=7", visibility: "members", mine: false, marker: "meeting" },
  { id: "shift-5-52", kind: "club", club_kind: "shift", title: "Helferschicht: Bar · Sommerfest", start: "2099-10-10T20:00:00+00:00", end: "2099-10-10T23:00:00+00:00", all_day: false, day: "2099-10-10", status: "planned", phase: { label: "Angefragt", state: "requested" }, location: "Vereinsheim", path: "/members/helfen?event=5", visibility: "members", mine: true, marker: "shift" },
];

function respond(items, signedIn = false) {
  apiMock.get.mockResolvedValue({ data: { items, signed_in: signedIn, feed_path: "/api/calendar/feed.ics" } });
}

async function renderPage(title) {
  render(<MemoryRouter><CalendarPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("calendar-title")).toHaveTextContent(title));
}

beforeEach(() => {
  apiMock.get.mockReset();
  window.localStorage.clear();
  window.innerWidth = 1440;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2099-10-01T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

test("Raster mit Punkten, Tag antippen zeigt seine Termine, Abo-Adresse und Login-Hinweis", async () => {
  respond(ITEMS);
  await renderPage("Oktober 2099");

  expect(screen.getByTestId("calendar-dot-2099-10-05-event")).toBeInTheDocument();
  expect(screen.getByTestId("calendar-dot-2099-10-05-tournament")).toBeInTheDocument();
  expect(screen.queryByTestId("calendar-dot-2099-10-06-event")).toBeNull();
  expect(screen.getByTestId("calendar-day-2099-10-12").className).toContain("border-brand");

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
  respond(ITEMS, true);
  await renderPage("Oktober 2099");
  expect(screen.queryByTestId("calendar-login-hint")).toBeNull();
  expect(screen.queryByTestId("calendar-kind-club")).toBeNull();

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

test("öffnet im aktuellen Monat; ein leerer Monat nennt den nächsten Termin, „Heute“ springt zurück", async () => {
  vi.setSystemTime(new Date("2099-11-10T10:00:00Z"));
  respond([...ITEMS, ...LAN]);
  await renderPage("November 2099");

  const hint = screen.getByTestId("calendar-next-hint");
  expect(hint).toHaveTextContent("Nächster Termin: Do 17. Dezember – Herbst-LAN");
  await userEvent.click(hint);
  expect(screen.getByTestId("calendar-title")).toHaveTextContent("Dezember 2099");
  expect(screen.queryByTestId("calendar-next-hint")).toBeNull();
  expect(screen.getByTestId("calendar-day-items")).toHaveTextContent("17. Dezember");

  await userEvent.click(screen.getByTestId("calendar-today"));
  expect(screen.getByTestId("calendar-title")).toHaveTextContent("November 2099");
});

test("eine mehrtägige LAN ist im Monat ein Balken und in der Liste eine Zeile", async () => {
  vi.setSystemTime(new Date("2099-12-01T10:00:00Z"));
  respond(LAN);
  await renderPage("Dezember 2099");

  const bars = screen.getAllByTestId("calendar-bar-event-e-lan");
  expect(bars).toHaveLength(1);
  expect(bars[0]).toHaveTextContent("Herbst-LAN");
  expect(bars[0]).toHaveAttribute("href", "/events/lan");
  expect(bars[0].style.gridColumn).toBe("4 / 7");
  expect(screen.queryByTestId("calendar-dot-2099-12-18-event")).toBeNull();

  const upcoming = screen.getByTestId("calendar-upcoming");
  expect(within(upcoming).getAllByRole("link")).toHaveLength(1);
  expect(upcoming).toHaveTextContent("Do 17. – Sa 19. Dezember");

  await userEvent.click(screen.getByTestId("calendar-view-list"));
  const list = screen.getByTestId("calendar-list");
  expect(within(list).getByTestId("calendar-list-month-2099-12")).toHaveTextContent("Dezember 2099");
  expect(within(list).getAllByRole("link")).toHaveLength(1);
  expect(within(list).getByTestId("calendar-item-event-e-lan")).toHaveTextContent("Do 17. – Sa 19. Dezember");
  expect(screen.queryByTestId("calendar-grid")).toBeNull();
  expect(window.localStorage.getItem("tls_calendar_view")).toBe("list");
});

test("am Handy startet die Liste; die letzte Wahl bleibt am Gerät", async () => {
  window.innerWidth = 390;
  respond(ITEMS);
  render(<MemoryRouter><CalendarPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("calendar-list")).toBeInTheDocument());
  expect(screen.getByTestId("calendar-view-list")).toHaveAttribute("aria-pressed", "true");
  expect(within(screen.getByTestId("calendar-list")).getByTestId("calendar-list-month-2099-10")).toBeInTheDocument();

  await userEvent.click(screen.getByTestId("calendar-view-month"));
  expect(screen.getByTestId("calendar-grid")).toBeInTheDocument();
  expect(window.localStorage.getItem("tls_calendar_view")).toBe("month");
});

test("Mitglieder sehen Versammlungen und eigene Schichten in Vereinsgold (#1305), der Tipp führt in den Mitgliederbereich", async () => {
  respond([...ITEMS, ...CLUB], true);
  await renderPage("Oktober 2099");

  expect(screen.getByTestId("calendar-dot-2099-10-24-club").style.backgroundColor).toBe("rgb(255, 215, 0)");
  expect(screen.getByTestId("calendar-kind-club")).toHaveTextContent("Verein");

  await userEvent.click(screen.getByTestId("calendar-day-2099-10-24"));
  const meeting = within(screen.getByTestId("calendar-day-items")).getByTestId("calendar-item-club-meeting-7");
  expect(meeting).toHaveAttribute("href", "/members/meetings?meeting=7");
  expect(meeting).toHaveTextContent("Versammlung");
  const shift = within(screen.getByTestId("calendar-upcoming")).getByTestId("calendar-item-club-shift-5-52");
  expect(shift).toHaveAttribute("href", "/members/helfen?event=5");
  expect(shift).toHaveTextContent("Helferschicht");
});

// „Nur meine“ und der persönliche Link (#1189).
function respondSignedIn(items, personal = { active: false, created_at: null, last_used_at: null }) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/calendar/personal") return { data: personal };
    return { data: { items, signed_in: true, feed_path: "/api/calendar/feed.ics" } };
  });
}

test("ohne Login weder „Nur meine“ noch persönlicher Link", async () => {
  respond([...ITEMS, ...CLUB]);
  await renderPage("Oktober 2099");
  expect(screen.queryByTestId("calendar-only-mine")).toBeNull();
  expect(screen.queryByTestId("calendar-personal")).toBeNull();
  expect(apiMock.get).not.toHaveBeenCalledWith("/calendar/personal");
});

test("„Nur meine“ zeigt nur, wofür man angemeldet ist - auch bei den Vereinsterminen", async () => {
  respondSignedIn([...ITEMS, ...CLUB]);
  window.localStorage.setItem("tls_calendar_view", "list");
  render(<MemoryRouter><CalendarPage /></MemoryRouter>);
  await screen.findByTestId("calendar-only-mine");
  const list = screen.getByTestId("calendar-list");
  expect(within(list).getByTestId("calendar-item-event-e-fest")).toBeInTheDocument();
  await userEvent.click(screen.getByTestId("calendar-only-mine"));
  expect(screen.getByTestId("calendar-only-mine")).toHaveAttribute("aria-pressed", "true");
  expect(within(list).queryByTestId("calendar-item-event-e-fest")).toBeNull();
  expect(within(list).getByTestId("calendar-item-tournament-t-cup")).toBeInTheDocument();
  expect(within(list).getByTestId("calendar-item-club-shift-5-52")).toBeInTheDocument();
  expect(within(list).queryByTestId("calendar-item-club-meeting-7")).toBeNull();
});

test("Persönlicher Link: erzeugen zeigt die Adresse einmal, neu erzeugen fragt nach, abschalten", async () => {
  respondSignedIn(ITEMS);
  apiMock.post.mockResolvedValue({ data: { active: true, path: "/api/calendar/personal/geheim-123.ics", created_at: "2099-10-01T10:00:00+00:00", last_used_at: null } });
  apiMock.delete.mockResolvedValue({ data: { active: false } });
  render(<MemoryRouter><CalendarPage /></MemoryRouter>);
  const panel = await screen.findByTestId("calendar-personal");
  await userEvent.click(within(panel).getByTestId("calendar-personal-create"));
  expect(apiMock.post).toHaveBeenCalledWith("/calendar/personal");
  expect(screen.getByTestId("calendar-personal-feed-url")).toHaveValue(`${window.location.origin}/api/calendar/personal/geheim-123.ics`);
  expect(screen.getByTestId("calendar-personal-webcal").getAttribute("href")).toMatch(/^webcal:\/\/.*\/api\/calendar\/personal\/geheim-123\.ics$/);
  expect(screen.getByTestId("calendar-personal-once")).toBeInTheDocument();
  // Der öffentliche Feed bleibt daneben unverändert.
  expect(screen.getByTestId("calendar-feed-url")).toHaveValue(`${window.location.origin}/api/calendar/feed.ics`);

  await userEvent.click(screen.getByTestId("calendar-personal-renew"));
  expect(apiMock.post).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByTestId("calendar-personal-renew-confirm"));
  expect(apiMock.post).toHaveBeenCalledTimes(2);

  await userEvent.click(screen.getByTestId("calendar-personal-revoke"));
  expect(apiMock.delete).toHaveBeenCalledWith("/calendar/personal");
  expect(screen.queryByTestId("calendar-personal-feed-url")).toBeNull();
  expect(screen.getByTestId("calendar-personal-create")).toBeInTheDocument();
});

test("Persönlicher Link schon aktiv: keine Adresse, nur der Stand", async () => {
  respondSignedIn(ITEMS, { active: true, created_at: "2099-09-01T10:00:00+00:00", last_used_at: "2099-09-30T08:00:00+00:00" });
  render(<MemoryRouter><CalendarPage /></MemoryRouter>);
  const active = await screen.findByTestId("calendar-personal-active");
  expect(active).toHaveTextContent("Dein Link ist aktiv");
  expect(screen.queryByTestId("calendar-personal-feed-url")).toBeNull();
});
