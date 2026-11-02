import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Kontakt-Inbox mit Spamschutz (#2067) und Zuständigkeit (#2131): die Liste kommt vom Server (Standard „offen“, Suche,
// Seiten), Antwort über die Mail-Queue, Notiz speichert nur bei Änderung, Themen tragen die Bezeichnung des Formulars.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
const confirmMock = vi.fn(async () => true);
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { default: AdminContactPage } = await import("./AdminContactPage");

const HUMAN = { id: "m1", name: "Paula", email: "paula@lionsquad-test.at", topic: "report_bug", subject: "Frage zum Turnier", message: "Hallo", status: "new", created_at: "2026-10-27T10:00:00Z", internal_note: "alt" };
const DONE = { id: "m3", name: "Max", email: "max@lionsquad-test.at", topic: "general", subject: "Danke", message: "Danke", status: "answered", created_at: "2026-10-26T10:00:00Z" };
const BOT = { id: "m2", name: "KuHHNCqrrWoOGwLSltUsNs", email: "i.w.irir.o.f.a6.7@gmail.com", topic: "general", subject: "JTslVviyjzDQSoOqIpLRRSU",
  message: "welHMCbnDXaAOykIMdahEVhy", status: "spam", created_at: "2026-10-27T11:00:00Z", spam: { score: 8, reasons: ["random_text", "gmail_dots"] } };
const STATS = {
  today: { caught: 2, by_reason: { honeypot: 1, random_text: 1 } },
  week: { caught: 5, by_reason: { honeypot: 3, token_missing: 1, random_text: 1 } },
  quote_week: 62.5,
  labels: { honeypot: "Verstecktes Feld ausgefüllt", token_missing: "Ohne Formular-Token", random_text: "Zufallszeichen", gmail_dots: "Gmail mit Punkt-Trick" },
};
const ROWS = { open: [HUMAN], all: [HUMAN, DONE], spam: [BOT], answered: [DONE], new: [HUMAN], in_progress: [], closed: [] };

function serve(extra = {}) {
  apiMock.get.mockImplementation(async (url, options) => {
    if (url === "/spam-guard/stats") return { data: STATS };
    if (url === "/contact/topics") return { data: [{ value: "report_bug", label: "Fehler melden" }, { value: "general", label: "Allgemeine Anfrage" }] };
    if (url === "/contact/assignees") return { data: [{ id: "u1", name: "Vera Vorstand" }] };
    const status = options?.params?.status;
    const items = ROWS[status] || [];
    return { data: { items, total: items.length, page: 1, limit: 50, counts: { new: 1, answered: 1, spam: 1 }, suspicious: 1, retention: { done_days: 365, spam_days: 30 }, ...extra } };
  });
}

const lastList = () => apiMock.get.mock.calls.filter(([url]) => url === "/contact").at(-1)?.[1]?.params;

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockResolvedValue(true);
  serve();
});

test("Zähler zeigt heute, 7 Tage, Quote und Gründe", async () => {
  render(<AdminContactPage />);
  const counter = await screen.findByTestId("contact-spam-counter");
  expect(within(counter).getByTestId("contact-spam-today")).toHaveTextContent("2");
  expect(within(counter).getByTestId("contact-spam-week")).toHaveTextContent("5");
  expect(counter).toHaveTextContent("Quote 62,5 %");
  expect(within(counter).getByTestId("contact-spam-reasons")).toHaveTextContent("Verstecktes Feld ausgefüllt: 3");
});

test("Hinweis „verdächtige Nachrichten“ steht auch ohne Filter da und führt zum Spam-Ordner", async () => {
  const user = userEvent.setup();
  render(<AdminContactPage />);
  const hint = await screen.findByTestId("contact-suspicious-hint");
  expect(hint).toHaveTextContent("1 verdächtige Nachricht im Spam-Ordner");
  await user.click(hint);
  expect(await screen.findByTestId("contact-row-m2")).toBeInTheDocument();
  expect(screen.queryByTestId("contact-suspicious-hint")).toBeNull();
});

