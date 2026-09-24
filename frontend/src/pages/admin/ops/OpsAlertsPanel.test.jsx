import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Alarme (#517): Regeln je Ereignisart, Empfänger, Sperrfrist, Aufbewahrung, Testalarm, Verlauf.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { OpsAlertsPanel } = await import("./OpsAlertsPanel");

const VIEW = {
  settings: { emails: ["vorstand@example.test"], cooldown_minutes: 60, rules: { check_red: { discord: true, email: false }, mail_failed: { discord: true, email: false } }, retention_days: { email_logs: 90, audit_logs: 730 } },
  kinds: [
    { key: "check_red", label: "Auto-Check rot", hint: "Eine Prüfung steht auf rot.", email_allowed: true },
    { key: "mail_failed", label: "Mail nicht zustellbar", hint: "Endgültig fehlgeschlagen.", email_allowed: false },
  ],
  recent: [{ id: "a1", kind: "check_red", title: "Betrieb: Datenbank ist rot", description: "keine Antwort", channels: ["discord"], at: "2026-09-25T10:00:00+00:00" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: VIEW });
});

test("zeigt Regeln, Empfänger und Verlauf; Speichern schickt alles, Mail bei Versandfehler bleibt gesperrt", async () => {
  apiMock.put.mockResolvedValue({ data: { ...VIEW.settings, emails: ["vorstand@example.test", "kassier@example.test"], rules: { ...VIEW.settings.rules, check_red: { discord: true, email: true } } } });
  const user = userEvent.setup();
  render(<OpsAlertsPanel />);
  expect(await screen.findByTestId("ops-alerts")).toBeInTheDocument();
  expect(screen.getByTestId("ops-alert-recent")).toHaveTextContent("Betrieb: Datenbank ist rot");
  expect(screen.getByTestId("ops-alert-mail_failed-email")).toBeDisabled();
  await user.click(screen.getByTestId("ops-alert-check_red-email"));
  await user.type(screen.getByTestId("ops-alert-emails"), ", kassier@example.test");
  await user.clear(screen.getByTestId("ops-retention-email_logs"));
  await user.type(screen.getByTestId("ops-retention-email_logs"), "30");
  await user.click(screen.getByTestId("ops-alert-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/ops/alerts", expect.objectContaining({
    emails: "vorstand@example.test, kassier@example.test", cooldown_minutes: 60,
    rules: expect.objectContaining({ check_red: { discord: true, email: true } }), retention_days: { email_logs: 30, audit_logs: 730 },
  })));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Alarme gespeichert."));
  expect(screen.getByTestId("ops-alert-emails")).toHaveValue("vorstand@example.test, kassier@example.test");
});

test("der Testalarm nennt die Wege - und sagt, wenn keiner eingerichtet ist", async () => {
  apiMock.post.mockResolvedValueOnce({ data: { sent: true, channels: ["discord", "email"], emails: ["vorstand@example.test"] } });
  const user = userEvent.setup();
  render(<OpsAlertsPanel />);
  await screen.findByTestId("ops-alerts");
  await user.click(screen.getByTestId("ops-alert-test"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Testalarm raus per Discord und E-Mail."));
  apiMock.post.mockResolvedValueOnce({ data: { sent: false, channels: [], emails: [] } });
  await user.click(screen.getByTestId("ops-alert-test"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("Kein Weg eingerichtet")));
});
