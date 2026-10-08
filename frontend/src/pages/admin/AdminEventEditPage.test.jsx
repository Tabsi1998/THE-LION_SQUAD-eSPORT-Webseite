import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Event als eigene Seite (#434): Anlegen unter /admin/events/new, Bearbeiten unter
// /admin/events/:id mit den Daten aus der Liste; Speichern führt zurück zur Liste.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/DiscordPreview", () => ({ DiscordPreview: () => <div data-testid="discord-preview" /> }));
vi.mock("@/components/tls/SharePreviewToggle", () => ({ SharePreviewToggle: () => null }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));
vi.mock("@/components/tls/MarkdownEditor", () => ({ MarkdownEditor: ({ testId }) => <textarea data-testid={testId} readOnly /> }));
vi.mock("@/components/tls/AccessLinksPanel", () => ({ AccessLinksPanel: () => <div data-testid="access-links" /> }));
vi.mock("@/components/tls/EventBillingSection", () => ({ EventBillingSection: () => null }));
vi.mock("@/components/tls/EventLocationsSection", () => ({
  EventLocationsSection: () => null,
  locationsToForm: () => [],
  formToLocations: (value) => value,
  locationsFormError: () => "",
}));
vi.mock("@/components/tls/RichContent", () => ({ appendEmbedToken: (text) => text }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ can: () => false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// Verteilen (#1359): der Kasten fragt vor dem Senden nach.
const confirmMock = vi.fn(async () => true);
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));

const AdminEventEditPage = (await import("./AdminEventEditPage")).default;
const { toast } = await import("sonner");

const META = {
  types: [{ k: "general", l: "Allgemein" }, { k: "lan", l: "LAN" }],
  statuses: [{ k: "draft", l: "Entwurf" }, { k: "live", l: "Live" }],
  visibilities: [{ k: "public", l: "Öffentlich" }, { k: "members", l: "Mitglieder" }],
};
const EVENTS = [
  { id: "ev-1", name: "Halloween Night", slug: "halloween", status: "draft", event_type: "general", visibility: "public", start_date: "2026-10-31T14:00:00Z" },
];

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/events" element={<div data-testid="events-list" />} />
        <Route path="/admin/events/new" element={<AdminEventEditPage />} />
        <Route path="/admin/events/:id" element={<AdminEventEditPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/meta") return { data: META };
    if (url.startsWith("/events?")) return { data: EVENTS };
    return { data: [] };
  });
  apiMock.post.mockReset();
  apiMock.patch.mockReset();
});

