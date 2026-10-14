import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Datei-Nacharbeit (#1046): Einträge mit Status sichtbar, „Erneut versuchen“ stößt die Nacharbeit an.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { FileCleanupsPanel } = await import("./FileCleanupsPanel");

const VIEW = {
  counts: { pending: 1, failed: 1 },
  retry_limit: 8,
  items: [
    { filename: "fest.webp", source: "account_erasure", status: "failed", attempts: 8, last_error: "PermissionError EACCES", failed_at: "2026-10-12T10:00:00+00:00" },
    { filename: "zu.webp", source: "media_library", status: "pending", attempts: 2, last_error: "PermissionError", next_attempt_at: "2026-10-13T12:00:00+00:00" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: VIEW });
});

test("zeigt offene und aufgegebene Dateien und versucht sie erneut", async () => {
  apiMock.post.mockResolvedValue({ data: { requeued: 1, removed: 2, counts: { pending: 0, failed: 0 }, retry_limit: 8, items: [] } });
  const onChanged = vi.fn();
  const user = userEvent.setup();
  render(<FileCleanupsPanel onChanged={onChanged} />);

  expect(await screen.findByTestId("ops-file-cleanups")).toHaveTextContent("1 offen · 1 aufgegeben (nach 8 Versuchen)");
  expect(screen.getByTestId("ops-file-cleanup-fest.webp")).toHaveTextContent("aufgegeben");
  expect(screen.getByTestId("ops-file-cleanup-fest.webp")).toHaveTextContent("Kontolöschung");
  expect(screen.getByTestId("ops-file-cleanup-zu.webp")).toHaveTextContent("offen");
  expect(screen.getByTestId("ops-file-cleanup-zu.webp")).toHaveTextContent("Mediathek");

  await user.click(screen.getByTestId("ops-file-cleanups-retry"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/ops/file-cleanups/retry");
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("2 Dateien gelöscht, 0 offen, 0 aufgegeben."));
  expect(onChanged).toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByTestId("ops-file-cleanups")).not.toBeInTheDocument());
});

test("ohne Einträge bleibt der Bereich leer", async () => {
  apiMock.get.mockResolvedValue({ data: { counts: { pending: 0, failed: 0 }, retry_limit: 8, items: [] } });
  const { container } = render(<FileCleanupsPanel />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/ops/file-cleanups"));
  expect(container).toBeEmptyDOMElement();
});
