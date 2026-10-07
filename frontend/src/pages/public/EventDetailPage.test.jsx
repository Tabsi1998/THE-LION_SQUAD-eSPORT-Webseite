import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Events an mehreren Standorten (#203) und Karte aus der Adresse (#204): ein Standort sieht aus wie
// vorher, mehrere werden als Karten mit je eigener Karte gezeigt; die Kartensuche nimmt die Adresse.

const apiMock = { get: vi.fn(), delete: vi.fn() };
const confirmMock = vi.fn(async () => true);
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (e, f) => f, resolveMediaUrl: (u) => u }));
const authState = { user: null };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/CookieConsent", () => ({ useCookieConsent: () => ({ hasConsent: () => true }) }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useCanonicalSlugRedirect", () => ({ useCanonicalSlugRedirect: () => {} }));
vi.mock("@/components/tls/RichContent", () => ({ RichContent: () => null }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const EventDetailPage = (await import("./EventDetailPage")).default;

// Die Seite rechnet „vorbei“ nach dem Wiener Tag (#1221) - die Uhr steht in diesen Tests fest.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T10:00:00Z"));
  authState.user = null;
});
afterEach(() => vi.useRealTimers());

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

// Schritt-Leiste (#1081): mit Kosten sieht man, wo die eigene Anmeldung steht; ohne Kosten ist es ein Schritt.
test("Anmeldung mit Kosten: Leiste Anmeldung, Bezahlen, Dabei mit dem echten Stand", async () => {
  const offer = { enabled: true, currency: "EUR", positions: [{ key: "ticket", label: "Ticket", amount_cents: 1500, basis: "per_person", optional: false }] };
  const registered = { id: "r1", status: "registered", seat_count: 1, companion_count: 0, price: { total_cents: 1500, currency: "EUR", billing_status: "pending" } };
  const { unmount } = renderPage({ ...base, has_registration: true, offer, own_registration: registered });
  expect(await screen.findByTestId("event-register-steps")).toHaveAttribute("aria-label", "Schritt 2 von 3: Bezahlen");
  unmount();
  renderPage({ ...base, has_registration: true, offer, own_registration: { ...registered, price: { ...registered.price, billing_status: "paid" } } });
  expect(await screen.findByTestId("event-register-steps")).toHaveAttribute("aria-label", "Schritt 3 von 3: Dabei");
});

