import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Vereinsdaten (#509): eigene Seite unter Verein. Die beiden Prüfungen zum Haken „Vereinsdaten aus
// Dolibarr übernehmen“ kommen vom früheren Reiter „Rechtliches“ mit.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn() };

vi.mock("@/lib/api", () => ({
  api: apiMock,
  formatApiError: (detail) => String(detail || "Fehler"),
  formatRequestError: (error, fallback) => fallback || String(error),
  resolveMediaUrl: (value) => value || "",
}));
vi.mock("@/lib/brandingEvents", () => ({ setCachedBranding: vi.fn() }));
vi.mock("@/components/tls/AdminLayout", () => ({
  AdminLayout: ({ children }) => <div data-testid="admin-layout">{children}</div>,
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminClubDataPage = (await import("./AdminClubDataPage")).default;

const DOLIBARR_PUBLIC = {
  enabled: false, has_data: true, fetched_at: "2026-09-23T21:20:00+00:00", names_withheld: false,
  overlay: { legal_name: "THE LION SQUAD - eSPORTS", zvr_number: "1593703043" },
  representative: { name: "Obperson Test", role: "Obmann/Obfrau" }, board: [], fields: ["legal_name", "zvr_number"],
  statutes: { state: "in_force", current: { id: 3, version: 2, valid_from: "2026-04-20" }, versions: 3, error: null },
};

function mockApi(branding = { club_name: "THE LION SQUAD" }) {
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.startsWith("/admin/dolibarr/public")) return Promise.resolve({ data: DOLIBARR_PUBLIC });
    if (path.startsWith("/settings/branding")) return Promise.resolve({ data: branding });
    if (path.startsWith("/settings/public")) return Promise.resolve({ data: {} });
    return Promise.resolve({ data: [] });
  });
  apiMock.put.mockResolvedValue({ data: { ok: true } });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/club"]}>
      <AdminClubDataPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("die Seite heißt Vereinsdaten und lädt die Felder aus dem Branding", async () => {
  mockApi({ club_name: "THE LION SQUAD", legal_name: "THE LION SQUAD – eSports Verein", zvr_number: "123" });
  renderPage();
  expect(await screen.findByTestId("club-data-title")).toHaveTextContent("Vereinsdaten");
  const nameField = await screen.findByTestId("legal-name");
  const nameInput = nameField.tagName === "INPUT" ? nameField : nameField.querySelector("input");
  await waitFor(() => expect(nameInput).toHaveValue("THE LION SQUAD – eSports Verein"));
});

test("der Haken „Vereinsdaten aus Dolibarr übernehmen“ lässt sich setzen und geht als Änderung raus", async () => {
  mockApi();
  renderPage();
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
  const payload = apiMock.put.mock.calls[0][1];
  expect(Object.keys(payload)).toEqual(["legal_from_dolibarr"]);
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Vereinsdaten gespeichert."));
});

test("ohne Änderung wird nichts gesendet", async () => {
  mockApi();
  renderPage();
  await screen.findByTestId("legal-from-dolibarr");
  await userEvent.click(screen.getByTestId("legal-save"));
  await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith("Keine Änderungen zum Speichern."));
  expect(apiMock.put).not.toHaveBeenCalled();
});
