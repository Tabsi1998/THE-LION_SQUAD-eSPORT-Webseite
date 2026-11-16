import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Ereignisse (#517 Teil 2): eine Liste über alle Quellen, Filter gehen an den Server, die Quelle steht in
// der Adresse (alte Seiten leiten mit ?source= hierher), der Audit-Schnellfilter erscheint nur bei Adminaktionen.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { error: vi.fn(), success: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (d) => String(d || "") }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { OpsEventsTab } = await import("./OpsEventsTab");
const { ConfirmDialogProvider } = await import("@/components/tls/ConfirmDialog");

// Quittieren (#2447) fragt über die Rückfrage der Seite nach - die steht in der App ganz außen.
const page = (path = "/admin/ops?tab=events") => <ConfirmDialogProvider><MemoryRouter initialEntries={[path]}><OpsEventsTab /></MemoryRouter></ConfirmDialogProvider>;

const PAYLOAD = {
  items: [
    { id: "e1", source: "server", source_label: "Serverfehler", href: "/admin/ops?tab=errors", severity: "error", status: "offen", time: "2026-09-24T20:00:00Z", title: "KeyError · GET /api/teams/{team_id}", subtitle: "7× · HTTP 500", detail: "'team_id'" },
    { id: "e2", source: "audit", source_label: "Adminaktionen", href: "/admin/ops?tab=events&source=audit", severity: "info", status: "audit", time: "2026-09-24T19:00:00Z", title: "user.role.change", subtitle: "admin · u-1", detail: "" },
  ],
  sources: [
    { key: "server", label: "Serverfehler", total: 3, problem_count: 1, latest_at: "2026-09-24T20:00:00Z" },
    { key: "audit", label: "Adminaktionen", total: 40, problem_count: 0, latest_at: "2026-09-24T19:00:00Z" },
  ],
  summary: { shown: 2, problem_count: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: PAYLOAD });
});

test("zeigt Ereignisse aller Quellen, schickt Filter an den Server und hält die Quelle in der Adresse", async () => {
  const user = userEvent.setup();
  render(page("/admin/ops?tab=events"));
  expect(await screen.findByTestId("ops-event-server")).toHaveTextContent("KeyError");
  expect(screen.getByTestId("ops-event-audit")).toHaveTextContent("user.role.change");
  expect(screen.getByTestId("ops-events-problems")).toHaveTextContent("1 auffällige");
  expect(apiMock.get).toHaveBeenLastCalledWith("/admin/ops/events", { params: { source: "all", severity: "all", hours: 168, q: "", limit: 300 } });
  expect(screen.queryByTestId("ops-events-audit-quick")).toBeNull();

  await user.selectOptions(screen.getByTestId("ops-events-severity"), "problem");
  await waitFor(() => expect(apiMock.get).toHaveBeenLastCalledWith("/admin/ops/events", { params: expect.objectContaining({ severity: "problem" }) }));
  await user.click(screen.getByTestId("ops-events-source-audit"));
  await waitFor(() => expect(apiMock.get).toHaveBeenLastCalledWith("/admin/ops/events", { params: expect.objectContaining({ source: "audit" }) }));
  expect(screen.getByTestId("ops-events-audit-quick")).toBeInTheDocument();
});

test("die Quelle aus der Adresse gilt beim Laden (Umleitung der alten Audit-Seite)", async () => {
  render(page("/admin/ops?tab=events&source=email"));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/ops/events", { params: expect.objectContaining({ source: "email" }) }));
});

// Versand-Routing (#627): ab zwei Discord-Servern lässt sich das Protokoll nach Server filtern, sonst gibt es den Filter nicht.
test("Discord-Meldungen nach Server filtern, erst ab zwei Servern", async () => {
  const user = userEvent.setup();
  const { unmount } = render(page("/admin/ops?tab=events"));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(screen.queryByTestId("ops-events-guild")).toBeNull();
  unmount();

  apiMock.get.mockResolvedValue({ data: { ...PAYLOAD, guilds: [{ guild_id: "111", name: "LION (Hauptserver)" }, { guild_id: "222", name: "CoD-Server" }] } });
  render(page("/admin/ops?tab=events"));
  await user.selectOptions(await screen.findByTestId("ops-events-guild"), "222");
  await waitFor(() => expect(apiMock.get).toHaveBeenLastCalledWith("/admin/ops/events", { params: expect.objectContaining({ guild: "222" }) }));
});

