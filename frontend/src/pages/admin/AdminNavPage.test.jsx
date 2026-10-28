import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Navigation-Editor (#2122): die Reihenfolge der Unterpunkte wird gespeichert (NW6).

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const confirmMock = vi.fn(async () => true);
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));

const { default: AdminNavPage, missingLabels, sortNavItems, withOrder } = await import("./AdminNavPage");

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

// Pflichtname, Zurücksetzen, Liga-Hinweis (#2122 NW7).
test("leerer Name: Hinweis, Speichern gesperrt", async () => {
  render(<AdminNavPage />);
  fireEvent.change(await screen.findByTestId("nav-label-home"), { target: { value: "  " } });
  expect(screen.getByTestId("nav-missing-label")).toHaveTextContent("braucht einen Namen");
  expect(screen.getByTestId("nav-save")).toBeDisabled();
  expect(missingLabels([{ key: "a", label: "A", children: [{ key: "b", label: "" }] }])).toEqual(["b"]);
});

test("Zurücksetzen fragt nach und lädt die Vorgabe", async () => {
  apiMock.post.mockResolvedValue({ data: { items: [{ key: "home", to: "/", label: "Start", visible: true, order: 0 }] } });
  confirmMock.mockClear();
  render(<AdminNavPage />);
  fireEvent.click(await screen.findByTestId("nav-reset"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/nav/reset"));
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Navigation zurücksetzen?" }));
  await waitFor(() => expect(screen.queryByTestId("nav-row-club")).toBeNull());
});

test("Liga steht mit Hinweis unter eSports, keine technischen Schlüssel", async () => {
  apiMock.get.mockResolvedValue({ data: { items: [{ key: "esports", to: "/esports", label: "eSports", visible: true, order: 0, children: [
    { key: "tournaments", to: "/tournaments", label: "Turniere", visible: true, order: 0 }, { key: "league", to: "/liga", label: "Liga", visible: true, order: 1 },
  ] }] } });
  render(<AdminNavPage />);
  fireEvent.click(await screen.findByRole("button", { name: "eSports aufklappen" }));
  expect(screen.getByTestId("nav-label-esports-league")).toHaveValue("Liga");
  expect(screen.getByTestId("nav-note-league")).toHaveTextContent("solange eine Season sichtbar ist");
  expect(screen.queryByText("esports_overview")).toBeNull();
  expect(screen.queryByText("league")).toBeNull();
});
