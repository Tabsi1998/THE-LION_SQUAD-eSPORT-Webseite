import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Meine Gewinne: ein Turnierpreis nennt den Platz, ein Gewinn aus einer Verlosung (#641) heißt „Verlosung“ und
// führt zum Adventkalender.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API_BASE: "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <main>{children}</main> }));
const invalidation = { reload: null };
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: (callback) => { invalidation.reload = callback; } }));

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

// Fehler statt leer (#984): beide Abrufe getrennt - ein Ausfall vernichtet den anderen Teil nicht und ist sichtbar.
const CERT = { id: "c-1", title: "Urkunde Sommer-Cup", place: 1, tournament_title: "Sommer-Cup" };
const serverError = () => Object.assign(new Error("boom"), { response: { status: 500, data: {} } });

function serveParts({ prizes, certificates }) {
  apiMock.get.mockImplementation((url) => {
    const part = url === "/prizes/me" ? prizes : certificates;
    return part instanceof Error ? Promise.reject(part) : Promise.resolve({ data: part });
  });
}

test("beide Abrufe scheitern: Fehler mit „Nochmal versuchen“ statt „Noch keine Gewinne“", async () => {
  serveParts({ prizes: serverError(), certificates: serverError() });
  render(<MemoryRouter><MyPrizesPage /></MemoryRouter>);
  expect(await screen.findByTestId("public-error-state")).toHaveTextContent("Gewinne konnten nicht geladen werden");
  expect(screen.queryByText("Noch keine Gewinne oder Urkunden.")).toBeNull();
  serveParts({ prizes: [TOURNAMENT], certificates: [] });
  fireEvent.click(screen.getByTestId("public-error-retry"));
  expect(await screen.findByTestId("my-prize-p1")).toBeInTheDocument();
});

test("Urkunden scheitern, Gewinne kommen: Gewinne stehen, der Ausfall steht dabei", async () => {
  serveParts({ prizes: [TOURNAMENT], certificates: serverError() });
  render(<MemoryRouter><MyPrizesPage /></MemoryRouter>);
  expect(await screen.findByTestId("my-prize-p1")).toBeInTheDocument();
  expect(screen.getByTestId("prizes-partial")).toHaveTextContent("Urkunden");
});

test("Gewinne scheitern, Urkunden kommen: Urkunden stehen, kein „Noch keine Gewinne“", async () => {
  serveParts({ prizes: serverError(), certificates: [CERT] });
  render(<MemoryRouter><MyPrizesPage /></MemoryRouter>);
  expect(await screen.findByTestId("my-certificate-c-1")).toBeInTheDocument();
  expect(screen.getByTestId("prizes-partial")).toHaveTextContent("Gewinne");
  expect(screen.queryByText("Noch keine Gewinne oder Urkunden.")).toBeNull();
});

test("erfolgreich leer: „Noch keine Gewinne oder Urkunden.“", async () => {
  serveParts({ prizes: [], certificates: [] });
  render(<MemoryRouter><MyPrizesPage /></MemoryRouter>);
  expect(await screen.findByText("Noch keine Gewinne oder Urkunden.")).toBeInTheDocument();
  expect(screen.queryByTestId("prizes-partial")).toBeNull();
});

test("Nachladen: scheitert ein Teil, bleibt sein letzter Stand stehen", async () => {
  serveParts({ prizes: [TOURNAMENT], certificates: [CERT] });
  render(<MemoryRouter><MyPrizesPage /></MemoryRouter>);
  await screen.findByTestId("my-certificate-c-1");
  serveParts({ prizes: [TOURNAMENT], certificates: serverError() });
  await act(async () => { await invalidation.reload(); });
  expect(screen.getByTestId("my-certificate-c-1")).toBeInTheDocument();
  expect(screen.getByTestId("my-prize-p1")).toBeInTheDocument();
  expect(screen.getByTestId("prizes-partial")).toHaveTextContent("Urkunden");
});

// Die Abholfrist läuft erst ab „Bereit“ (#2123, ER1): ein offener Gewinn nennt keine Frist, nur was als Nächstes kommt.
test("offener Gewinn: keine Frist, sondern der Hinweis auf „abholbereit“", async () => {
  render(<MemoryRouter><MyPrizesPage /></MemoryRouter>);
  const raffle = await screen.findByTestId("my-prize-p2");
  expect(raffle).not.toHaveTextContent("Abholbar bis");
  expect(screen.getByTestId("my-prize-pending-p2")).toHaveTextContent("sobald er abholbereit ist");
  expect(screen.getByTestId("my-prize-p1")).toHaveTextContent("Abholbar bis");
});