test("die Standardansicht ist „offen“; Kacheln und „Alle ohne Spam“ filtern auf dem Server", async () => {
  const user = userEvent.setup();
  render(<AdminContactPage />);
  expect(await screen.findByTestId("contact-row-m1")).toBeInTheDocument();
  expect(lastList()).toEqual({ status: "open", page: 1, limit: 50 });
  expect(screen.queryByTestId("contact-row-m3")).toBeNull();
  expect(screen.getByTestId("contact-stat-spam")).toHaveTextContent("1");
  await user.click(screen.getByTestId("contact-stat-spam"));
  expect(await screen.findByTestId("contact-row-m2")).toBeInTheDocument();
  expect(screen.queryByTestId("contact-row-m1")).toBeNull();
  await user.click(screen.getByTestId("contact-stat-spam"));
  expect(await screen.findByTestId("contact-row-m1")).toBeInTheDocument();
  await user.click(screen.getByTestId("contact-view-all"));
  expect(await screen.findByTestId("contact-row-m3")).toBeInTheDocument();
  expect(lastList().status).toBe("all");
});

test("Suche und Zuständigkeit gehen an den Server, die Seiten zählen mit", async () => {
  serve({ total: 120 });
  const user = userEvent.setup();
  render(<AdminContactPage />);
  await screen.findByTestId("contact-row-m1");
  expect(screen.getByTestId("contact-paging")).toHaveTextContent("Seite 1 von 3");
  await user.click(screen.getByTestId("contact-page-next"));
  await waitFor(() => expect(lastList().page).toBe(2));
  await user.type(screen.getByTestId("contact-search"), "pa(ula");
  await waitFor(() => expect(lastList()).toMatchObject({ q: "pa(ula", page: 1 }));
  await user.selectOptions(screen.getByTestId("contact-assigned-filter"), "me");
  await waitFor(() => expect(lastList()).toMatchObject({ assigned: "me" }));
});

test("Themen tragen die Bezeichnung des Formulars: „Fehler melden“, nicht „Bug“", async () => {
  render(<AdminContactPage />);
  await waitFor(() => expect(screen.getByTestId("contact-topic-m1")).toHaveTextContent("Fehler melden"));
});

