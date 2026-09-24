import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// E-Mail-Vorlagen (#437 A): Liste nach Thema mit Zweck, Empfänger, Variablen; Bearbeiten mit Vorschau,
// Testmail und Zurücksetzen.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminEmailTemplatesPage = (await import("./AdminEmailTemplatesPage")).default;

const ROWS = [
  { key: "registration", name: "Willkommen nach der Registrierung", purpose: "Geht raus, sobald jemand ein Konto anlegt.", recipient: "das neue Konto", category: "account", category_label: "Konto und Anmeldung", vars: ["display_name"], source: "code", custom: false, editable: true, subject: null, html: null },
  { key: "membership_approve", name: "Bewerbung angenommen", purpose: "Der Vorstand hat die Bewerbung angenommen.", recipient: "der Bewerber", category: "membership", category_label: "Mitgliedschaft", vars: ["display_name"], source: "db", custom: true, editable: true, subject: "Willkommen im Rudel", html: "<p>Hallo {{display_name}}</p>" },
  { key: "ops_alert", name: "Betriebsalarm", purpose: "Alarm aus Betrieb → Alarme.", recipient: "Empfänger unter Betrieb → Alarme", category: "system", category_label: "System", vars: [], source: "code", custom: false, editable: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: ROWS });
  apiMock.post.mockImplementation(async (url, body) => {
    if (url.endsWith("/preview")) return { data: { subject: body?.subject ? `Entwurf: ${body.subject}` : "Willkommen bei THE LION SQUAD", html: body?.html || "<p>Hallo Paula</p>", source: body?.html ? "custom" : "code" } };
    if (url.endsWith("/test")) return { data: { ok: true, to: "admin@example.test" } };
    if (url.endsWith("/reset")) return { data: { ok: true, source: "db" } };
    return { data: {} };
  });
  apiMock.put.mockResolvedValue({ data: { override: true } });
});

test("Liste nach Thema mit Zweck, Empfänger und Variablen; fester Text ohne Bearbeiten; angepasst markiert", async () => {
  render(<MemoryRouter><AdminEmailTemplatesPage /></MemoryRouter>);
  expect(await screen.findByTestId("email-templates-group-account")).toHaveTextContent("Konto und Anmeldung");
  expect(screen.getByTestId("tpl-row-registration")).toHaveTextContent("Empfänger: das neue Konto · Variablen: {{display_name}}");
  expect(screen.getByTestId("tpl-custom-membership_approve")).toBeInTheDocument();
  expect(screen.queryByTestId("tpl-edit-ops_alert")).toBeNull();
  expect(screen.getByTestId("tpl-row-ops_alert")).toHaveTextContent("fester Text");
});

test("Bearbeiten: Vorschau lädt den Standard, Entwurf wird gespeichert, Testmail geht an mich", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AdminEmailTemplatesPage /></MemoryRouter>);
  await user.click(await screen.findByTestId("tpl-edit-registration"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/email-templates/registration/preview", {}));
  await waitFor(() => expect(screen.getByTestId("tpl-preview-subject")).toHaveTextContent("Willkommen bei THE LION SQUAD"));
  expect(screen.getByTestId("tpl-subject")).toHaveValue("Willkommen bei THE LION SQUAD");
  await user.clear(screen.getByTestId("tpl-subject"));
  await user.type(screen.getByTestId("tpl-subject"), "Servus Paula");
  await user.click(screen.getByTestId("tpl-preview"));
  await waitFor(() => expect(screen.getByTestId("tpl-preview-subject")).toHaveTextContent("Entwurf: Servus Paula"));
  await user.click(screen.getByTestId("tpl-test"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Testmail mit Beispieldaten an admin@example.test eingereiht."));
  await user.click(screen.getByTestId("tpl-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/email-templates/registration", expect.objectContaining({ subject: "Servus Paula" })));
  await waitFor(() => expect(screen.queryByTestId("tpl-editor")).toBeNull());
});

test("Zurücksetzen nur bei angepassten Vorlagen", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AdminEmailTemplatesPage /></MemoryRouter>);
  await user.click(await screen.findByTestId("tpl-edit-membership_approve"));
  await waitFor(() => expect(screen.getByTestId("tpl-reset")).not.toBeDisabled());
  await user.click(screen.getByTestId("tpl-reset"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/email-templates/membership_approve/reset"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Standard wiederhergestellt."));
});
