import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Meine Gewinne: ein Turnierpreis nennt den Platz, ein Gewinn aus einer Verlosung (#641) heißt „Verlosung“ und
// führt zum Adventkalender.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API_BASE: "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <main>{children}</main> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));

const { default: MyPrizesPage } = await import("./MyPrizesPage");

const TOURNAMENT = { id: "p1", status: "ready", place: 1, prize_label: "Pokal", prize_value: "und 50 € Gutschein", tournament_title: "Sommer-Cup", tournament_slug: "sommer-cup", pickup_deadline: "2099-01-01T00:00:00+00:00" };
const RAFFLE = { id: "p2", status: "pending", source_type: "season", place: 0, place_label: "Verlosung", prize_label: "TLS-Hoodie", prize_value: "Größe nach Wahl", tournament_title: "Adventkalender 2026", season_source_label: "Türchen 12", source_url: "/advent", pickup_deadline: "2099-03-13T00:00:00+00:00" };

beforeEach(() => {
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url === "/prizes/me" ? [TOURNAMENT, RAFFLE] : [] }));
});

test("Turnierpreis mit Platz, Gewinn aus der Verlosung ohne", async () => {
  render(<MemoryRouter><MyPrizesPage /></MemoryRouter>);
  const cup = await screen.findByTestId("my-prize-p1");
  expect(cup).toHaveTextContent("Platz #1");
  expect(cup).toHaveTextContent("Pokal");
  expect(within(cup).getByRole("link", { name: "Sommer-Cup" })).toHaveAttribute("href", "/tournaments/sommer-cup");

  const raffle = screen.getByTestId("my-prize-p2");
  expect(raffle).toHaveTextContent("Verlosung");
  expect(raffle).not.toHaveTextContent("Platz");
  expect(raffle).toHaveTextContent("TLS-Hoodie");
  expect(raffle).toHaveTextContent("Größe nach Wahl");
  expect(within(raffle).getByRole("link", { name: "Adventkalender 2026 · Türchen 12" })).toHaveAttribute("href", "/advent");
  expect(screen.getByText(/Fast-Lap-Challenges und Verlosungen/)).toBeInTheDocument();
});
