import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ConfirmDialogProvider } from "@/components/tls/ConfirmDialog";

// Diese Seite pflegt Mail-, Discord- und Branding-Zugaenge. Der wichtigste
// Punkt hier ist eine Sicherheitszusage aus der Dokumentation: ein leer
// gelassenes Secret-Feld darf gespeicherte Zugangsdaten NICHT ueberschreiben.
// Ginge das schief, wuerde ein harmloses Speichern der Absenderadresse in
// Produktion den SMTP- oder Resend-Zugang loeschen.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn() };

vi.mock("@/lib/api", () => ({
  api: apiMock,
  formatApiError: (detail) => String(detail || "Fehler"),
  formatRequestError: (error, fallback) => fallback || String(error),
  resolveMediaUrl: (value) => value || "",
}));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ isAdmin: true, isSuperadmin: false, user: { id: "admin-1" } }),
}));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/lib/brandingEvents", () => ({ setCachedBranding: vi.fn() }));
vi.mock("@/components/tls/AdminLayout", () => ({
  AdminLayout: ({ children }) => <div data-testid="admin-layout">{children}</div>,
}));
vi.mock("@/components/tls/ImageUpload", () => ({
  ImageUpload: () => <div data-testid="image-upload" />,
  useImageUploadBusy: () => false,
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminSettingsPage = (await import("./AdminSettingsPage")).default;

const EMAIL_SETTINGS = {
  enabled: true,
  sender_name: "THE LION SQUAD",
  sender_email: "noreply@lionsquad.at",
  reply_to_email: "office@lionsquad.at",
  resend_api_key_masked: "re_****abcd",
};

function responseFor(url) {
  const path = String(url);
  if (path.startsWith("/settings/email/logs")) return { data: [] };
  if (path.startsWith("/settings/email")) return { data: EMAIL_SETTINGS };
  if (path.startsWith("/settings/branding")) return { data: { club_name: "THE LION SQUAD" } };
  if (path.startsWith("/settings/discord")) return { data: { enabled: false } };
  if (path.startsWith("/settings/smtp")) return { data: { smtp_host: "192.168.2.106", smtp_pass_masked: "****" } };
  return { data: [] };
}

function renderPage() {
  return render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={["/admin/settings?tab=email"]}>
        <AdminSettingsPage />
      </MemoryRouter>
    </ConfirmDialogProvider>
  );
}

beforeEach(() => {
  apiMock.get.mockImplementation((url) => Promise.resolve(responseFor(url)));
  apiMock.put.mockResolvedValue({ data: {} });
  apiMock.post.mockResolvedValue({ data: {} });
});

async function waitForLoadedEmailTab() {
  await waitFor(() => expect(screen.getByTestId("email-sender-name")).toHaveValue("THE LION SQUAD"));
}

test("laedt die Mail-Einstellungen in die Felder", async () => {
  renderPage();

  await waitForLoadedEmailTab();
  expect(screen.getByTestId("email-sender-email")).toHaveValue("noreply@lionsquad.at");
  expect(screen.getByTestId("email-reply-to")).toHaveValue("office@lionsquad.at");
});

test("das Secret-Feld startet leer, damit der gespeicherte Key nicht im Browser landet", async () => {
  renderPage();
  await waitForLoadedEmailTab();

  expect(screen.getByTestId("email-api-key")).toHaveValue("");
});

test("ein leeres Secret-Feld ueberschreibt den gespeicherten Key nicht", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForLoadedEmailTab();

  await user.clear(screen.getByTestId("email-sender-name"));
  await user.type(screen.getByTestId("email-sender-name"), "TLS Turnierleitung");
  await user.click(screen.getByTestId("email-save"));

  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/email", expect.anything()));
  const [, payload] = apiMock.put.mock.calls.at(-1);
  expect(payload.sender_name).toBe("TLS Turnierleitung");
  expect("resend_api_key" in payload).toBe(false);
});

test("ein ausgefuelltes Secret-Feld wird dagegen gespeichert", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForLoadedEmailTab();

  await user.type(screen.getByTestId("email-api-key"), "re_neuer_key");
  await user.click(screen.getByTestId("email-save"));

  await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
  const [, payload] = apiMock.put.mock.calls.at(-1);
  expect(payload.resend_api_key).toBe("re_neuer_key");
});

test("nur geaenderte Felder werden geschickt", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForLoadedEmailTab();

  await user.clear(screen.getByTestId("email-reply-to"));
  await user.type(screen.getByTestId("email-reply-to"), "turniere@lionsquad.at");
  await user.click(screen.getByTestId("email-save"));

  await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
  const [, payload] = apiMock.put.mock.calls.at(-1);
  expect(payload).toEqual({ reply_to_email: "turniere@lionsquad.at" });
});

test("ohne Aenderung wird gar nicht gespeichert", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForLoadedEmailTab();

  await user.click(screen.getByTestId("email-save"));

  await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith("Keine Änderungen zum Speichern."));
  expect(apiMock.put).not.toHaveBeenCalled();
});

test("ein Ausfall einzelner Bereiche legt die Seite nicht lahm", async () => {
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.includes("mail-queue") || path.includes("system-status") || path.includes("streams/status")) {
      return Promise.reject(new Error("Teilbereich nicht erreichbar"));
    }
    return Promise.resolve(responseFor(path));
  });

  renderPage();

  await waitForLoadedEmailTab();
  expect(screen.getByTestId("admin-layout")).toBeInTheDocument();
});

// Dreizehn gleich aussehende Reiter, davon fuenf zum Mailversand. Die Gruppen
// sagen, wozu ein Reiter gehoert - "Resend" und "Versandlogs" allein tun das
// nicht.

test("die Reiter stehen in benannten Gruppen", async () => {
  renderPage();
  await waitForLoadedEmailTab();

  const mail = screen.getByTestId("settings-group-E-Mail");
  for (const key of ["email", "smtp", "newsletter", "queue", "logs"]) {
    expect(mail).toContainElement(screen.getByTestId(`settings-tab-${key}`));
  }

  const look = screen.getByTestId("settings-group-Auftritt");
  expect(look).toContainElement(screen.getByTestId("settings-tab-brand"));
  expect(look).not.toContainElement(screen.getByTestId("settings-tab-smtp"));

  // Ohne Superadmin-Rechte gibt es die Zugangsgruppe nicht.
  expect(screen.queryByTestId("settings-group-Zugang")).not.toBeInTheDocument();
});

test("eine unerwartet geformte Antwort legt nicht die ganze Seite lahm", async () => {
  // Der Kern: unten stehen queue.filter, logs.map und discordCounters.map.
  // Kam statt einer Liste etwas anderes, riss das die komplette Seite in die
  // Fehlergrenze - statt nur diesen einen Bereich leer zu lassen.
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.startsWith("/settings/mail-queue?")) return Promise.resolve({ data: { items: [] } });
    if (path.startsWith("/settings/email/logs")) return Promise.resolve({ data: { items: [] } });
    if (path.startsWith("/admin/discord/counters")) return Promise.resolve({ data: {} });
    return Promise.resolve(responseFor(path));
  });

  renderPage();

  await waitForLoadedEmailTab();
  expect(screen.getByTestId("settings-tab-queue")).toBeInTheDocument();
});