// Erneut senden (#2112): fehlgeschlagene Discord-Meldungen mit gespeichertem Inhalt bekommen einen Knopf.
test("eine fehlgeschlagene Discord-Meldung lässt sich erneut senden", async () => {
  const user = userEvent.setup();
  const discord = { id: "d1", source: "email", source_label: "E-Mail-Versand", href: "/admin/ops?tab=events&source=email", severity: "error", status: "failed",
    time: "2026-09-24T21:00:00Z", title: "news", subtitle: "discord · LION", detail: "Missing Access", resendable: true };
  apiMock.get.mockResolvedValue({ data: { ...PAYLOAD, items: [discord, PAYLOAD.items[0]] } });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  render(page("/admin/ops?tab=events"));
  expect(screen.queryByTestId("ops-event-resend-e1")).toBeNull();
  await user.click(await screen.findByTestId("ops-event-resend-d1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/discord/resend/d1"));
  expect(toastMock.success).toHaveBeenCalledWith("Meldung erneut gesendet.");
  expect(apiMock.get).toHaveBeenCalledTimes(2);
});

test("klappt das erneute Senden nicht, steht der Grund in der Meldung", async () => {
  const user = userEvent.setup();
  apiMock.get.mockResolvedValue({ data: { ...PAYLOAD, items: [{ ...PAYLOAD.items[0], id: "d2", source: "email", resendable: true }] } });
  apiMock.post.mockResolvedValue({ data: { ok: false, error: "Der Bot darf in diesem Kanal nicht schreiben." } });
  render(page("/admin/ops?tab=events"));
  await user.click(await screen.findByTestId("ops-event-resend-d2"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Der Bot darf in diesem Kanal nicht schreiben."));
});

// Quittieren (#2447): „Quittierte zeigen“ und „Nur offene“ gehen an den Server und stehen in der Adresse; quittierte und
// von selbst erledigte Einträge sagen, von wem bzw. wann; „Alle quittieren“ gilt für die gewählte Quelle.
test("Quittierte zeigen und Nur offene schicken den Stand an den Server", async () => {
  const user = userEvent.setup();
  render(page());
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  await user.click(screen.getByTestId("ops-events-show-acked"));
  await waitFor(() => expect(apiMock.get).toHaveBeenLastCalledWith("/admin/ops/events", { params: expect.objectContaining({ state: "all" }) }));
  expect(screen.getByTestId("ops-events-show-acked")).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByTestId("ops-events-only-open"));
  await waitFor(() => expect(apiMock.get).toHaveBeenLastCalledWith("/admin/ops/events", { params: expect.objectContaining({ state: "open" }) }));
  expect(screen.getByTestId("ops-events-show-acked")).toHaveAttribute("aria-pressed", "false");
  await user.click(screen.getByTestId("ops-events-only-open"));
  await waitFor(() => expect(apiMock.get.mock.lastCall[1].params.state).toBeUndefined());
});

test("der Tipp auf eine Kachel kommt mit state=open an, leer heißt Alles erledigt", async () => {
  apiMock.get.mockResolvedValue({ data: { ...PAYLOAD, items: [], sources: PAYLOAD.sources.map((row) => ({ ...row, problem_count: 0 })) } });
  render(page("/admin/ops?tab=events&source=server&state=open"));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/ops/events", { params: expect.objectContaining({ source: "server", state: "open" }) }));
  expect(await screen.findByTestId("ops-events-empty")).toHaveTextContent("Alles erledigt");
  expect(screen.queryByTestId("ops-events-ack-all")).toBeNull();
});

test("quittierte und behobene Einträge sagen von wem bzw. wann, nur offene haben den Knopf", async () => {
  const acked = { ...PAYLOAD.items[0], id: "q1", ack_id: "f1", open: false, ackable: false, acknowledged_at: "2026-11-16T08:00:00Z", acknowledged_by: "Obmann" };
  const fixed = { id: "ep1", source: "checks", source_label: "Auto-Checks", severity: "warn", status: "warn", time: "2026-11-13T08:00:00Z", title: "Auto-Checks gelb",
    open: false, ackable: false, resolved_at: "2026-11-13T09:30:00Z", resolved_label: "behoben" };
  const open = { ...PAYLOAD.items[0], id: "o1", ack_id: "f2", open: true, ackable: true };
  apiMock.get.mockResolvedValue({ data: { ...PAYLOAD, items: [open, acked, fixed] } });
  render(page("/admin/ops?tab=events&state=all"));
  expect(await screen.findByTestId("ops-event-state-q1")).toHaveTextContent("Quittiert von Obmann · 16.11.2026");
  expect(screen.getByTestId("ops-event-state-ep1")).toHaveTextContent("Behoben um 13.11.2026");
  expect(screen.getByTestId("ops-event-ack-o1")).toBeInTheDocument();
  expect(screen.queryByTestId("ops-event-ack-q1")).toBeNull();
  expect(screen.queryByTestId("ops-event-ack-ep1")).toBeNull();
});

test("Alle quittieren nimmt genau die gezeigten offenen Einträge bis zum Stand der Liste", async () => {
  // Review #2447 (M2): Suche, Schwere, Server und Zeitraum gelten - geschickt werden die gezeigten Einträge mit `until`.
  const user = userEvent.setup();
  const one = { ...PAYLOAD.items[0], id: "o1", ack_id: "f1", open: true, ackable: true };
  const two = { ...PAYLOAD.items[0], id: "o2", source: "email", source_label: "E-Mail-Versand", ack_id: "m2", open: true, ackable: true };
  apiMock.get.mockResolvedValue({ data: { ...PAYLOAD, as_of: "2026-11-16T09:00:00+00:00", items: [one, two, PAYLOAD.items[1]] } });
  apiMock.post.mockResolvedValue({ data: { acknowledged: { server: 1 }, total: 1 } });
  render(page("/admin/ops?tab=events"));
  await user.type(screen.getByTestId("ops-events-search"), "KeyError");
  const button = await screen.findByTestId("ops-events-ack-all");
  expect(button).toHaveTextContent("Alle gezeigten quittieren (2)");
  await user.click(button);
  const dialog = await screen.findByTestId("confirm-dialog");
  expect(dialog).toHaveTextContent("2 gezeigte Einträge quittieren?");
  await user.click(within(dialog).getByTestId("confirm-dialog-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/ops/events/ack-all", {
    items: [{ source: "server", id: "f1" }, { source: "email", id: "m2" }], until: "2026-11-16T09:00:00+00:00",
  }));
  expect(toastMock.success).toHaveBeenCalledWith("1 von 2 quittiert – der Rest war schon erledigt oder ist seit dem Laden wieder aufgetreten.");
});

test("Nur offene lädt ohne Zeitgrenze, wie die Kacheln zählen", async () => {
  // Review #2447 (M1): Kachel und Liste zeigen dieselbe Menge - der Zeitraum gilt bei „Nur offene“ nicht.
  render(page("/admin/ops?tab=events&source=email&state=open"));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/ops/events", { params: expect.objectContaining({ source: "email", state: "open", hours: 0 }) }));
  expect(screen.getByTestId("ops-events-range")).toBeDisabled();
  expect(screen.getByTestId("ops-events-range")).toHaveValue("0");
});

test("ein Ladefehler zeigt Erneut laden statt Alles erledigt", async () => {
  // Review #2447 (N1)
  const user = userEvent.setup();
  apiMock.get.mockRejectedValueOnce({ response: { data: { detail: "Server weg" } } });
  render(page("/admin/ops?tab=events&state=open"));
  expect(await screen.findByTestId("ops-events-error")).toHaveTextContent("ließen sich nicht laden");
  expect(screen.queryByText(/Alles erledigt/)).toBeNull();
  await user.click(screen.getByRole("button", { name: /Erneut laden/ }));
  expect(await screen.findByTestId("ops-event-server")).toBeInTheDocument();
});

test("nach dem Quittieren steht der Fokus auf der nächsten Zeile", async () => {
  const user = userEvent.setup();
  const first = { ...PAYLOAD.items[0], id: "o1", ack_id: "f1", open: true, ackable: true };
  const second = { ...PAYLOAD.items[0], id: "o2", ack_id: "f2", open: true, ackable: true, title: "Zweiter" };
  apiMock.get.mockResolvedValue({ data: { ...PAYLOAD, items: [first, second] } });
  apiMock.post.mockImplementation(async () => {
    apiMock.get.mockResolvedValue({ data: { ...PAYLOAD, items: [second] } });
    return { data: { count: 1 } };
  });
  render(page("/admin/ops?tab=events&state=open"));
  await user.click(await screen.findByTestId("ops-event-ack-o1"));
  await waitFor(() => expect(document.activeElement?.dataset?.opsRow).toBe("server:o2"));
});
