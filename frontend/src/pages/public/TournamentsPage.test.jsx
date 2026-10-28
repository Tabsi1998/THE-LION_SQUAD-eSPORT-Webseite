import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";

// Turnierliste (#2124): „Beendet“ und „Live“ fragen Status-Gruppen am Server, ältere Turniere kommen mit „Mehr laden“.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/Reveal", () => ({ Reveal: ({ children, className }) => <div className={className}>{children}</div> }));
vi.mock("@/components/tls/TournamentCard", () => ({ TournamentCard: ({ tournament }) => <div data-testid="tournament-card">{tournament.title}</div> }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const TournamentsPage = (await import("./TournamentsPage")).default;

const cups = (count, from = 0) => Array.from({ length: count }, (_, index) => ({ id: `t${from + index}`, title: `Cup ${from + index}` }));

function query(url) {
  return Object.fromEntries(new URL(url, "http://x").searchParams);
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.get.mockImplementation(async (url) => {
    const { limit } = query(url);
    return { data: { items: cups(Math.min(Number(limit), 30)), total: 30 } };
  });
});

test("„Mehr laden“: zuerst 24, dann alle 30 - danach kein Knopf mehr", async () => {
  render(<MemoryRouter initialEntries={["/tournaments"]}><TournamentsPage /></MemoryRouter>);
  expect(await screen.findAllByTestId("tournament-card")).toHaveLength(24);
  expect(query(apiMock.get.mock.calls[0][0])).toMatchObject({ paged: "true", limit: "24", offset: "0", league: "exclude" });
  fireEvent.click(screen.getByTestId("tournaments-load-more"));
  await waitFor(() => expect(screen.getAllByTestId("tournament-card")).toHaveLength(30));
  expect(screen.queryByTestId("tournaments-load-more")).toBeNull();
});

test("„Beendet“ fragt die Gruppe „finished“, „Live“ die Gruppe „running“ - die Adresse bleibt bei den alten Werten", async () => {
  render(<MemoryRouter initialEntries={["/tournaments?status=completed"]}><TournamentsPage /></MemoryRouter>);
  await screen.findAllByTestId("tournament-card");
  expect(query(apiMock.get.mock.calls.at(-1)[0]).status).toBe("finished");
  fireEvent.click(screen.getByTestId("tournament-filter-live"));
  await waitFor(() => expect(query(apiMock.get.mock.calls.at(-1)[0]).status).toBe("running"));
});

function GoTo({ to }) {
  const navigate = useNavigate();
  return <button type="button" data-testid="go" onClick={() => navigate(to)}>los</button>;
}

test("Filterwechsel über die Adresse (Review O7, Zurück im Browser): wieder ab der ersten Seite mit 24", async () => {
  render(<MemoryRouter initialEntries={["/tournaments"]}><GoTo to="/tournaments?status=completed" /><TournamentsPage /></MemoryRouter>);
  await screen.findAllByTestId("tournament-card");
  fireEvent.click(screen.getByTestId("tournaments-load-more"));
  await waitFor(() => expect(screen.getAllByTestId("tournament-card")).toHaveLength(30));
  fireEvent.click(screen.getByTestId("go"));
  await waitFor(() => expect(query(apiMock.get.mock.calls.at(-1)[0])).toMatchObject({ status: "finished", limit: "24" }));
});