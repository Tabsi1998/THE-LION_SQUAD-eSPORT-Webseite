import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Fast-Lap-Verwaltung (#1028): die Seite fragt die Liste „zum Verwalten“ ab - Helfer bekommen nur ihre Fast Lap, auch
// als Entwurf. „Neue Challenge“ nur für die Turnierleitung mit bestätigter Zwei-Faktor-Anmeldung.

const apiMock = { get: vi.fn(), delete: vi.fn(), post: vi.fn() };
const authState = { isAdmin: true, isTournamentLead: false };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_error, fallback) => fallback, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));

const { default: AdminF1Page } = await import("./AdminF1Page");

const OWN = { id: "fl-eigen", slug: "eigen", title: "Eigene Fast Lap", status: "draft", track_count: 1, participant_count: 0 };

test("ein Helfer sieht nur seine Fast Lap, auch als Entwurf - ohne „Neue Challenge“", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/f1/challenges?include_drafts=true&managed=true") return { data: [OWN] };
    return { data: [{ ...OWN, id: "fl-fremd", slug: "fremd", title: "Fremde Fast Lap", status: "live" }] };
  });
  const helper = render(<MemoryRouter><AdminF1Page /></MemoryRouter>);
  expect(await screen.findByText("Eigene Fast Lap")).toBeInTheDocument();
  expect(screen.queryByText("Fremde Fast Lap")).toBeNull();
  expect(apiMock.get).toHaveBeenCalledWith("/f1/challenges?include_drafts=true&managed=true");
  expect(screen.queryByTestId("admin-f1-new-btn")).toBeNull();
  helper.unmount();

  authState.isTournamentLead = true;
  render(<MemoryRouter><AdminF1Page /></MemoryRouter>);
  expect(await screen.findByTestId("admin-f1-new-btn")).toBeInTheDocument();
});
