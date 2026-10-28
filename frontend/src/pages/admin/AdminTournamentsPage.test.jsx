import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Verwaltungsliste der Turniere (#1028): die Seite fragt die Liste „zum Verwalten“ ab - der Server gibt der
// Turnierleitung alle Turniere, einem Helfer nur das Turnier seines Einsatzes. Kein fremdes Turnier mit Knöpfen,
// die der Server dann ablehnt.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
const authState = { isAdmin: false, isTournamentLead: false };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_error, fallback) => fallback, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));

const { default: AdminTournamentsPage } = await import("./AdminTournamentsPage");

const OWN = { id: "t-own", slug: "eigenes", title: "Eigenes Turnier", status: "registration_open", start_date: "2026-11-01T10:00:00Z", participant_count: 2, max_participants: 16 };

test("ein Helfer sieht in der Verwaltung nur sein Turnier - die Seite fragt die Verwaltungsliste ab", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/tournaments?include_drafts=true&managed=true") return { data: [OWN] };
    return { data: [OWN, { ...OWN, id: "t-fremd", slug: "fremd", title: "Fremdes Turnier" }] };
  });
  render(
    <MemoryRouter>
      <AdminTournamentsPage />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Eigenes Turnier")).toBeInTheDocument();
  expect(screen.queryByText("Fremdes Turnier")).toBeNull();
  expect(apiMock.get).toHaveBeenCalledWith("/tournaments?include_drafts=true&managed=true");
});

test("globale Aktionen nur für die Turnierleitung mit Zwei-Faktor - nicht für Adminbereich plus Helfer-Einsatz", async () => {
  apiMock.get.mockResolvedValue({ data: [{ ...OWN, status: "draft" }] });
  authState.isAdmin = true;
  authState.isTournamentLead = false;
  const helper = render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  expect(await screen.findByText("Eigenes Turnier")).toBeInTheDocument();
  expect(screen.queryByTestId("admin-new-tournament")).toBeNull();
  expect(screen.queryByTitle("Löschen")).toBeNull();
  expect(screen.queryByTitle("Anmeldung öffnen")).toBeNull();
  helper.unmount();

  authState.isTournamentLead = true;
  render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  expect(await screen.findByTestId("admin-new-tournament")).toBeInTheDocument();
  expect(screen.getByTitle("Löschen")).toBeInTheDocument();
});

// Liga-Staffeln (#2109, S26, L-D3): gekennzeichnet, filterbar, gestartet nicht löschbar, kein „Anmeldung öffnen“.
const STAFFEL = { ...OWN, id: "t-staffel", slug: "liga-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A", status: "draft",
  league_context: { league_id: "l1", season_id: "s1", division_id: "d1", staffel: "A" }, league_label: "Liga · Staffel A" };

test("Staffeln tragen ihr Kennzeichen und lassen sich filtern", async () => {
  apiMock.get.mockResolvedValue({ data: [OWN, STAFFEL] });
  authState.isTournamentLead = true;
  render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  expect(await screen.findByText("Probe-Liga Season 1 · Liga 1 · Staffel A")).toBeInTheDocument();
  expect(screen.getByTestId("admin-tr-league-label-liga-a")).toHaveTextContent("Liga · Staffel A");
  fireEvent.change(screen.getByTestId("admin-tournament-kind-filter"), { target: { value: "league" } });
  expect(screen.queryByText("Eigenes Turnier")).toBeNull();
  expect(screen.getByText("Probe-Liga Season 1 · Liga 1 · Staffel A")).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("admin-tournament-kind-filter"), { target: { value: "tournament" } });
  expect(screen.getByText("Eigenes Turnier")).toBeInTheDocument();
  expect(screen.queryByText("Probe-Liga Season 1 · Liga 1 · Staffel A")).toBeNull();
});

test("eine Staffel: vor dem Start löschbar, danach nicht, und nie „Anmeldung öffnen“", async () => {
  apiMock.get.mockResolvedValue({ data: [STAFFEL, { ...STAFFEL, id: "t-live", slug: "liga-b", title: "Laufende Staffel", status: "live" }] });
  authState.isTournamentLead = true;
  render(<MemoryRouter><AdminTournamentsPage /></MemoryRouter>);
  await screen.findByText("Laufende Staffel");
  expect(within(screen.getByTestId("admin-tr-liga-a")).getByTitle("Löschen")).toBeInTheDocument();
  expect(within(screen.getByTestId("admin-tr-liga-b")).queryByTitle("Löschen")).toBeNull();
  expect(screen.queryByTitle("Anmeldung öffnen")).toBeNull();
});