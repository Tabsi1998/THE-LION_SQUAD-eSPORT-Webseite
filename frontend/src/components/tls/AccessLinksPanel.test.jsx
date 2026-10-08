import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Speziallinks (#1354): die Person kommt aus der Personensuche, die ganze Kontoliste mit E-Mail-Adressen lädt das Feld
// nicht mehr. Ist eine Person gewählt, holt der Server die Adresse selbst aus dem Konto.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({
  api: apiMock,
  formatRequestError: (_error, fallback) => fallback,
  resolveMediaUrl: (value) => value || "",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { AccessLinksPanel } = await import("./AccessLinksPanel");

beforeEach(() => {
  window.localStorage.clear();
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/admin/people/search") return { data: [{ id: "u-3", name: "Pia Pokal", context: "Community" }] };
    return { data: [] };
  });
  apiMock.post.mockResolvedValue({ data: { url: "/tournaments/x?access=abc" } });
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue() } });
});

test("Person über die Suche binden: der Link geht mit der Kennung, ohne Adresse vom Browser, ohne Kontoliste", async () => {
  render(<AccessLinksPanel targetType="tournament" targetId="t-1" />);
  fireEvent.change(screen.getByTestId("access-link-person-tournament-search"), { target: { value: "pia" } });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)); });
  fireEvent.click(await screen.findByTestId("access-link-person-tournament-option-u-3"));
  expect(screen.getByText("Der Link gilt nur für dieses Konto; die Adresse kommt aus dem Konto.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Erstellen/ }));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/access-links", expect.objectContaining({ user_id: "u-3", email: null })));
  expect(apiMock.get.mock.calls.map(([url]) => url)).not.toContain("/users");
});
