import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Das Löwenei neben dem Logo (#646): angemeldet der Stand des Korbs, sonst die Einladung - und das Modul steht im
// Register der Jahreszeiten.

const basket = vi.fn();
let progressListener = null;
vi.mock("./api", () => ({
  fetchBasket: (...args) => basket(...args),
  onHuntProgress: (listener) => { progressListener = listener; return () => { progressListener = null; }; },
}));
vi.mock("./EasterEggs", () => ({ EasterEggs: () => null }));
const authState = { user: null };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));

const { Widget, season, widgetLabel } = await import("./index");
const { SEASON_MODULES, hasModule } = await import("../registry");

beforeEach(() => {
  basket.mockReset();
  authState.user = null;
});

test("was das Widget sagt", () => {
  expect(widgetLabel(null)).toBe("Ostereiersuche – zu Korb und Regeln");
  expect(widgetLabel({ active: true, found: 3, total: 12 })).toBe("Ostereiersuche – 3 von 12 Eiern gefunden");
  expect(widgetLabel({ active: true, found: 12, total: 12, completed_at: "x" })).toBe("Ostereiersuche – dein Korb ist voll (12 von 12)");
});

test("als Gast führt das Löwenei zur Seite, ohne Zahl", async () => {
  render(<MemoryRouter><Widget /></MemoryRouter>);
  const link = screen.getByTestId("easter-hunt-widget");
  expect(link).toHaveAttribute("href", "/ostern");
  expect(screen.queryByTestId("easter-hunt-widget-count")).toBeNull();
  expect(basket).not.toHaveBeenCalled();
});

test("angemeldet zeigt es den Korb und folgt jedem Fund", async () => {
  authState.user = { id: "u1" };
  basket.mockResolvedValue({ active: true, found: 2, total: 12 });
  render(<MemoryRouter><Widget /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("easter-hunt-widget-count")).toHaveTextContent("2/12"));
  progressListener({ found: 3, total: 12, active: true });
  await waitFor(() => expect(screen.getByTestId("easter-hunt-widget-count")).toHaveTextContent("3/12"));
});

test("das Modul steht im Register", async () => {
  expect(hasModule("easter_hunt")).toBe(true);
  expect((await SEASON_MODULES.easter_hunt()).season).toBe(season);
  expect(season.key).toBe("easter_hunt");
});
