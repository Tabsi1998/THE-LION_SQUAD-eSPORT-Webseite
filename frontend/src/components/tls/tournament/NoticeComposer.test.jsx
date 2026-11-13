import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Reiter „Hinweis“ der Turnierleitung (#1166): Vorlagen, Zähler bis 140, Ziel, Dauer, TV-Haken, dieselbe Kennung beim
// neuen Versuch, „Pause bis“ gleich mitsetzen und das Protokoll mit „Entfernen“. Namen sind erfunden.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API_BASE: "", formatApiError: (value) => value }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const confirmMock = vi.fn(async () => true);
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
const { NoticeComposer } = await import("./NoticeComposer");
const { toast } = await import("sonner");

const LIST = {
  can_target_event: false,
  event_id: "ev1",
  items: [
    {
      id: "tn-1", text: "Bitte zum Check-in", created_at: new Date(Date.now() - 600000).toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(), target: "tournament", target_label: "Alle im Turnier", tv: true,
      recipients: 12, processed: 12, delivered: 11, state: "sent", active: true, author: "Schiri Sam", can_remove: true,
    },
    {
      id: "tn-0", text: "Willkommen", created_at: "2026-11-14T08:00:00Z", expires_at: "2026-11-14T10:00:00Z", target: "event",
      target_label: "Alle im Event", tv: false, recipients: 40, processed: 40, delivered: 40, state: "sent", active: false,
      author: "Orga Olli", removed_at: "2026-11-14T09:00:00Z", removed_by: "Orga Olli", can_remove: false,
    },
  ],
};

function setup(tournament = {}) {
  apiMock.get.mockResolvedValue({ data: LIST });
  apiMock.post.mockImplementation(async (url) => (url.endsWith("/preview")
    ? { data: { recipients: 12 } }
    : { data: { recipients: 12, delivered: 0, state: "sending", replay: false } }));
  render(<NoticeComposer slug="lan-cup" tournament={{ id: "t1", event_id: "ev1", status: "live", can_pause: true, ...tournament }} stations={[{ id: "s1", name: "PC 3" }]} />);
}

afterEach(() => {
  Object.values(apiMock).forEach((fn) => fn.mockReset());
  confirmMock.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
});

it("füllt Vorlagen ein, zählt bis 140 und nennt die Empfänger", async () => {
  setup();
  await waitFor(() => expect(screen.getByTestId("notice-recipients").textContent).toMatch(/Geht an 12 Personen/));
  fireEvent.click(screen.getByTestId("notice-template-final"));
  expect(screen.getByTestId("notice-text-input")).toHaveValue("Finale an PC 3");
  expect(screen.getByTestId("notice-count").textContent).toBe("14/140");
  expect(screen.getByTestId("notice-text-input")).toHaveAttribute("maxLength", "140");
  fireEvent.click(screen.getByTestId("notice-template-pause"));
  expect(screen.getByTestId("notice-text-input").value).toMatch(/^Pause bis \d{2}:\d{2}$/);
  // „Pause bis“ schlägt den TV vor.
  expect(screen.getByTestId("notice-tv")).toBeChecked();
  // Ohne Recht für alle Turniere des Events bleibt „Ganzes Event“ zu.
  expect(screen.getByTestId("notice-target-event")).toBeDisabled();
  expect(screen.getByTestId("notice-duration-120")).toHaveAttribute("aria-pressed", "true");
});

it("schickt Text, Ziel, Dauer und TV - beim neuen Versuch mit derselben Kennung", async () => {
  setup();
  await screen.findByTestId("notice-log-tn-1");
  fireEvent.change(screen.getByTestId("notice-text-input"), { target: { value: "Finale an PC 1" } });
  fireEvent.click(screen.getByTestId("notice-duration-30"));
  fireEvent.click(screen.getByTestId("notice-tv"));
  apiMock.post.mockImplementationOnce(async () => { throw { response: { data: { detail: "Netz weg" } } }; });
  fireEvent.click(screen.getByTestId("notice-send"));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Netz weg"));
  fireEvent.click(screen.getByTestId("notice-send"));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Hinweis gesendet – geht an 12 Personen."));
  const sends = apiMock.post.mock.calls.filter(([url]) => url === "/tournaments/lan-cup/lead/notices");
  expect(sends).toHaveLength(2);
  expect(sends[0][1]).toEqual(expect.objectContaining({ text: "Finale an PC 1", target: "tournament", show_on_tv: true, duration_minutes: 30 }));
  expect(sends[1][1].request_id).toBe(sends[0][1].request_id);
  expect(screen.getByTestId("notice-text-input")).toHaveValue("");
});

it("setzt auf Wunsch gleich „Pause bis“ - ein laufendes Turnier wird pausiert", async () => {
  setup({ status: "live" });
  await screen.findByTestId("notice-log-tn-1");
  fireEvent.change(screen.getByTestId("notice-text-input"), { target: { value: "Pause bis 14:30" } });
  fireEvent.click(screen.getByTestId("notice-pause"));
  fireEvent.click(screen.getByTestId("notice-send"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/status", expect.objectContaining({ status: "paused" })));
  const body = apiMock.post.mock.calls.find(([url]) => url === "/tournaments/t1/status")[1];
  expect(body.paused_until).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:30:00\.000Z$/);
});

it("ändert bei einem pausierten Turnier nur die Uhrzeit - und ohne Recht gibt es den Haken nicht", async () => {
  setup({ status: "paused" });
  await screen.findByTestId("notice-log-tn-1");
  fireEvent.change(screen.getByTestId("notice-text-input"), { target: { value: "Pause bis 15:00" } });
  fireEvent.click(screen.getByTestId("notice-pause"));
  fireEvent.click(screen.getByTestId("notice-send"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/tournaments/t1/pause", expect.objectContaining({ paused_until: expect.any(String) })));
});

it("ohne Recht auf den Status fehlt der Pause-Haken", async () => {
  setup({ can_pause: false });
  await screen.findByTestId("notice-log-tn-1");
  fireEvent.change(screen.getByTestId("notice-text-input"), { target: { value: "Pause bis 15:00" } });
  expect(screen.queryByTestId("notice-pause")).toBeNull();
});

it("zeigt das Protokoll und entfernt nach Rückfrage", async () => {
  setup();
  const row = await screen.findByTestId("notice-log-tn-1");
  expect(within(row).getByText(/Schiri Sam · Alle im Turnier · am TV/)).toBeInTheDocument();
  expect(within(row).getByTestId("notice-delivery-tn-1").textContent).toBe("an 12 Personen · 11 benachrichtigt");
  const old = screen.getByTestId("notice-log-tn-0");
  expect(within(old).getByText("entfernt von Orga Olli")).toBeInTheDocument();
  expect(within(old).queryByRole("button")).toBeNull();
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
  fireEvent.click(within(row).getByTestId("notice-remove-tn-1"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/tournaments/lan-cup/lead/notices/tn-1"));
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Hinweis entfernen?" }));
});

it("schickt nichts unter drei Zeichen", async () => {
  setup();
  await screen.findByTestId("notice-log-tn-1");
  fireEvent.change(screen.getByTestId("notice-text-input"), { target: { value: "ok" } });
  expect(screen.getByTestId("notice-send")).toBeDisabled();
});