test("Anmeldung ohne Kosten: keine Leiste", async () => {
  renderPage({ ...base, has_registration: true, own_registration: { id: "r1", status: "registered", seat_count: 1 } });
  expect(await screen.findByTestId("event-own-status")).toHaveTextContent("Du bist dabei");
  expect(screen.queryByTestId("event-register-steps")).not.toBeInTheDocument();
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

// Turnier-Karte am Event (#1220): Baum, wenn es einen gibt; bei Fehler „Baum gerade nicht ladbar“; ohne Baum nichts;
// mit Ergebnissen die ersten drei Plätze - nie mehr „Turnierbaum wurde noch nicht generiert“.
function renderWithTournament(tournament, answers) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/ausflug") return { data: { ...base, tournaments: [tournament] } };
    if (url in answers) {
      if (answers[url] instanceof Error) throw answers[url];
      return { data: answers[url] };
    }
    throw new Error(`unerwartet: ${url}`);
  });
  return render(
    <MemoryRouter initialEntries={["/events/ausflug"]}>
      <Routes><Route path="/events/:slug" element={<EventDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

const CUP = { id: "t1", slug: "mk-cup", title: "Mario Kart Cup", status: "registration_open", format: "single_elim" };

test("Turnier-Karte: der Baum mit Namen, Freilos und noch offenen Plätzen", async () => {
  renderWithTournament(CUP, {
    "/tournaments/t1/bracket": {
      registrations: [{ id: "r1", display_name: "NeonFalke" }, { id: "r2", display_name: "LunaByte" }],
      matches_v2: [
        { id: "m2", match_key: "B", round: 1, order: 2, status: "completed", winner_id: "r2", slots: [{ slot: 1, status: "bye" }, { slot: 2, registration_id: "r2", status: "filled" }] },
        { id: "m1", match_key: "A", round: 1, order: 1, status: "scheduled", slots: [{ slot: 1, registration_id: "r1", status: "filled" }, { slot: 2, status: "pending" }] },
      ],
      matches: [],
    },
  });
  const tree = await screen.findByTestId("event-tournament-tree");
  expect(tree).toHaveTextContent("Turnierbaum-Vorschau");
  await waitFor(() => expect(tree).toHaveTextContent("NeonFalke"));
  expect(tree).toHaveTextContent("noch offen");
  expect(tree).toHaveTextContent("Freilos");
  expect(screen.queryByText(/noch nicht generiert/)).toBeNull();
});

test("Turnier-Karte: Baum nicht ladbar - und Liga ohne Baum zeigt nichts", async () => {
  const { unmount } = renderWithTournament(CUP, { "/tournaments/t1/bracket": new Error("kaputt") });
  expect(await screen.findByTestId("event-tournament-failed")).toHaveTextContent("Baum gerade nicht ladbar.");
  unmount();
  apiMock.get.mockClear();
  renderWithTournament({ ...CUP, format: "league" }, {});
  expect(await screen.findByTestId("event-tournament-t1")).toHaveTextContent("Mario Kart Cup");
  expect(screen.queryByTestId("event-tournament-none")).toBeNull();
  expect(screen.queryByText(/Turnierbaum/)).toBeNull();
  expect(apiMock.get.mock.calls.map(([url]) => url)).not.toContain("/tournaments/t1/bracket");
});

test("Turnier-Karte: mit Ergebnissen die ersten drei Plätze statt „noch nicht generiert“", async () => {
  renderWithTournament({ ...CUP, status: "results_published" }, {
    "/tournaments/t1/standings": [
      { rank: 2, registration_id: "r2", display_name: "LunaByte" },
      { rank: 1, registration_id: "r1", display_name: "NeonFalke" },
      { rank: 3, registration_id: "r3", display_name: "KiwiKomet" },
      { rank: 4, registration_id: "r4", display_name: "DriftDaniel" },
    ],
  });
  const podium = await screen.findByTestId("event-tournament-podium");
  expect(podium).toHaveTextContent("Die ersten drei Plätze");
  await waitFor(() => expect(podium).toHaveTextContent("#1NeonFalke#2LunaByte#3KiwiKomet"));
  expect(podium).not.toHaveTextContent("DriftDaniel");
  expect(screen.queryByText(/noch nicht generiert/)).toBeNull();
});

// Nach dem Ende (#1221): kein Kalender, kein „Live verfolgen“, kein „Display“ - stattdessen der Satz mit den Turnieren.
// „Display“ sehen auch vorher nur Konten mit dem Bereich Turniere.
const SUMMER = {
  ...base, slug: "ausflug", status: "scheduled", start_date: "2026-06-20T08:00:00Z", end_date: "2026-06-21T18:00:00Z",
  tournaments: [{ id: "t9", slug: "sommer-cup", title: "Sommer-Cup", status: "results_published", format: "league" }],
};

test("beendetes Event: Satz mit den Turnieren, kein Kalender, kein Live, kein Display", async () => {
  authState.user = { id: "u9", role: "club_admin", areas: ["tournaments"] };
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/ausflug") return { data: SUMMER };
    if (url === "/tournaments/t9/standings") return { data: [] };
    throw new Error(url);
  });
  render(
    <MemoryRouter initialEntries={["/events/ausflug"]}>
      <Routes><Route path="/events/:slug" element={<EventDetailPage />} /></Routes>
    </MemoryRouter>,
  );
  const over = await screen.findByTestId("event-over");
  expect(over).toHaveTextContent("Das Event ist vorbei – die Ergebnisse stehen bei den Turnieren:");
  expect(over.querySelector("a")).toHaveAttribute("href", "/tournaments/sommer-cup");
  expect(screen.queryByTestId("add-to-calendar-ics")).toBeNull();
  expect(screen.queryByTestId("event-live-links")).toBeNull();
  expect(screen.queryByText("Live verfolgen")).toBeNull();
  expect(screen.queryByTestId("event-display-link")).toBeNull();
});

test("laufendes Event: Gäste sehen „Live verfolgen“ ohne „Display“, die Turnierleitung beides", async () => {
  const running = { ...SUMMER, start_date: "2026-10-10T08:00:00Z", end_date: "2026-10-11T18:00:00Z", tournaments: [{ ...SUMMER.tournaments[0], status: "live" }] };
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/ausflug") return { data: running };
    return { data: [] };
  });
  const { unmount } = render(
    <MemoryRouter initialEntries={["/events/ausflug"]}>
      <Routes><Route path="/events/:slug" element={<EventDetailPage />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByTestId("event-live-links")).toHaveTextContent("Live verfolgen");
  expect(screen.queryByTestId("event-display-link")).toBeNull();
  expect(screen.queryByTestId("event-over")).toBeNull();
  expect(screen.getByTestId("add-to-calendar-ics")).toBeInTheDocument();
  unmount();

  authState.user = { id: "u9", role: "tournament_admin", areas: ["tournaments", "moderation"] };
  render(
    <MemoryRouter initialEntries={["/events/ausflug"]}>
      <Routes><Route path="/events/:slug" element={<EventDetailPage />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByTestId("event-display-link")).toHaveAttribute("href", "/display/event/e1");
});

// Eigene Event-Anmeldung (#1223): „Du bist dabei“ mit Plätzen in Einzahl und Mehrzahl; „Stornieren“ ist ein leiser Link
// mit Rückfrage - nur, solange der Server es erlaubt (bis zum Beginn, nicht nach dem Check-in).
function renderOwn(own) {
  return renderPage({ ...base, has_registration: true, own_registration: { id: "r1", ...own } });
}

