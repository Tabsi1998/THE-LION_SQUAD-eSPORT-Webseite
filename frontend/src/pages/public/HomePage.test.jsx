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

const HomePage = (await import("./HomePage")).default;

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
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(3));
  expect(screen.queryByTestId("home-next-new")).not.toBeInTheDocument();
});
