import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Ecken-Klammern (#1316): In der Jahreswertung tragen nur deine Zeile (Tabelle am PC, Liste am Handy) und deine
// Podest-Karte Ecken, Fläche und „Du“.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useCanonicalSlugRedirect", () => ({ useCanonicalSlugRedirect: () => {} }));
let authState = { user: null };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));

const { default: SeasonPage } = await import("./SeasonPage");

const row = (rank, id, name) => ({ rank, user_id: id, username: name.toLowerCase(), display_name: name, points: 100 - rank, events_count: 3, wins: 1, source_breakdown: [] });
const STANDINGS = [row(1, "u-1", "NeonFalke"), row(2, "u-me", "Spieler"), row(3, "u-3", "LunaByte"), row(4, "u-4", "PixelPirat")];

function renderPage() {
  apiMock.get.mockResolvedValue({ data: { season: { id: "s1", slug: "2026", name: "Saison 2026", status: "active" }, standings: STANDINGS } });
  return render(
    <MemoryRouter initialEntries={["/seasons/2026"]}>
      <Routes><Route path="/seasons/:slug" element={<SeasonPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authState = { user: null };
  apiMock.get.mockReset();
});

test("nur deine Zeile, dein Eintrag am Handy und deine Podest-Karte tragen Ecken und „Du“", async () => {
  authState = { user: { id: "u-me" } };
  renderPage();
  const own = await screen.findByTestId("season-row-u-me");
  expect(own).toHaveClass("tls-you", "tls-you--inset");
  expect(within(own).getByText("Du")).toHaveClass("tls-you-tag");
  expect(screen.getByTestId("season-item-u-me")).toHaveClass("tls-you", "tls-you--inset");
  for (const id of ["u-1", "u-3", "u-4"]) {
    expect(screen.getByTestId(`season-row-${id}`)).not.toHaveClass("tls-you");
    expect(screen.getByTestId(`season-item-${id}`)).not.toHaveClass("tls-you");
  }
  // Tabelle, Liste und Podest: genau dreimal „du“.
  expect(document.querySelectorAll(".tls-you")).toHaveLength(3);
  expect(document.querySelectorAll(".tls-you-tag")).toHaveLength(3);
});

test("ohne Anmeldung keine Ecken", async () => {
  renderPage();
  await screen.findByTestId("season-row-u-me");
  expect(document.querySelectorAll(".tls-you, .tls-you-tag")).toHaveLength(0);
});