test("Neues Event: Seite mit Seitenleiste, Slug aus dem Namen, Speichern legt an und führt zur Liste", async () => {
  apiMock.post.mockResolvedValue({ data: { id: "ev-2" } });
  renderAt("/admin/events/new");
  expect(await screen.findByRole("heading", { name: "Neues Event" })).toBeInTheDocument();
  expect(screen.getByTestId("admin-form-aside")).toBeInTheDocument();
  expect(screen.getByTestId("admin-form-back")).toHaveAttribute("href", "/admin/events");
  expect(screen.queryByTestId("access-links")).toBeNull();
  expect(await screen.findByRole("option", { name: "LAN" })).toBeInTheDocument();

  fireEvent.change(screen.getByTestId("event-name"), { target: { value: "Weihnachtsfeier 2026" } });
  expect(screen.getByTestId("event-slug")).toHaveValue("weihnachtsfeier-2026");
  fireEvent.submit(screen.getByTestId("event-form"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/events", expect.objectContaining({ name: "Weihnachtsfeier 2026", slug: "weihnachtsfeier-2026", status: "draft" })));
  expect(await screen.findByTestId("events-list")).toBeInTheDocument();
});

test("Bearbeiten lädt das Event aus der Liste und schickt nur die Änderung", async () => {
  apiMock.patch.mockResolvedValue({ data: { ...EVENTS[0], name: "Halloween Night 2026" } });
  renderAt("/admin/events/ev-1");
  expect(await screen.findByRole("heading", { name: "Event bearbeiten" })).toBeInTheDocument();
  expect(screen.getByTestId("event-name")).toHaveValue("Halloween Night");
  expect(screen.getByTestId("access-links")).toBeInTheDocument();
  expect(screen.getByTestId("event-status")).toHaveValue("draft");

  fireEvent.change(screen.getByTestId("event-name"), { target: { value: "Halloween Night 2026" } });
  fireEvent.submit(screen.getByTestId("event-form"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  const [url, patch] = apiMock.patch.mock.calls[0];
  expect(url).toBe("/events/ev-1");
  expect(patch).toEqual(expect.objectContaining({ name: "Halloween Night 2026" }));
  expect(patch).not.toHaveProperty("slug");
  expect(await screen.findByTestId("events-list")).toBeInTheDocument();
});

test("unbekannte Kennung: Hinweis mit Weg zurück statt leerem Formular", async () => {
  renderAt("/admin/events/gibt-es-nicht");
  expect(await screen.findByTestId("event-missing")).toHaveTextContent("Event nicht gefunden");
  expect(screen.queryByTestId("event-form")).toBeNull();
});

test("Partner II (#469): der Partner-Haken geht als partner_ids mit", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/meta") return { data: META };
    if (url.startsWith("/events?")) return { data: EVENTS };
    if (url === "/partners") return { data: [{ id: "p1", slug: "pineapps-esports", name: "PineApps eSports" }] };
    return { data: [] };
  });
  apiMock.post.mockResolvedValue({ data: { id: "ev-3" } });
  renderAt("/admin/events/new");
  fireEvent.change(await screen.findByTestId("event-name"), { target: { value: "TFT-Abend" } });
  fireEvent.click(await screen.findByTestId("event-partner-p1"));
  fireEvent.submit(screen.getByTestId("event-form"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/events", expect.objectContaining({ name: "TFT-Abend", partner_ids: ["p1"] })));
});

// Mehrtägige Events (#884): der Schalter ersetzt Start, Ende und Einlass durch Tage; Fehler kommen als Satz,
// gespeichert wird die Liste; ein Event mit Tagen zeigt sie; aus geht zurück auf Start und Ende.
const DAYS = [
  { date: "2026-10-16", start: "18:00", end: "23:00", door: "17:00", title: "Warm-up", location_key: null, start_at: "2026-10-16T16:00:00+00:00", end_at: "2026-10-16T21:00:00+00:00" },
  { date: "2026-10-17", start: "10:00", end: "16:00", door: null, title: null, location_key: null, start_at: "2026-10-17T08:00:00+00:00", end_at: "2026-10-17T14:00:00+00:00" },
];

function serveEventWithDays() {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/meta") return { data: META };
    if (url.startsWith("/events?")) return { data: [{ ...EVENTS[0], days: DAYS }] };
    return { data: [] };
  });
}

test("Mehrtägig (#884): Schalter schlägt zwei Tage vor, prüft sie und schickt die Liste", async () => {
  apiMock.post.mockResolvedValue({ data: { id: "ev-9", slug: "lan" } });
  renderAt("/admin/events/new");
  expect(await screen.findByRole("heading", { name: "Neues Event" })).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("event-name"), { target: { value: "LAN-Wochenende" } });
  fireEvent.change(screen.getByTestId("event-start"), { target: { value: "2026-10-16T18:00" } });
  fireEvent.click(screen.getByTestId("event-days-toggle"));

  expect(screen.queryByTestId("event-start")).toBeNull();
  expect(screen.getByTestId("event-day-date-0")).toHaveValue("2026-10-16");
  expect(screen.getByTestId("event-day-date-1")).toHaveValue("2026-10-17");
  expect(screen.getByTestId("event-day-start-1")).toHaveValue("18:00");
  expect(screen.getByTestId("event-days-error")).toHaveTextContent("Tag 1: Das Ende fehlt.");

  fireEvent.submit(screen.getByTestId("event-form"));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Tag 1: Das Ende fehlt."));
  expect(apiMock.post).not.toHaveBeenCalled();

  fireEvent.change(screen.getByTestId("event-day-end-0"), { target: { value: "23:00" } });
  fireEvent.change(screen.getByTestId("event-day-end-1"), { target: { value: "02:00" } });
  fireEvent.change(screen.getByTestId("event-day-title-1"), { target: { value: "Finaltag" } });
  fireEvent.click(screen.getByTestId("event-days-add"));
  expect(screen.getByTestId("event-day-date-2")).toHaveValue("2026-10-18");
  fireEvent.click(screen.getByTestId("event-day-remove-2"));
  expect(screen.queryByTestId("event-days-error")).toBeNull();

  fireEvent.submit(screen.getByTestId("event-form"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(1));
  const [, payload] = apiMock.post.mock.calls[0];
  expect(payload.days).toEqual([
    { date: "2026-10-16", start: "18:00", end: "23:00", door: null, title: null, location_key: null },
    { date: "2026-10-17", start: "18:00", end: "02:00", door: null, title: "Finaltag", location_key: null },
  ]);
});

test("Mehrtägig (#884): ein Event mit Tagen zeigt sie, eine Änderung schickt die ganze Liste", async () => {
  serveEventWithDays();
  apiMock.patch.mockResolvedValue({ data: EVENTS[0] });
  renderAt("/admin/events/ev-1");
  expect(await screen.findByRole("heading", { name: "Event bearbeiten" })).toBeInTheDocument();
  expect(screen.getByTestId("event-days-toggle")).toBeChecked();
  expect(screen.queryByTestId("event-start")).toBeNull();
  expect(screen.getByTestId("event-day-door-0")).toHaveValue("17:00");
  expect(screen.getByTestId("event-day-title-0")).toHaveValue("Warm-up");
  expect(screen.getByTestId("event-day-0")).toHaveTextContent("Tag 1 · Fr 16.10.");

  fireEvent.change(screen.getByTestId("event-day-end-1"), { target: { value: "18:00" } });
  fireEvent.submit(screen.getByTestId("event-form"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  const [, patch] = apiMock.patch.mock.calls[0];
  expect(patch.days).toEqual([
    { date: "2026-10-16", start: "18:00", end: "23:00", door: "17:00", title: "Warm-up", location_key: null },
    { date: "2026-10-17", start: "10:00", end: "18:00", door: null, title: null, location_key: null },
  ]);
  expect(patch).not.toHaveProperty("start_date");
});

test("Mehrtägig (#884): Schalter aus bringt Start und Ende aus dem ersten und letzten Tag zurück", async () => {
  serveEventWithDays();
  apiMock.patch.mockResolvedValue({ data: EVENTS[0] });
  renderAt("/admin/events/ev-1");
  expect(await screen.findByTestId("event-days-toggle")).toBeChecked();
  fireEvent.click(screen.getByTestId("event-days-toggle"));
  expect(screen.getByTestId("event-start")).toHaveValue("2026-10-16T18:00");
  expect(screen.getByTestId("event-end")).toHaveValue("2026-10-17T16:00");
  expect(screen.getByTestId("event-door-time")).toHaveValue("2026-10-16T17:00");
  fireEvent.submit(screen.getByTestId("event-form"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  const [, patch] = apiMock.patch.mock.calls[0];
  expect(patch.days).toEqual([]);
  expect(patch.start_date).toContain("2026-10-16T");
});

// Anmeldung im Discord (#885): Vorgabe an, Hinweis bei externem Link, der Haken geht beim Speichern mit.
test("Anmeldung im Discord: Vorgabe an, Hinweis bei externem Link, Abwahl geht mit", async () => {
  apiMock.patch.mockResolvedValue({ data: EVENTS[0] });
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/meta") return { data: META };
    if (url.startsWith("/events?")) return { data: [{ ...EVENTS[0], has_registration: true }] };
    return { data: [] };
  });
  renderAt("/admin/events/ev-1");
  const box = await screen.findByTestId("event-discord-registration");
  expect(box).toBeChecked();
  expect(box.closest("label")).toHaveTextContent("/anmelden");

  fireEvent.change(screen.getByLabelText("Externer Anmeldelink"), { target: { value: "https://example.test/anmeldung" } });
  expect(screen.getByTestId("event-discord-registration").closest("label")).toHaveTextContent("Gerade ohne Wirkung");

  fireEvent.click(screen.getByTestId("event-discord-registration"));
  fireEvent.submit(screen.getByTestId("event-form"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  const [, patch] = apiMock.patch.mock.calls[0];
  expect(patch.discord_registration).toBe(false);
});

// Event-Sponsoren (#1354): eine eigene kleine Auswahl für alle, die Events bearbeiten - nicht die Sponsorenliste der
// Redaktion. Fehlt das Recht, steht ein Satz statt eines leeren Kastens.
test("Event-Sponsoren kommen aus der eigenen Auswahl – nie aus der Sponsorenliste der Redaktion", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/meta") return { data: META };
    if (url.startsWith("/events?")) return { data: EVENTS };
    if (url === "/admin/choices/sponsors") return { data: [{ id: "sp-1", name: "Pixelbäckerei", logo_url: null, show_on_events: true }] };
    return { data: [] };
  });
  renderAt("/admin/events/ev-1");
  expect(await screen.findByTestId("event-sponsors")).toHaveTextContent("Pixelbäckerei");
  expect(apiMock.get.mock.calls.map(([url]) => url)).not.toContain("/sponsors/admin");
});

test("fehlt das Recht für Event-Sponsoren, steht ein Satz – das Formular bleibt bedienbar", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/meta") return { data: META };
    if (url.startsWith("/events?")) return { data: EVENTS };
    if (url === "/admin/choices/sponsors") throw { response: { status: 403, data: { detail: "fehlt" } } };
    return { data: [] };
  });
  renderAt("/admin/events/ev-1");
  expect(await screen.findByTestId("event-sponsors-error")).toHaveTextContent("Dafür fehlt dir das Recht, Event-Sponsoren zu wählen");
  expect(screen.getByTestId("event-name")).toHaveValue("Halloween Night");
});

