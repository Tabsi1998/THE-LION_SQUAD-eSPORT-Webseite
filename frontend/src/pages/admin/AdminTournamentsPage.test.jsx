import { render, screen } from "@testing-library/react";
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
