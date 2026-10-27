import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Kontakt-Inbox mit Spamschutz (#2067): Zähler „abgefangen heute / 7 Tage“ mit Gründen, Spam bleibt aus der
// Standardansicht, der Filter „Spam“ zeigt ihn, „Kein Spam“ ordnet ein und holt die Mails nach.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: AdminContactPage } = await import("./AdminContactPage");

const HUMAN = { id: "m1", name: "Paula", email: "paula@lionsquad-test.at", topic: "general", subject: "Frage zum Turnier", message: "Hallo", status: "new", created_at: "2026-10-27T10:00:00Z" };
const BOT = { id: "m2", name: "KuHHNCqrrWoOGwLSltUsNs", email: "i.w.irir.o.f.a6.7@gmail.com", topic: "general", subject: "JTslVviyjzDQSoOqIpLRRSU",
  message: "welHMCbnDXaAOykIMdahEVhy", status: "spam", created_at: "2026-10-27T11:00:00Z", spam: { score: 8, reasons: ["random_text", "gmail_dots"] } };
const STATS = {
  today: { caught: 2, by_reason: { honeypot: 1, random_text: 1 } },
  week: { caught: 5, by_reason: { honeypot: 3, token_missing: 1, random_text: 1 } },
  quote_week: 62.5,
  labels: { honeypot: "Verstecktes Feld ausgefüllt", token_missing: "Ohne Formular-Token", random_text: "Zufallszeichen", gmail_dots: "Gmail mit Punkt-Trick" },
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation(async (url) => (url === "/spam-guard/stats" ? { data: STATS } : { data: [HUMAN, BOT] }));
});

test("Zähler zeigt heute, 7 Tage, Quote und Gründe", async () => {
  render(<AdminContactPage />);
  const counter = await screen.findByTestId("contact-spam-counter");
  expect(within(counter).getByTestId("contact-spam-today")).toHaveTextContent("2");
  expect(within(counter).getByTestId("contact-spam-week")).toHaveTextContent("5");
  expect(counter).toHaveTextContent("Quote 62,5 %");
  expect(within(counter).getByTestId("contact-spam-reasons")).toHaveTextContent("Verstecktes Feld ausgefüllt: 3");
});

test("Spam bleibt aus der Standardansicht, der Filter „Spam“ zeigt ihn", async () => {
  const user = userEvent.setup();
  render(<AdminContactPage />);
  expect(await screen.findByTestId("contact-row-m1")).toBeInTheDocument();
  expect(screen.queryByTestId("contact-row-m2")).toBeNull();
  expect(screen.getByTestId("contact-stat-spam")).toHaveTextContent("1");
  await user.click(screen.getByTestId("contact-stat-spam"));
  expect(await screen.findByTestId("contact-row-m2")).toBeInTheDocument();
  expect(screen.queryByTestId("contact-row-m1")).toBeNull();
});

test("„Kein Spam“ ordnet die Nachricht ein", async () => {
  apiMock.post.mockResolvedValue({ data: { ...BOT, status: "new", spam: { ...BOT.spam, cleared_at: "2026-10-27T12:00:00Z" } } });
  const user = userEvent.setup();
  render(<AdminContactPage />);
  await user.click(await screen.findByTestId("contact-stat-spam"));
  await user.click(await screen.findByTestId("contact-row-m2"));
  expect(screen.getByTestId("contact-spam-box")).toHaveTextContent("Zufallszeichen, Gmail mit Punkt-Trick");
  await user.click(screen.getByTestId("contact-not-spam"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/contact/m2/not-spam"));
  await waitFor(() => expect(screen.queryByTestId("contact-spam-box")).toBeNull());
});
