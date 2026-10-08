import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// /verein (#1147): Mitglieder sehen oben kurz ihren Mitgliederbereich mit dem Weg zu /members/area, alle anderen
// „Mitglied werden“ mit drei Gründen; darunter für alle News, Galerie, Über uns, Referenzen, Sponsoren und Partner.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "", formatMemberSince: () => "1. März 2023" }));
const authState = { user: null, isClubMember: false };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/SponsorTicker", () => ({ SponsorTicker: () => <div data-testid="sponsor-ticker" /> }));
vi.mock("@/components/tls/PartnerTicker", () => ({ PartnerTicker: () => <div data-testid="partner-ticker" /> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const { default: VereinPage } = await import("./VereinPage");

const NEWS = [
  { id: "n1", slug: "vereinsfarben", title: "Neue Vereinsfarben", visibility: "members", published_at: "2026-10-05T10:00:00Z" },
  { id: "n2", slug: "herbst-lan", title: "Herbst-LAN: Plan und Turniere stehen", visibility: "public", published_at: "2026-10-04T10:00:00Z" },
];

function mockApi() {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/news") return { data: NEWS };
    if (url.startsWith("/gallery")) return { data: [{ id: "a1", slug: "sommerfest", title: "Sommerfest", cover_url: "" }] };
    if (url === "/references") return { data: [{ id: "r1", title: "Landesmeisterschaft 2026" }] };
    if (url === "/membership/me") return { data: { membership: { member_since: "2023-03-01" } } };
    if (url === "/membership/area-summary") return { data: { meetings_open: 1, helping_free: 6, news_new: 1, documents: 2, documents_new: 0 } };
    return { data: [] };
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <VereinPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
  mockApi();
});

test("Mitglied: oben der Mitgliederbereich mit sechs Kacheln, internen News und dem Weg zu /members/area", async () => {
  authState.user = { id: "u-1", username: "neonfalke" };
  authState.isClubMember = true;
  renderPage();
  const area = await screen.findByTestId("verein-member-area");
  await waitFor(() => expect(within(area).getByTestId("verein-member-since")).toHaveTextContent("Seit 2023"));
  expect(within(area).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(expect.arrayContaining([
    "/members/membership#mitgliedskarte", "/members/membership", "/members/meetings", "/members/helfen", "/members/documents", "/members/benefits", "/members/area",
  ]));
  expect(within(screen.getByTestId("verein-internal-news")).getByText("Neue Vereinsfarben")).toBeInTheDocument();
  // Dieselben Zahlen wie in der Sprungleiste des Mitgliederbereichs (#1257): ohne Offenes keine Zahl.
  await waitFor(() => expect(within(area).getByTestId("verein-tile-meetings-note")).toHaveTextContent("1 offen"));
  expect(within(area).getByTestId("verein-tile-meetings")).toHaveAttribute("aria-label", "Versammlungen, 1 offen");
  expect(within(area).getByTestId("verein-tile-helping-note")).toHaveTextContent("6 frei");
  expect(within(area).queryByTestId("verein-tile-documents-note")).toBeNull();
  expect(within(area).queryByTestId("verein-tile-card-note")).toBeNull();
  expect(screen.queryByTestId("verein-join")).toBeNull();
  // Interne News stehen nur einmal - nicht noch einmal bei den öffentlichen.
  expect(within(screen.getByTestId("verein-news")).queryByText("Neue Vereinsfarben")).toBeNull();
  expect(within(screen.getByTestId("verein-news")).getByText("Herbst-LAN: Plan und Turniere stehen")).toBeInTheDocument();
  // Rechnungen stehen im Profil, nicht im Verein.
  expect(screen.queryByText(/Rechnung/)).toBeNull();
});

test("Gast: oben „Mitglied werden“ mit drei Gründen, darunter News, Galerie, Über uns, Referenzen, Sponsoren und Partner", async () => {
  authState.user = null;
  authState.isClubMember = false;
  renderPage();
  const join = await screen.findByTestId("verein-join");
  for (const reason of ["Mitgliedskarte", "Mitreden", "Interne Events"]) expect(within(join).getByText(reason)).toBeInTheDocument();
  expect(within(join).getByTestId("verein-join-apply")).toHaveAttribute("href", "/membership/join");
  expect(screen.queryByTestId("verein-member-area")).toBeNull();
  expect(await screen.findByText("Sommerfest")).toBeInTheDocument();
  expect(screen.getByText("Landesmeisterschaft 2026")).toBeInTheDocument();
  for (const id of ["verein-news", "verein-gallery", "verein-about", "verein-references", "verein-sponsors"]) expect(screen.getByTestId(id)).toBeInTheDocument();
  expect(screen.getByTestId("sponsor-ticker")).toBeInTheDocument();
  expect(screen.getByTestId("partner-ticker")).toBeInTheDocument();
  expect(apiMock.get).not.toHaveBeenCalledWith("/membership/me");
});