// Verteilen (#1359): die Turnierleitung sendet den Newsletter ihres Events einmal; ein zweites Mal nur Redaktion und System.
test("Verteilen im Event: gesendet – ein zweites Mal nur Redaktion und System", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/meta") return { data: META };
    if (url.startsWith("/events?")) return { data: EVENTS };
    if (url === "/settings/newsletter/state") {
      return { data: { kind: "event", source_id: "ev-1", title: "Halloween Night", visibility: "members", state: "sent", recipients: 40, sent_at: "2026-10-05T16:02:00+00:00", sent_count: 38,
        can_send: true, can_resend: false, announcement: "Mitglieder bekommen eine Meldung in der App und in der Glocke – „Nur Mitglieder“." } };
    }
    return { data: [] };
  });
  renderAt("/admin/events/ev-1");
  expect(await screen.findByTestId("distribute-newsletter-line")).toHaveTextContent("an 38 Personen.");
  expect(screen.getByTestId("distribute-resend-locked")).toHaveTextContent("Ein zweites Mal senden nur Redaktion und System.");
  expect(screen.queryByTestId("distribute-resend")).toBeNull();
  expect(screen.getByTestId("distribute-announcement")).toHaveTextContent("Mitglieder bekommen eine Meldung");
  expect(apiMock.get).toHaveBeenCalledWith("/settings/newsletter/state", { params: { kind: "event", id: "ev-1" } });
});
