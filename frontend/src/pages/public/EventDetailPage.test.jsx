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

test("Partner II (#469): das Event nennt seine Partner mit Link auf die Partnerseite", async () => {
  renderPage({ ...base, partners: [{ id: "p1", slug: "pineapps-esports", name: "PineApps eSports", logo_url: "" }] });
  expect(await screen.findByTestId("event-partners")).toHaveTextContent("Gemeinsam mit");
  expect(screen.getByTestId("event-partner-pineapps-esports")).toHaveAttribute("href", "/partners/pineapps-esports");
});

test("Mehrtägig (#884): Zeitraum und Jetzt-Satz im Kopf, je Tag eine Karte, Turnier nennt seinen Tag, Kalender je Tag", async () => {
  const day = (index, patch) => ({ index, start: "10:00", end: "22:00", door: null, title: null, location_name: null, ends_next_day: false, state: "upcoming", ...patch });
  const schedule = {
    multi_day: true, count: 3, label: "3 Tage · Fr 16.10. – So 18.10.", range_label: "Fr 16.10. – So 18.10.", next_at: null,
    days: [
      day(1, { date: "2026-10-16", label: "Fr 16.10.", time_label: "18:00–23:00", start: "18:00", end: "23:00", door: "17:00", title: "Warm-up", start_at: "2026-10-16T16:00:00+00:00", end_at: "2026-10-16T21:00:00+00:00", state: "past" }),
      day(2, { date: "2026-10-17", label: "Sa 17.10.", time_label: "10:00–22:00", location_name: "Vereinsheim", start_at: "2026-10-17T08:00:00+00:00", end_at: "2026-10-17T20:00:00+00:00", state: "running" }),
      day(3, { date: "2026-10-18", label: "So 18.10.", time_label: "10:00–16:00", end: "16:00", title: "Finaltag", start_at: "2026-10-18T08:00:00+00:00", end_at: "2026-10-18T14:00:00+00:00" }),
    ],
    now: { state: "running", day_index: 2, text: "Heute 10:00–22:00" },
  };
  renderPage({
    ...base, status: "live", start_date: "2026-10-16T16:00:00+00:00", end_date: "2026-10-18T14:00:00+00:00", schedule,
    public_phase: { state: "live", label: "Tag 2/3 läuft", target_at: null, countdown_kind: null },
    tournaments: [{ id: "t1", slug: "cup", title: "Samstags-Cup", status: "scheduled", start_date: "2026-10-17T10:00:00+00:00", event_day: { index: 2, count: 3, label: "Sa 17.10.", date: "2026-10-17" } }],
  });
  expect(await screen.findByTestId("event-days-summary")).toHaveTextContent("3 Tage · Fr 16.10. – So 18.10. · Heute 10:00–22:00");
  expect(screen.getByTestId("event-days")).toHaveTextContent("Die Tage");
  expect(screen.getByTestId("event-day-1")).toHaveAttribute("data-state", "past");
  expect(screen.getByTestId("event-day-1")).toHaveTextContent("Einlass 17:00");
  expect(screen.getByTestId("event-day-1")).toHaveTextContent("Warm-up");
  expect(screen.getByTestId("event-day-2")).toHaveTextContent("Läuft");
  expect(screen.getByTestId("event-day-2")).toHaveTextContent("Vereinsheim");
  expect(screen.getByTestId("event-day-3")).toHaveTextContent("Finaltag");
  expect(screen.getByTestId("embed-event-day")).toHaveTextContent("Tag 2/3");

  // Kalender: Google und Outlook je Tag mit „Tag n/3“ im Titel, eine ICS-Datei mit allen Tagen.
  expect(screen.getByTestId("add-to-calendar-days").querySelectorAll("li")).toHaveLength(3);
  const google = decodeURIComponent(screen.getByTestId("add-to-calendar-google-3").getAttribute("href").replace(/\+/g, " "));
  expect(google).toContain("Vereinsausflug – Tag 3/3 · Finaltag");
  expect(google).toContain("20261018T080000Z/20261018T140000Z");
  expect(screen.getByTestId("add-to-calendar-ics")).toHaveTextContent("allen 3 Tagen");
  expect(screen.getByTestId("add-to-calendar-ics").getAttribute("href")).toBe("/api/calendar/events/ausflug.ics");
});
