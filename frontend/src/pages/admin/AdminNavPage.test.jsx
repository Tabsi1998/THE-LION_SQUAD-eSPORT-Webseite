import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Navigation-Editor (#2122): die Reihenfolge der Unterpunkte wird gespeichert (NW6).

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const confirmMock = vi.fn(async () => true);
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));

const { default: AdminNavPage, sortNavItems, withOrder } = await import("./AdminNavPage");

const NAV = {
  items: [
    { key: "home", to: "/", label: "Start", visible: true, order: 0 },
    { key: "club", to: "/about", label: "Verein", visible: true, order: 1, children: [
      { key: "about", to: "/about", label: "Über uns", visible: true, order: 0 },
      { key: "board", to: "/board", label: "Vorstand", visible: true, order: 1 },
    ] },
  ],
};

beforeEach(() => {
  apiMock.get.mockResolvedValue({ data: NAV });
  apiMock.put.mockResolvedValue({ data: NAV });
});

test("withOrder: Haupt- und Unterpunkte bekommen ihre Stelle", () => {
  const items = withOrder([{ key: "b", children: [{ key: "y" }, { key: "x" }] }, { key: "a" }]);
  expect(items.map((item) => [item.key, item.order])).toEqual([["b", 0], ["a", 1]]);
  expect(items[0].children.map((child) => [child.key, child.order])).toEqual([["y", 0], ["x", 1]]);
  expect(sortNavItems([{ key: "a", order: 1 }, { key: "b", order: 0, children: [{ key: "x", order: 1 }, { key: "y", order: 0 }] }])
    .map((item) => [item.key, (item.children || []).map((child) => child.key)])).toEqual([["b", ["y", "x"]], ["a", []]]);
});

test("Unterpunkt nach oben schieben und speichern: die neue Reihenfolge geht mit", async () => {
  render(<AdminNavPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Verein aufklappen" }));
  const board = screen.getByTestId("nav-child-club-board");
  fireEvent.click(within(board).getByRole("button", { name: "Vorstand nach oben" }));
  fireEvent.click(screen.getByTestId("nav-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
  const club = apiMock.put.mock.calls[0][1].items.find((item) => item.key === "club");
  expect(club.children.map((child) => [child.key, child.order])).toEqual([["board", 0], ["about", 1]]);
});
