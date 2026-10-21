import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Partner an Serien und Ligen (#1934) auf der Referenzen-Übersicht: kleines Partner-Abzeichen in „Läuft gerade“, bei
// Serien & Ligen und in der Chronik, wenn ein Partner veranstaltet - aus der Saison oder über den Veranstalter-Namen
// einer Referenz. Nur erfundene Namen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => (value ? `/api/static${value}` : "") }));
// #1934: Logos laufen über den gemeinsamen Logo-Baustein (SmartLogo) mit resolveMediaUrl - hier als Attrappe.
vi.mock("@/components/tls/SmartLogo", () => ({ SmartLogo: ({ src, className }) => <img data-smart-logo="true" src={src} alt="" className={className} /> }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/usePublicSiteSettings", () => ({ usePublicSiteSettings: () => ({}) }));

const { default: ReferencesPage } = await import("./ReferencesPage");

const HOST = { id: "p1", slug: "probe-ananas", name: "Probe Ananas", logo_url: "/uploads/ananas.png", role: "organizer" };
const ITEMS = [
  { id: "r-saison", title: "Probe Ananas Liga 2025", display_title: "Probe Ananas Liga 2025", organizer: "Probe Ananas", start_date: "2025-12-01", status: "completed", best_placement: 2, entries: [], partners: [] },
  { id: "r-name", title: "Probe Kokos Cup", display_title: "Probe Kokos Cup", organizer: "Probe Kokos", start_date: "2025-10-01", status: "completed", best_placement: 5, entries: [],
    partners: [{ id: "p2", slug: "probe-kokos", name: "Probe Kokos", logo_url: null }] },
  { id: "r-ohne", title: "Fremd Open", display_title: "Fremd Open", organizer: "Fremd Verband", start_date: "2025-09-01", status: "completed", best_placement: 9, entries: [], partners: [] },
];
const RUNNING = { lineage: { title: "Probe Ananas Liga", slug: "probe-ananas-liga", kind: "series" }, game: null, series: { season: "2026", season_slug: "2026" }, progress: { total: 4, scored: 1 }, next: null, today: false, club: null, organizers: [HOST] };
const PATH = {
  lineage: { title: "Probe Ananas Liga", slug: "probe-ananas-liga", kind: "series", organizer: "Probe Ananas", organizers: [HOST] },
  game: null,
  seasons: [
    { season: "2025", season_slug: "2025", status: "completed", club: { rank: 2, of: 8 }, reference_ids: ["r-saison"], organizers: [HOST] },
    { season: "2026", season_slug: "2026", status: "active", club: null, reference_ids: [], organizers: [HOST] },
  ],
};

beforeEach(() => {
  apiMock.get.mockImplementation((url) => {
    if (url === "/reference-series/public/running") return Promise.resolve({ data: { items: [RUNNING] } });
    if (url === "/reference-series/public/lineages") return Promise.resolve({ data: { items: [PATH] } });
    return Promise.resolve({ data: { items: ITEMS, summary: {}, showcase: { mode: "auto", reference_id: null } } });
  });
});

test("Läuft gerade und Serien & Ligen tragen das Abzeichen des veranstaltenden Partners mit Original-Logo", async () => {
  render(<MemoryRouter><ReferencesPage /></MemoryRouter>);
  const card = await screen.findByTestId("running-card-probe-ananas-liga-2026");
  const badge = within(card).getByTestId("partner-host-badge");
  expect(badge).toHaveTextContent("Probe Ananas");
  expect(badge.querySelector("img[data-smart-logo]")).toHaveAttribute("src", "/api/static/uploads/ananas.png");
  expect(badge.querySelector("img[data-smart-logo]").className).not.toMatch(/grayscale|invert|brightness/);
  expect(within(screen.getByTestId("references-lineage-probe-ananas-liga")).getByTestId("partner-host-badge")).toHaveTextContent("Probe Ananas");
});

test("Chronik: Abzeichen aus der Saison oder über den Veranstalter-Namen, sonst der Veranstalter als Text", async () => {
  render(<MemoryRouter><ReferencesPage /></MemoryRouter>);
  const fromSeason = await screen.findByTestId("reference-card-r-saison");
  expect(within(fromSeason).getByTestId("partner-host-badge")).toHaveTextContent("Probe Ananas");
  expect(within(fromSeason).queryByTestId("reference-row-organizer")).toBeNull();
  expect(within(screen.getByTestId("reference-card-r-name")).getByTestId("partner-host-badge")).toHaveTextContent("Probe Kokos");
  const plain = screen.getByTestId("reference-card-r-ohne");
  expect(within(plain).queryByTestId("partner-host-badge")).toBeNull();
  expect(within(plain).getByTestId("reference-row-organizer")).toHaveTextContent("Fremd Verband");
});

test("ohne veranstaltenden Partner kein Abzeichen", async () => {
  apiMock.get.mockImplementation((url) => {
    if (url === "/reference-series/public/running") return Promise.resolve({ data: { items: [{ ...RUNNING, organizers: [] }] } });
    if (url === "/reference-series/public/lineages") return Promise.resolve({ data: { items: [] } });
    return Promise.resolve({ data: { items: [], summary: {}, showcase: { mode: "auto", reference_id: null } } });
  });
  render(<MemoryRouter><ReferencesPage /></MemoryRouter>);
  await screen.findByTestId("running-card-probe-ananas-liga-2026");
  expect(screen.queryByTestId("partner-host-badge")).toBeNull();
});
