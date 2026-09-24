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

test("Branding: „Aus Logo und Akzentfarbe erzeugen“ ruft den Server, übernimmt den neuen Standard-Favicon und warnt vorher, wenn der Standard nur die dunkle Fassung ist (#229)", async () => {
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.startsWith("/settings/branding")) return Promise.resolve({ data: { club_name: "THE LION SQUAD", favicon_url: "/api/static/uploads/m.png", mascot_url: "/api/static/uploads/m.png" } });
    return Promise.resolve(responseFor(path));
  });
  apiMock.post.mockResolvedValue({ data: { favicon_url: "/api/static/uploads/neu.png", source: "/api/static/uploads/m.png", color: "#29B6E8" } });
  const user = userEvent.setup();
  render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={["/admin/settings?tab=brand"]}>
        <AdminSettingsPage />
      </MemoryRouter>
    </ConfirmDialogProvider>
  );

  expect(await screen.findByTestId("brand-favicon-dark-only")).toHaveTextContent("Fassung für dunkel");
  await user.click(screen.getByTestId("brand-favicon-generate"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/branding/favicon/universal"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Standard-Favicon erzeugt und gespeichert."));
  // Der neue Standard ist eine eigene Datei - der Hinweis verschwindet.
  await waitFor(() => expect(screen.queryByTestId("brand-favicon-dark-only")).not.toBeInTheDocument());
});

// Vereinsdaten aus Dolibarr (#326): der Haken muss sich setzen lassen, die übernommenen Felder sperren
// und beim Speichern als legal_from_dolibarr mitgehen - der Betreiber meldete, der Haken „geht nicht“.
test("Rechtliches: der Haken „Vereinsdaten aus Dolibarr übernehmen“ lässt sich setzen und wird gespeichert", async () => {
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.startsWith("/admin/dolibarr/public")) {
      return Promise.resolve({ data: {
        enabled: false, has_data: true, fetched_at: "2026-09-23T21:20:00+00:00", names_withheld: false,
        overlay: { legal_name: "THE LION SQUAD - eSPORTS", zvr_number: "1593703043" },
        representative: { name: "Obperson Test", role: "Obmann/Obfrau" }, board: [], fields: ["legal_name", "zvr_number"],
        statutes: { state: "in_force", current: { id: 3, version: 2, valid_from: "2026-04-20" }, versions: 3, error: null },
      } });
    }
    return Promise.resolve(responseFor(url));
  });
  render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={["/admin/settings?tab=legal"]}>
        <AdminSettingsPage />
      </MemoryRouter>
    </ConfirmDialogProvider>
  );
  const box = await screen.findByTestId("legal-from-dolibarr");
  await waitFor(() => expect(box).not.toBeDisabled());
  await userEvent.click(box);
  expect(box).toBeChecked();
  const nameField = screen.getByTestId("legal-name");
  const nameInput = nameField.tagName === "INPUT" ? nameField : nameField.querySelector("input");
  await waitFor(() => expect(nameInput).toBeDisabled());
  expect(nameInput).toHaveValue("THE LION SQUAD - eSPORTS");
  expect(screen.getByTestId("legal-dolibarr-statutes")).toHaveTextContent("Statuten: Fassung 2 gilt seit 20.04.2026 (3 Fassungen)");
  await userEvent.click(screen.getByTestId("legal-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/branding", expect.objectContaining({ legal_from_dolibarr: true })));
});

// Nachtrag: live stand Analytics auf „Google“ ohne Measurement ID - das blockierte jedes Speichern der
// Markendaten, auch auf „Rechtliches“ (der Haken „Vereinsdaten aus Dolibarr“ hielt deshalb nie).
// Die Analytics-Prüfung greift nur noch, wenn Analytics selbst geändert wird.
test("Rechtliches speichert auch, wenn Analytics auf Google ohne ID steht - die Prüfung greift nur bei Analytics-Änderungen", async () => {
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.startsWith("/settings/branding")) return Promise.resolve({ data: { club_name: "THE LION SQUAD", analytics_provider: "google", google_analytics_id: "" } });
    if (path.startsWith("/admin/dolibarr/public")) return Promise.resolve({ data: { enabled: false, has_data: true, fetched_at: "2026-09-23T21:20:00+00:00", overlay: { legal_name: "THE LION SQUAD - eSPORTS" }, representative: null, board: [], fields: [] } });
    return Promise.resolve(responseFor(url));
  });
  render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={["/admin/settings?tab=legal"]}>
        <AdminSettingsPage />
      </MemoryRouter>
    </ConfirmDialogProvider>
  );
  const box = await screen.findByTestId("legal-from-dolibarr");
  await waitFor(() => expect(box).not.toBeDisabled());
  await userEvent.click(box);
  await userEvent.click(screen.getByTestId("legal-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/branding", expect.objectContaining({ legal_from_dolibarr: true })));
  expect(toastMock.error).not.toHaveBeenCalled();
});

// Kanäle aus Dolibarr (#326 Teil 4): der Haken auf „Social Links“ speichert das Feld mit.
test("Social Links: der Haken „Kanäle aus Dolibarr übernehmen“ lässt sich setzen und wird gespeichert", async () => {
  apiMock.get.mockImplementation((url) => Promise.resolve(responseFor(url)));
  render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={["/admin/settings?tab=socials"]}>
        <AdminSettingsPage />
      </MemoryRouter>
    </ConfirmDialogProvider>
  );
  const box = await screen.findByTestId("channels-from-dolibarr");
  expect(box).not.toBeChecked();
  await userEvent.click(box);
  expect(box).toBeChecked();
  expect(screen.getByTestId("socials-dolibarr")).toHaveTextContent("Kanäle und Konten");
  await userEvent.click(screen.getByTestId("socials-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/branding", expect.objectContaining({ channels_from_dolibarr: true })));
});
