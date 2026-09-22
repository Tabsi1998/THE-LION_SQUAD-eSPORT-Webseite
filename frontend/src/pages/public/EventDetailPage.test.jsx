import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Events an mehreren Standorten (#203) und Karte aus der Adresse (#204): ein Standort sieht aus wie
// vorher, mehrere werden als Karten mit je eigener Karte gezeigt; die Kartensuche nimmt die Adresse.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (e, f) => f, resolveMediaUrl: (u) => u }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/CookieConsent", () => ({ useCookieConsent: () => ({ hasConsent: () => true }) }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useCanonicalSlugRedirect", () => ({ useCanonicalSlugRedirect: () => {} }));
vi.mock("@/components/tls/RichContent", () => ({ RichContent: () => null }));

const EventDetailPage = (await import("./EventDetailPage")).default;

const base = {
  id: "e1", slug: "ausflug", name: "Vereinsausflug", status: "scheduled", visibility: "public", show_map: true,
  start_date: "2026-10-31T14:00:00+00:00", location: "Treffpunkt Vereinsheim", address: "Bahnhofstraße 1", postal_code: "6410", city: "Telfs", country: "Österreich",
  map_query: "Bahnhofstraße 1, 6410 Telfs, Österreich", registrations: [], sponsors: [], albums: [], news: [], tournaments: [], f1_challenges: [],
};

function renderPage(event) {
  apiMock.get.mockResolvedValue({ data: event });
  return render(
    <MemoryRouter initialEntries={["/events/ausflug"]}>
      <Routes><Route path="/events/:slug" element={<EventDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

test("ein Standort: wie bisher - und die Karte sucht die Adresse, nicht den Namen", async () => {
  renderPage({ ...base, locations: [{ key: "ort-1", name: "Treffpunkt Vereinsheim", address_line: "Bahnhofstraße 1, 6410 Telfs, Österreich", map_query: "Bahnhofstraße 1, 6410 Telfs, Österreich" }] });
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Vereinsausflug");
  expect(screen.queryByTestId("event-locations")).not.toBeInTheDocument();
  expect(screen.queryByTestId("event-location-count")).not.toBeInTheDocument();
  const frame = screen.getByTitle("Karte Vereinsausflug");
  expect(frame.getAttribute("src")).toContain(encodeURIComponent("Bahnhofstraße 1, 6410 Telfs, Österreich"));
  expect(frame.getAttribute("src")).not.toContain(encodeURIComponent("Treffpunkt"));
});

test("mehrere Standorte: Zähler im Kopf, je Standort Karte, Zeiten und Adresse", async () => {
  renderPage({ ...base, locations: [
    { key: "ort-1", name: "Treffpunkt Vereinsheim", start_date: "2026-10-31T14:00:00+00:00", door_time: "2026-10-31T13:30:00+00:00", address_line: "Bahnhofstraße 1, 6410 Telfs, Österreich", map_query: "Bahnhofstraße 1, 6410 Telfs, Österreich", max_participants: 30 },
    { key: "ort-2", name: "Kartbahn", start_date: "2026-10-31T16:00:00+00:00", end_date: "2026-10-31T19:00:00+00:00", address_line: "Innsbruck", map_query: "Innsbruck", note: "Fahrt mit dem Bus" },
  ] });
  expect(await screen.findByTestId("event-location-count")).toHaveTextContent("2 Standorte");
  const block = screen.getByTestId("event-locations");
  expect(block).toHaveTextContent("Treffpunkt Vereinsheim");
  expect(block).toHaveTextContent("Kartbahn");
  expect(block).toHaveTextContent("30 Plätze");
  expect(block).toHaveTextContent("Fahrt mit dem Bus");
  expect(screen.getByTitle("Karte Kartbahn").getAttribute("src")).toContain(encodeURIComponent("Innsbruck"));
  expect(screen.getByTitle("Karte Treffpunkt Vereinsheim")).toBeInTheDocument();
  expect(screen.queryByTitle("Karte Vereinsausflug")).not.toBeInTheDocument();
});
