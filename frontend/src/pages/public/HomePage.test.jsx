import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Startseite lebendiger (#224): Countdown zum nächsten Termin, Live-Zahlen in der Karte, und
// nach einer Änderung über den Strom leuchtet die Karte kurz mit „Neu“ - beim ersten Laden nicht.

const apiMock = { get: vi.fn() };
let invalidate = null;
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (u) => u }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: (callback) => { invalidate = callback; } }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/LiveStreamSlider", () => ({ LiveStreamSlider: () => null }));
vi.mock("@/components/tls/SponsorTicker", () => ({ SponsorTicker: () => null }));
vi.mock("@/components/tls/SeasonPassWidget", () => ({ SeasonPassWidget: () => null }));
vi.mock("@/components/tls/Logo", () => ({ MascotBadge: () => null }));
vi.mock("@/components/tls/LazyImg", () => ({ LazyImg: () => null }));
const authState = { user: null, isClubMember: false };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));

const HomePage = (await import("./HomePage")).default;

const NEWS = [
  { id: "n1", slug: "cup-abgesagt", title: "Cup abgesagt", category: "announcement", excerpt: "Zu wenige Anmeldungen.", published_at: "2026-09-20T10:00:00Z" },
  { id: "n2", slug: "smash-anmeldung", title: "Smash-Anmeldung offen", category: "announcement", published_at: "2026-09-19T10:00:00Z" },
];

function stateWith(registered, status = "registration_open") {
  return {
    has_live: false,
    live: {}, today: {},
    soon: { tournaments: [{ id: "t1", slug: "cup", title: "Herbst-Cup", status, start_date: "2026-09-25T18:00:00Z",
      public_phase: { state: status, label: "Anmeldung offen", target_at: "2026-09-25T18:00:00Z", countdown_kind: "starts" },
      live_counts: { registered, capacity: 16, running_matches: 0 } }] },
    upcoming: {},
    news: [], featured_news: [], stats: {},
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-22T10:00:00Z"));
  invalidate = null;
  authState.user = null;
  authState.isClubMember = false;
});
afterEach(() => vi.useRealTimers());

test("Countdown, Live-Zahlen - und „Neu“ erst nach einer echten Änderung", async () => {
  apiMock.get.mockResolvedValue({ data: stateWith(12) });
  render(<MemoryRouter><HomePage /></MemoryRouter>);
  const card = await screen.findByTestId("home-next-tournament-cup");
  expect(screen.getByTestId("home-countdown")).toHaveTextContent("in 3 Tagen, 8 Stunden");
  expect(screen.getByTestId("home-live-counts")).toHaveTextContent("12 von 16 angemeldet");
  expect(card).not.toHaveAttribute("data-changed");
  expect(screen.queryByTestId("home-next-new")).not.toBeInTheDocument();

  // Der Strom meldet eine Änderung; der neue Stand hat dieselbe Karte - aber mit einer Anmeldung mehr.
  apiMock.get.mockResolvedValue({ data: stateWith(13) });
  await act(async () => { await invalidate({ resource: "tournaments" }); });
  await waitFor(() => expect(screen.getByTestId("home-live-counts")).toHaveTextContent("13 von 16 angemeldet"));
  expect(screen.getByTestId("home-next-tournament-cup")).toHaveAttribute("data-changed", "true");
  expect(screen.getByTestId("home-next-new")).toHaveTextContent("Neu");

  // Ein Neuladen ohne Änderung macht nichts neu.
  await act(async () => { vi.advanceTimersByTime(7000); });
  await waitFor(() => expect(screen.queryByTestId("home-next-new")).not.toBeInTheDocument());
  await act(async () => { await invalidate({ resource: "tournaments" }); });
  // Nur der Startseiten-Stand zählt - der Vorstand (#407) wird einmal daneben geladen.
  await waitFor(() => expect(apiMock.get.mock.calls.filter(([url]) => url === "/home/state")).toHaveLength(3));
  expect(screen.queryByTestId("home-next-new")).not.toBeInTheDocument();
});

// Startseite II und III (#407, #425, #431): Community zuerst im Hero, der Verein in Zahlen nur mit
// echten Zählern, Ansprechpartner aus dem Vorstand unter den News, Kalender-Einstieg bei den
// Terminen; der App-Kasten ist weg (Discord und LionsAPP stehen im Footer).
test("Hero führt zur Community, Zahlen und Ansprechpartner kommen aus echten Daten", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url.startsWith("/board")) return { data: [{ id: "p1", is_active: true, display_title: "Obfrau", user: { display_name: "Obfrau Otti", slug: "otti" } }] };
    return { data: { ...stateWith(3), news: NEWS, club_numbers: { members: 42, tournaments: 17, events: 0, participations: 5 } } };
  });
  render(<MemoryRouter><HomePage /></MemoryRouter>);
  await screen.findByTestId("home-next-tournament-cup");

  // Keine Knöpfe im Hero (#425) - nur die leise Zeile.
  expect(screen.queryByTestId("hero-cta-community")).toBeNull();
  expect(screen.queryByTestId("hero-cta-tournaments")).toBeNull();
  expect(screen.getByTestId("hero-join")).toHaveTextContent("Mitglied wird, wer sich einbringt");
  // Ohne matchMedia (jsdom) steht sofort der Endwert.
  expect(screen.getByTestId("home-number-members")).toHaveTextContent("42");
  expect(screen.getByTestId("home-number-tournaments")).toHaveTextContent("Veranstaltete Turniere");
  expect(screen.getByTestId("home-number-participations")).toHaveTextContent("5");
  expect(screen.getByTestId("home-number-participations")).toHaveTextContent("Turnierteilnahmen");
  expect(screen.queryByTestId("home-number-events")).toBeNull();
  expect(await screen.findByTestId("home-board-p1")).toHaveTextContent("Obfrau Otti");
  expect(screen.getByTestId("home-board-p1")).toHaveAttribute("href", "/members/otti");
  expect(screen.getByTestId("home-calendar-link")).toHaveAttribute("href", "/calendar");
  // Die Ansprechpartner stehen unter den aktuellen News (#431), der App-Kasten gibt es nicht mehr.
  const newsCard = screen.getByTestId("home-news-smash-anmeldung");
  const board = screen.getByTestId("home-board");
  expect(newsCard.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByTestId("home-app-strip")).toBeNull();
  expect(screen.queryByTestId("home-play-soon")).toBeNull();
});

test("ohne Zahlen und ohne Vorstand: keine leere Leiste und kein leerer Block", async () => {
  apiMock.get.mockImplementation(async (url) => (url.startsWith("/board") ? { data: [] } : { data: stateWith(1) }));
  render(<MemoryRouter><HomePage /></MemoryRouter>);
  await screen.findByTestId("home-next-tournament-cup");
  expect(screen.queryByTestId("home-numbers")).toBeNull();
  expect(screen.queryByTestId("home-board")).toBeNull();
  expect(screen.queryByTestId("home-app-strip")).toBeNull();
});

test("Mitglieder sehen im Hero keine Zeile - der Mitgliederbereich steht im Benutzermenü", async () => {
  authState.user = { id: "u1", username: "lion" };
  authState.isClubMember = true;
  apiMock.get.mockImplementation(async (url) => (url.startsWith("/board") ? { data: [] } : { data: stateWith(1) }));
  render(<MemoryRouter><HomePage /></MemoryRouter>);
  await screen.findByTestId("home-next-tournament-cup");
  expect(screen.queryByTestId("hero-join")).toBeNull();
  expect(screen.queryByText("Zum Mitgliederbereich")).toBeNull();
});
