import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Jahreswertung: Liga-Staffeln zählen nie (docs/LIGA.md, #1622) - die Turnierauswahl fragt deshalb ohne sie.
const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler"), formatRequestError: () => "Fehler", resolveMediaUrl: (url) => url || "" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: AdminSeasonsPage } = await import("./AdminSeasonsPage");

test("die Turnierauswahl der Jahreswertung lädt ohne Liga-Staffeln", async () => {
  apiMock.get.mockResolvedValue({ data: [] });
  render(<MemoryRouter><AdminSeasonsPage /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/tournaments?include_drafts=true&league=exclude"));
});
