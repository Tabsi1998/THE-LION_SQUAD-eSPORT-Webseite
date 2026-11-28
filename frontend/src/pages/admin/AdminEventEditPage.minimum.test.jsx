import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Mindestanzahl bis zu einer Frist (#2614) in der Bearbeiten-Seite: Einstellung, Stand vom Server und „Event absagen“ als ein
// Schritt mit Pflichtgrund. Ohne Mindestzahl bleibt die Absage, wie sie war (Rückfrage ohne Grund).

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (err, fallback) => err?.response?.data?.detail || fallback, resolveMediaUrl: (url) => url }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/DiscordPreview", () => ({ DiscordPreview: () => null }));
vi.mock("@/components/tls/SharePreviewToggle", () => ({ SharePreviewToggle: () => null }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => null }));
vi.mock("@/components/tls/MarkdownEditor", () => ({ MarkdownEditor: ({ testId }) => <textarea data-testid={testId} readOnly /> }));
vi.mock("@/components/tls/AccessLinksPanel", () => ({ AccessLinksPanel: () => null }));
vi.mock("@/components/tls/EventBillingSection", () => ({ EventBillingSection: () => null }));
vi.mock("@/components/tls/RichContent", () => ({ appendEmbedToken: (text) => text }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ can: () => false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
const confirmMock = vi.fn(async () => true);
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));

const AdminEventEditPage = (await import("./AdminEventEditPage")).default;
const { toast } = await import("sonner");

const META = {
  types: [{ k: "general", l: "Allgemein" }],
  statuses: [{ k: "scheduled", l: "Angekündigt" }, { k: "cancelled", l: "Abgesagt" }],
  visibilities: [{ k: "public", l: "Öffentlich" }],
};
const DEADLINE = "2026-12-18T17:00:00+00:00";
const PROPOSAL = "Zu wenige Anmeldungen: Bis Fr 18.12. 18:00 waren 5 von mindestens 8 Personen dabei.";
const BASE = {
  id: "ev-1", name: "Silvester im Vereinsheim", slug: "silvester", status: "scheduled", event_type: "general", visibility: "public",
  start_date: "2026-12-31T17:00:00Z", has_registration: true, allow_companions: true, max_companions_per_registration: 3, active_registration_count: 4,
};
const WITH_MINIMUM = {
  ...BASE,
  min_registrations: { count: 8, deadline: DEADLINE, count_companions: true, public: true },
  min_registrations_notice: { deadline: DEADLINE, at: "2026-12-18T17:15:00+00:00", have: 5, count: 8 },
  minimum: { count: 8, have: 5, missing: 3, companions: 1, deadline: DEADLINE, count_companions: true, public: true, deadline_passed: true, state: "short", proposal: PROPOSAL },
};

function serve(event) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/meta") return { data: META };
    if (url === "/admin/events/ev-1") return { data: event };
    return { data: [] };
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/events/ev-1"]}>
      <Routes>
        <Route path="/admin/events" element={<div data-testid="events-list" />} />
        <Route path="/admin/events/:id" element={<AdminEventEditPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.patch.mockReset();
  confirmMock.mockClear();
  toast.error.mockClear();
});

test("Stand vom Server: Schild, Satz, Hinweis an die Leitung und der Vorschlag", async () => {
  serve(WITH_MINIMUM);
  renderPage();
  expect(await screen.findByTestId("event-minimum-enabled")).toBeChecked();
  expect(screen.getByTestId("event-minimum-count")).toHaveValue(8);
  expect(screen.getByTestId("event-minimum-companions")).toBeChecked();
  expect(screen.getByTestId("event-minimum-chip")).toHaveAttribute("data-kind", "problem");
  expect(screen.getByTestId("event-minimum-chip")).toHaveTextContent("Zu wenige");
  expect(screen.getByTestId("event-minimum-summary")).toHaveTextContent("5 von 8 Personen (davon 1 Begleitperson) · Frist war");
  expect(screen.getByTestId("event-minimum-notice")).toHaveTextContent("Hinweis an die Turnierleitung verschickt");
  expect(screen.getByTestId("event-minimum-proposal")).toHaveClass("text-warn");
});

test("„Event absagen …“: ein Schritt mit dem Vorschlag als Grund - nur die Absage geht hinaus", async () => {
  serve(WITH_MINIMUM);
  apiMock.patch.mockResolvedValue({ data: { ...WITH_MINIMUM, status: "cancelled", cancellation: { registrations: 4, notified: 4, orders: 0 } } });
  renderPage();
  fireEvent.click(await screen.findByTestId("event-minimum-cancel"));
  const sheet = screen.getByTestId("event-cancel-sheet");
  expect(within(sheet).getByTestId("event-cancel-reason")).toHaveValue(PROPOSAL);
  expect(within(sheet).getByTestId("event-cancel-consequences")).toHaveTextContent("4 Anmeldungen (samt Warteliste) werden storniert");
  fireEvent.submit(sheet);
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/events/ev-1", { status: "cancelled", cancel_reason: PROPOSAL }));
  expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("4 Personen benachrichtigt"));
  expect(await screen.findByTestId("events-list")).toBeInTheDocument();
  expect(confirmMock).not.toHaveBeenCalled();
});

