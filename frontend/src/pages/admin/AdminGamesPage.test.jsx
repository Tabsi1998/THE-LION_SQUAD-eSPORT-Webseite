import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Spiele (#435): „Spiel bearbeiten“ öffnet ein Seitenblatt statt eines Fensters; Speichern
// schickt das Spiel mit Slug und Plattformen und schließt das Blatt.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const AdminGamesPage = (await import("./AdminGamesPage")).default;

const GAMES = [
  { id: "g1", name: "Mario Kart 8 Deluxe", slug: "mario-kart-8", kind: "standalone", platforms: ["Switch"], supports_solo: true, supports_teams: false },
];

beforeEach(() => {
  apiMock.get.mockResolvedValue({ data: GAMES });
  apiMock.patch.mockReset();
  apiMock.patch.mockResolvedValue({ data: GAMES[0] });
});

test("Bearbeiten öffnet das Seitenblatt mit den Werten; Speichern schickt das Spiel und schließt es", async () => {
  render(<MemoryRouter><AdminGamesPage /></MemoryRouter>);
  expect(await screen.findByTestId("game-edit-mario-kart-8")).toBeInTheDocument();
  expect(screen.queryByTestId("game-sheet")).toBeNull();

  fireEvent.click(screen.getByTestId("game-edit-mario-kart-8"));
  expect(screen.getByRole("dialog", { name: "Spiel bearbeiten" })).toBeInTheDocument();
  expect(screen.getByTestId("game-edit-name")).toHaveValue("Mario Kart 8 Deluxe");
  expect(screen.getByTestId("game-edit-platforms")).toHaveValue("Switch");
  expect(screen.getByTestId("game-edit-format")).toHaveValue("single_elim");

  fireEvent.change(screen.getByTestId("game-edit-platforms"), { target: { value: "Switch, Switch 2" } });
  fireEvent.submit(screen.getByTestId("game-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", expect.objectContaining({ slug: "mario-kart-8", platforms: ["Switch", "Switch 2"] })));
  await waitFor(() => expect(screen.queryByTestId("game-sheet")).toBeNull());
});