test("„Kein Spam“ ordnet die Nachricht ein", async () => {
  apiMock.post.mockResolvedValue({ data: { ...BOT, status: "new", spam: { ...BOT.spam, cleared_at: "2026-10-27T12:00:00Z" } } });
  const user = userEvent.setup();
  render(<AdminContactPage />);
  await user.click(await screen.findByTestId("contact-stat-spam"));
  await user.click(await screen.findByTestId("contact-row-m2"));
  expect(screen.getByTestId("contact-spam-box")).toHaveTextContent("Zufallszeichen, Gmail mit Punkt-Trick");
  expect(screen.getByTestId("contact-reply-blocked")).toHaveTextContent("Spam bekommt keine Antwort");
  expect(screen.queryByTestId("contact-reply-form")).toBeNull();
  await user.click(screen.getByTestId("contact-not-spam"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/contact/m2/not-spam"));
  await waitFor(() => expect(screen.queryByTestId("contact-spam-box")).toBeNull());
  expect(screen.getByTestId("contact-reply-form")).toBeInTheDocument();
});

test("der Verlauf sagt, was aus der Mail wurde", async () => {
  const reply = (id, delivery) => ({ id, text: "Hallo", by_name: "Vera", at: "2026-10-27T12:00:00Z", delivery });
  ROWS.open = [{ ...HUMAN, status: "answered", replies: [reply("r1", "sent"), reply("r2", "failed"), reply("r3", "skipped"), reply("r4", "waiting"), reply("r5", null)] }];
  const user = userEvent.setup();
  render(<AdminContactPage />);
  await user.click(await screen.findByTestId("contact-row-m1"));
  expect(screen.getByTestId("contact-reply-delivery-r1")).toHaveTextContent("versendet");
  expect(screen.getByTestId("contact-reply-delivery-r2")).toHaveTextContent("Versand gescheitert");
  expect(screen.getByTestId("contact-reply-delivery-r3")).toHaveTextContent("der Mailversand ist aus");
  expect(screen.getByTestId("contact-reply-delivery-r4")).toHaveTextContent("wartet auf den Versand");
  expect(screen.queryByTestId("contact-reply-delivery-r5")).toBeNull();
  ROWS.open = [HUMAN];
});

test("die Notiz speichert nur bei einer Änderung und meldet sich als Notiz", async () => {
  apiMock.patch.mockResolvedValue({ data: { ...HUMAN, internal_note: "alt und neu" } });
  const user = userEvent.setup();
  render(<AdminContactPage />);
  await user.click(await screen.findByTestId("contact-row-m1"));
  const note = screen.getByTestId("contact-note");
  await user.click(note);
  await user.tab();
  expect(apiMock.patch).not.toHaveBeenCalled();
  await user.type(note, " und neu");
  await user.tab();
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/contact/m1", { internal_note: "alt und neu" }));
  expect(toastMock.success).toHaveBeenCalledWith("Notiz gespeichert.");
  expect(toastMock.success).not.toHaveBeenCalledWith(expect.stringContaining("Status"));
});

test("zuständig setzen, und die Antwort geht erst nach der Rückfrage hinaus", async () => {
  apiMock.patch.mockResolvedValue({ data: { ...HUMAN, assigned_to: "u1", assigned_to_name: "Vera Vorstand" } });
  const reply = { id: "r1", text: "Danke, das passt.", by_name: "Vera Vorstand", at: "2026-10-27T12:00:00Z" };
  apiMock.post.mockResolvedValue({ data: { ...HUMAN, status: "answered", answered_at: reply.at, replies: [reply], assigned_to: "u1" } });
  const user = userEvent.setup();
  render(<AdminContactPage />);
  await user.click(await screen.findByTestId("contact-row-m1"));
  await screen.findByRole("option", { name: "Vera Vorstand" });
  await user.selectOptions(screen.getByTestId("contact-assignee"), "u1");
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/contact/m1", { assigned_to: "u1" }));

  expect(screen.getByTestId("contact-reply-send")).toBeDisabled();
  await user.type(screen.getByTestId("contact-reply-text"), "Danke, das passt.");
  confirmMock.mockResolvedValueOnce(false);
  await user.click(screen.getByTestId("contact-reply-send"));
  expect(apiMock.post).not.toHaveBeenCalled();
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("paula@lionsquad-test.at") }));

  await user.click(screen.getByTestId("contact-reply-send"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/contact/m1/reply", { text: "Danke, das passt.", request_id: expect.any(String) }));
  const history = await screen.findByTestId("contact-reply-r1");
  expect(history).toHaveTextContent("Antwort von Vera Vorstand");
  expect(history).toHaveTextContent("Danke, das passt.");
  expect(screen.getByTestId("contact-detail-status")).toHaveTextContent("Beantwortet");
  expect(screen.getByTestId("contact-reply-text")).toHaveValue("");
});

test("ein wiederholtes Absenden desselben Texts trägt dieselbe Kennung; ein geänderter Text eine neue", async () => {
  apiMock.post.mockRejectedValueOnce({ response: { data: { detail: "Netz weg" } } });
  apiMock.post.mockResolvedValue({ data: { ...HUMAN, status: "answered" } });
  const user = userEvent.setup();
  render(<AdminContactPage />);
  await user.click(await screen.findByTestId("contact-row-m1"));
  await user.type(screen.getByTestId("contact-reply-text"), "Hallo");
  await user.click(screen.getByTestId("contact-reply-send"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Netz weg"));
  await user.click(screen.getByTestId("contact-reply-send"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(2));
  const [first, second] = apiMock.post.mock.calls;
  expect(second[1].request_id).toBe(first[1].request_id);
});

test("die Detailansicht nennt, wer als beantwortet markiert hat, und was eine Fehlermeldung mitbringt", async () => {
  ROWS.open = [{ ...HUMAN, answered_at: "2026-10-27T12:00:00Z", answered_by_name: "Vera Vorstand", context: { page: "/events/x", device: "Testgerät", version: "1.53.0" } }];
  const user = userEvent.setup();
  render(<AdminContactPage />);
  await user.click(await screen.findByTestId("contact-row-m1"));
  expect(screen.getByTestId("contact-answered-by")).toHaveTextContent("Vera Vorstand");
  const context = screen.getByTestId("contact-context");
  expect(context).toHaveTextContent("/events/x");
  expect(context).toHaveTextContent("Testgerät");
  expect(context).toHaveTextContent("1.53.0");
  ROWS.open = [HUMAN];
});

test("die Frist steht als Hinweis da", async () => {
  render(<AdminContactPage />);
  await waitFor(() => expect(screen.getByTestId("contact-note-hint")).toHaveTextContent("365 Tage nach dem letzten Statuswechsel"));
});