test("ohne Grund wird nicht abgesagt; Fehler des Servers stehen im Blatt in Warnfarbe", async () => {
  serve(WITH_MINIMUM);
  apiMock.patch.mockRejectedValue({ response: { data: { detail: "Gerade ist viel los." } } });
  renderPage();
  fireEvent.click(await screen.findByTestId("event-minimum-cancel"));
  fireEvent.change(screen.getByTestId("event-cancel-reason"), { target: { value: "kurz" } });
  fireEvent.submit(screen.getByTestId("event-cancel-sheet"));
  expect(await screen.findByTestId("event-cancel-problem")).toHaveTextContent("mindestens 5 Zeichen");
  expect(apiMock.patch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("event-cancel-reason"), { target: { value: "Schnee fehlt, Rodeln fällt aus" } });
  fireEvent.submit(screen.getByTestId("event-cancel-sheet"));
  expect(await screen.findByText("Gerade ist viel los.")).toHaveClass("text-warn");
});

test("Status „Abgesagt“ beim Speichern: mit Mindestanzahl öffnet sich das Blatt, die Änderungen gehen mit", async () => {
  serve(WITH_MINIMUM);
  apiMock.patch.mockResolvedValue({ data: { ...WITH_MINIMUM, status: "cancelled" } });
  renderPage();
  fireEvent.change(await screen.findByTestId("event-status"), { target: { value: "cancelled" } });
  fireEvent.submit(screen.getByTestId("event-form"));
  const sheet = await screen.findByTestId("event-cancel-sheet");
  fireEvent.change(within(sheet).getByTestId("event-cancel-reason"), { target: { value: "Zu wenige Anmeldungen bis zur Frist" } });
  fireEvent.submit(sheet);
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/events/ev-1", { status: "cancelled", cancel_reason: "Zu wenige Anmeldungen bis zur Frist" }));
  expect(confirmMock).not.toHaveBeenCalled();
});

test("ohne Mindestanzahl bleibt die Absage wie bisher: Rückfrage ohne Grund", async () => {
  serve(BASE);
  apiMock.patch.mockResolvedValue({ data: { ...BASE, status: "cancelled" } });
  renderPage();
  expect(await screen.findByTestId("event-minimum-enabled")).not.toBeChecked();
  expect(screen.queryByTestId("event-minimum-state")).toBeNull();
  fireEvent.change(screen.getByTestId("event-status"), { target: { value: "cancelled" } });
  fireEvent.submit(screen.getByTestId("event-form"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/events/ev-1", { status: "cancelled" }));
  expect(confirmMock).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("event-cancel-sheet")).toBeNull();
});

test("Mindestanzahl einschalten: Prüfung vor dem Speichern, dann geht die Einstellung mit", async () => {
  serve(BASE);
  apiMock.patch.mockResolvedValue({ data: BASE });
  renderPage();
  fireEvent.click(await screen.findByTestId("event-minimum-enabled"));
  fireEvent.change(screen.getByTestId("event-minimum-count"), { target: { value: "8" } });
  fireEvent.change(screen.getByTestId("event-minimum-deadline"), { target: { value: "2027-01-02T18:00" } });
  fireEvent.submit(screen.getByTestId("event-form"));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Mindestanzahl: Die Frist muss vor dem Beginn des Events liegen."));
  expect(apiMock.patch).not.toHaveBeenCalled();

  fireEvent.change(screen.getByTestId("event-minimum-deadline"), { target: { value: "2026-12-18T18:00" } });
  fireEvent.click(screen.getByTestId("event-minimum-public"));
  fireEvent.submit(screen.getByTestId("event-form"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  const [, patch] = apiMock.patch.mock.calls[0];
  expect(patch).toEqual({ min_registrations: { count: 8, deadline: new Date("2026-12-18T18:00").toISOString(), count_companions: true, public: false } });
});

test("andere ungespeicherte Änderungen: „Event absagen …“ wartet, bis gespeichert ist", async () => {
  serve(WITH_MINIMUM);
  renderPage();
  fireEvent.change(await screen.findByTestId("event-name"), { target: { value: "Silvester 2026" } });
  expect(screen.getByTestId("event-minimum-cancel")).toBeDisabled();
});
