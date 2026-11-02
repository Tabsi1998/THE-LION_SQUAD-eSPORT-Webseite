import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Bild-Wartung (#2130): die vier Knöpfe stehen unter System → Status statt auf der Sponsorenseite. Erfundene Zahlen.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
const confirmMock = vi.fn(async () => true);
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "" }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { ImageMaintenancePanel } = await import("./ImageMaintenancePanel");

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
});

test("Prüfen zeigt das Ergebnis", async () => {
  apiMock.get.mockResolvedValue({ data: { summary: { local_ok: 7, missing_file: 2 } } });
  render(<ImageMaintenancePanel />);
  fireEvent.click(screen.getByTestId("image-audit-btn"));
  expect(await screen.findByTestId("image-audit-result")).toHaveTextContent("Datei fehlt2");
  expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("7 ok"));
});

test("Reparieren, Leeren und Speichern fragen vorher; Abbrechen ändert nichts", async () => {
  confirmMock.mockResolvedValue(false);
  render(<ImageMaintenancePanel />);
  for (const id of ["image-normalize-btn", "image-clear-missing-btn", "image-migrate-btn"]) fireEvent.click(screen.getByTestId(id));
  await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(3));
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("die Aktionen rufen die richtigen Wege auf, ein Fehler sagt es", async () => {
  apiMock.post.mockImplementation(async (url) => (url === "/uploads/migrate-external-images"
    ? { data: { summary: { news: { updated: 2 }, sponsors: { updated: 1 } } } }
    : { data: { summary: { normalized: 4, cleared_missing: 3 } } }));
  apiMock.get.mockResolvedValue({ data: { summary: {} } });
  render(<ImageMaintenancePanel />);
  fireEvent.click(screen.getByTestId("image-normalize-btn"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("4 Bild-Adressen repariert."));
  fireEvent.click(screen.getByTestId("image-clear-missing-btn"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("3 kaputte Bild-Verknüpfung(en) geleert."));
  fireEvent.click(screen.getByTestId("image-migrate-btn"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("3 Bilder lokal gespeichert."));

  apiMock.get.mockRejectedValueOnce({ response: { data: { detail: "Dafür fehlt dir das Recht." } } });
  fireEvent.click(screen.getByTestId("image-audit-btn"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Dafür fehlt dir das Recht."));
});