test("vor dem Beginn: Stornieren als Link mit Rückfrage", async () => {
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
  renderOwn({ status: "registered", seat_count: 1, companion_count: 0, can_cancel: true });
  expect(await screen.findByTestId("event-own-seats")).toHaveTextContent("1 Platz reserviert.");
  const link = screen.getByTestId("event-cancel-link");
  expect(link.className).not.toContain("tls-btn");
  fireEvent.click(link);
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/events/e1/registrations/me"));
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Event-Anmeldung stornieren?", confirmLabel: "Stornieren" }));
});

test("Rückfrage abgelehnt: nichts wird storniert", async () => {
  confirmMock.mockResolvedValueOnce(false);
  apiMock.delete.mockClear();
  renderOwn({ status: "registered", seat_count: 2, companion_count: 1, can_cancel: true });
  fireEvent.click(await screen.findByTestId("event-cancel-link"));
  await waitFor(() => expect(confirmMock).toHaveBeenCalled());
  expect(apiMock.delete).not.toHaveBeenCalled();
  expect(screen.getByTestId("event-own-seats")).toHaveTextContent("2 Plätze reserviert, davon 1 Begleitperson.");
});

test("nach dem Beginn oder dem Check-in: kein Storno-Weg, der Kasten sagt „Du bist dabei“", async () => {
  const { unmount } = renderOwn({ status: "registered", seat_count: 3, companion_count: 2, can_cancel: false });
  expect(await screen.findByTestId("event-own-status")).toHaveTextContent("Du bist dabei");
  expect(screen.getByTestId("event-own-seats")).toHaveTextContent("3 Plätze reserviert, davon 2 Begleitpersonen.");
  expect(screen.queryByTestId("event-cancel-link")).toBeNull();
  expect(screen.queryByText("Stornieren")).toBeNull();
  unmount();
  renderOwn({ status: "checked_in", seat_count: 2, companion_count: 1, can_cancel: false });
  expect(await screen.findByTestId("event-own-status")).toHaveTextContent("Du bist dabei");
  expect(screen.getByTestId("event-own-seats")).toHaveTextContent("Eingecheckt · 2 Plätze, davon 1 Begleitperson.");
  expect(screen.queryByTestId("event-cancel-link")).toBeNull();
});

test("Warteliste: Satz in der Mehrzahl, zurückziehen vor dem Beginn möglich", async () => {
  renderOwn({ status: "waitlist", seat_count: 3, companion_count: 2, can_cancel: true });
  expect(await screen.findByTestId("event-own-status")).toHaveTextContent("Warteliste");
  expect(screen.getByTestId("event-own-seats")).toHaveTextContent("Du stehst mit 3 Plätzen auf der Warteliste, davon 2 Begleitpersonen.");
  expect(screen.getByTestId("event-cancel-link")).toBeInTheDocument();
  expect(screen.queryByText(/Platz\/Plätze|Person\(en\)|davon 0/)).toBeNull();
});

// Leere Alben (#1224): statt einer leeren Karte „Fotos folgen in den nächsten Tagen“ - nur bis 14 Tage nach dem Event;
// ohne Album steht gar nichts. Die Uhr steht fest (10.10.2026).
test("leeres Album: der Satz bis 14 Tage nach dem Event, danach und ohne Album nichts", async () => {
  const past = { ...base, status: "scheduled", start_date: "2026-10-03T08:00:00Z", end_date: "2026-10-04T18:00:00Z", albums: [], photos_coming: true };
  const { unmount } = renderPage(past);
  expect(await screen.findByTestId("event-photos-coming")).toHaveTextContent("Fotos folgen in den nächsten Tagen.");
  unmount();

  const { unmount: unmountOld } = renderPage({ ...past, start_date: "2026-09-10T08:00:00Z", end_date: "2026-09-11T18:00:00Z" });
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Vereinsausflug");
  expect(screen.queryByTestId("event-photos-coming")).toBeNull();
  expect(screen.queryByTestId("event-gallery")).toBeNull();
  unmountOld();

  renderPage({ ...past, photos_coming: false });
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Vereinsausflug");
  expect(screen.queryByTestId("event-gallery")).toBeNull();
});

test("Verwaltung: ein leeres Album steht mit Hinweis da", async () => {
  renderPage({ ...base, status: "scheduled", start_date: "2026-10-03T08:00:00Z", end_date: "2026-10-04T18:00:00Z", photos_coming: true,
    albums: [{ id: "a1", slug: "ausflug-fotos", title: "Ausflug-Fotos", is_empty: true }] });
  expect(await screen.findByTestId("event-album-empty-a1")).toHaveTextContent("leer – für Besucher unsichtbar");
  expect(screen.getByTestId("event-photos-coming")).toBeInTheDocument();
});
