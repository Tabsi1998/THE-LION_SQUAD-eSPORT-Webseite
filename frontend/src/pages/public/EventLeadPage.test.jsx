import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Anmeldungen & Einlass (#1372): Suche, Filter „noch nicht da“, Einchecken mit „Rückgängig“, Nachrücken und
// „Nachricht an alle“ mit Vorschau und Bestätigung. Namen und Adressen sind erfunden.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API_BASE: "", formatApiError: (value) => value }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "s1" } }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/Breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const { toast } = await import("sonner");
const EventLeadPage = (await import("./EventLeadPage")).default;

const ROWS = [
  { id: "r1", display_name: "Max Mustermann", status: "checked_in", companion_count: 0, seat_count: 1, email_masked: "m***@example.test" },
  { id: "r2", display_name: "Paula Brünner", status: "registered", companion_count: 1, seat_count: 2, email_masked: "p***@example.test", has_note: true },
  { id: "r3", display_name: "Zoë Adler", status: "registered", companion_count: 0, seat_count: 1, email_masked: "z***@example.test" },
  { id: "r4", display_name: "Ella Wartend", status: "waitlist", companion_count: 0, seat_count: 1, email_masked: "e***@example.test" },
];
const VIEW = {
  event: { id: "e1", slug: "herbst-lan", name: "Herbst-LAN", max_participants: 10, allow_companions: true, max_companions_per_registration: 2 },
  counts: {}, registrations: ROWS, can_message: true, message_recipients: 3, messages: [],
};

function renderLead(view = VIEW) {
  apiMock.get.mockResolvedValue({ data: view });
  return render(
    <MemoryRouter initialEntries={["/events/herbst-lan/leitung"]}>
      <Routes><Route path="/events/:slug/leitung" element={<EventLeadPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.patch.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

test("startet bei „noch nicht da“, Zähler „1 von 3 da“, Suche nach dem Namen", async () => {
  renderLead();
  expect(await screen.findByTestId("event-lead-counter")).toHaveTextContent("1 von 3 da");
  expect(apiMock.get).toHaveBeenCalledWith("/events/herbst-lan/lead", { params: { filter: "all" } });
  expect(screen.getByTestId("event-lead-filter-open")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("event-lead-filter-open")).toHaveTextContent("Noch nicht da (2)");
  expect(screen.getByTestId("event-lead-row-r2")).toBeInTheDocument();
  expect(screen.queryByTestId("event-lead-row-r1")).toBeNull();

  fireEvent.change(screen.getByTestId("event-lead-search"), { target: { value: "zoe" } });
  expect(screen.queryByTestId("event-lead-row-r2")).toBeNull();
  expect(screen.getByTestId("event-lead-row-r3")).toBeInTheDocument();

  fireEvent.change(screen.getByTestId("event-lead-search"), { target: { value: "" } });
  fireEvent.click(screen.getByTestId("event-lead-filter-waitlist"));
  expect(screen.getByTestId("event-lead-moveup-r4")).toHaveTextContent("Nachrücken");
  fireEvent.click(screen.getByTestId("event-lead-filter-all"));
  expect(screen.getAllByTestId(/^event-lead-row-/)).toHaveLength(4);
});

test("„Da“ checkt ein, der Zähler stimmt sofort, „Rückgängig“ setzt zurück", async () => {
  apiMock.patch.mockResolvedValue({ data: {} });
  renderLead();
  fireEvent.click(await screen.findByTestId("event-lead-checkin-r2"));
  expect(screen.getByTestId("event-lead-counter")).toHaveTextContent("2 von 3 da");
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/events/e1/registrations/r2", { status: "checked_in" }));
  expect(await screen.findByTestId("event-lead-undo-bar")).toHaveTextContent("Paula Brünner ist da.");

  fireEvent.click(screen.getByTestId("event-lead-undo-last"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenLastCalledWith("/events/e1/registrations/r2", { status: "registered" }));
  expect(screen.queryByTestId("event-lead-undo-bar")).toBeNull();
});

test("Nachrücken ohne freien Platz: der Server lehnt ab, die Liste bleibt", async () => {
  apiMock.patch.mockRejectedValue({ response: { status: 400, data: { detail: "Kapazität wäre überschritten" } } });
  renderLead();
  fireEvent.click(await screen.findByTestId("event-lead-filter-waitlist"));
  fireEvent.click(screen.getByTestId("event-lead-moveup-r4"));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Kapazität wäre überschritten"));
  expect(screen.getByTestId("event-lead-row-r4")).toHaveAttribute("data-status", "waitlist");
});

test("Details zeigen die Adresse nur gekürzt und holen die Notiz je Person", async () => {
  renderLead();
  const view = { data: VIEW };
  apiMock.get.mockImplementation((url) => Promise.resolve(url.endsWith("/lead/registrations/r2") ? { data: { id: "r2", note: "komme später", internal_note: null } } : view));
  expect(screen.queryByText("komme später")).toBeNull();
  fireEvent.click(await screen.findByTestId("event-lead-name-r2"));
  const [details] = screen.getAllByTestId("event-lead-details");
  expect(within(details).getByTestId("event-lead-mail")).toHaveTextContent("p***@example.test");
  await waitFor(() => expect(details).toHaveTextContent("komme später"));
  expect(apiMock.get).toHaveBeenCalledWith("/events/e1/lead/registrations/r2");
});

test("„Rückgängig“ nur im Fenster nach dem Einchecken - danach nicht mehr in der Zeile", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    apiMock.patch.mockResolvedValue({ data: {} });
    renderLead();
    // Schon vorher Eingecheckte haben keinen Knopf „Rückgängig“.
    fireEvent.click(await screen.findByTestId("event-lead-filter-here"));
    expect(screen.queryByTestId("event-lead-undo-r1")).toBeNull();
    fireEvent.click(screen.getByTestId("event-lead-filter-open"));
    apiMock.get.mockResolvedValue({ data: { ...VIEW, registrations: ROWS.map((row) => (row.id === "r3" ? { ...row, status: "checked_in" } : row)) } });
    fireEvent.click(screen.getByTestId("event-lead-checkin-r3"));
    await screen.findByTestId("event-lead-undo-bar");
    fireEvent.click(screen.getByTestId("event-lead-filter-here"));
    expect(screen.getByTestId("event-lead-undo-r3")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(11000);
    await waitFor(() => expect(screen.queryByTestId("event-lead-undo-bar")).toBeNull());
    expect(screen.queryByTestId("event-lead-undo-r3")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test("Nachricht an alle: Vorlage, Vorschau der Empfänger, erst nach Bestätigung senden", async () => {
  apiMock.post.mockResolvedValue({ data: { recipient_count: 3, notified: 3, mails: 2 } });
  renderLead();
  fireEvent.click(await screen.findByTestId("event-lead-message-open"));
  expect(screen.getByTestId("event-lead-message-preview")).toHaveTextContent("Geht an 3 Angemeldete – je Person einmal");
  expect(screen.getByTestId("event-lead-message-next")).toBeDisabled();

  fireEvent.click(screen.getByText("Der Parkplatz ist gesperrt – bitte den Hintereingang nehmen."));
  expect(screen.getByTestId("event-lead-message-text")).toHaveValue("Der Parkplatz ist gesperrt – bitte den Hintereingang nehmen.");
  fireEvent.click(screen.getByTestId("event-lead-message-next"));
  expect(apiMock.post).not.toHaveBeenCalled();
  expect(screen.getByTestId("event-lead-message-confirm")).toHaveTextContent("Wirklich an 3 Personen senden?");

  fireEvent.click(screen.getByTestId("event-lead-message-send"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/events/e1/lead/message", { text: "Der Parkplatz ist gesperrt – bitte den Hintereingang nehmen.", confirm_count: 3 }));
  await waitFor(() => expect(screen.queryByTestId("event-lead-message")).toBeNull());
  expect(toast.success).toHaveBeenCalledWith("Gesendet an 3 Personen.");
});

test("ohne Recht: Hinweis statt Liste", async () => {
  apiMock.get.mockRejectedValue({ response: { status: 403, data: { detail: "Für diesen Bereich fehlt dir die Berechtigung." } } });
  render(
    <MemoryRouter initialEntries={["/events/herbst-lan/leitung"]}>
      <Routes><Route path="/events/:slug/leitung" element={<EventLeadPage />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByTestId("event-lead-denied")).toHaveTextContent("Für diesen Bereich fehlt dir die Berechtigung.");
});
