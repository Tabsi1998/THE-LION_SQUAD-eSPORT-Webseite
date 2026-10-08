import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Jahresrückblick (#1195): Seiten zum Durchtippen (rechts weiter, links zurück, Pfeiltasten), am Ende das Bild;
// mit „Bewegung reduzieren“ ohne Animation; ohne Rückblick ein Hinweis.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (v) => v || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: YearReviewPage } = await import("./YearReviewPage");

const FULL = {
  year: 2026, user: { display_name: "Neonfalke" }, club_name: "THE LION SQUAD", image_path: "/api/year-review/me/card.png",
  tournaments: { count: 31, wins: 7, podiums: 12, games: 41, games_won: 26, best: { title: "FC 26 Herbst-Cup", rank: 1, participant_count: 16 }, more_than_of_ten: 9 },
  favorite_game: { name: "EA SPORTS FC 26", tournaments: 19, games: 41 },
  events: { count: 4, items: [{ name: "LAN-Wochenende Herbst", date: "03.10.2026" }] },
  fastlap: { count: 3, best: { time: "2:01,300", track: "Spa", title: "Spa Challenge", rank: 2, participant_count: 14 } },
  achievements: { count: 9, points: 240, top: [{ name: "Spielmacher III", material_name: "Gold", material_color: "#FFD700" }] },
  season: { name: "Jahreswertung 2026", rank: 5, points: 210.5, participants: 48 },
};

function renderPage(url = "/dein-jahr") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/dein-jahr" element={<YearReviewPage />} />
        <Route path="/dashboard" element={<div data-testid="dashboard" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function reducedMotion(reduce) {
  vi.stubGlobal("matchMedia", (query) => ({ matches: query.includes("reduce") ? reduce : false, addEventListener: () => {}, removeEventListener: () => {} }));
}

beforeEach(() => {
  apiMock.get.mockReset();
  vi.unstubAllGlobals();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["png"], { type: "image/png" })) }));
  URL.createObjectURL = vi.fn(() => "blob:mein-jahr");
  URL.revokeObjectURL = vi.fn();
});

describe("YearReviewPage", () => {
  it("blättert mit Tippen und Pfeiltasten durch die Seiten bis zum Bild", async () => {
    reducedMotion(false);
    apiMock.get.mockResolvedValue({ data: FULL });
    renderPage();
    expect(await screen.findByTestId("year-review-page-intro")).toHaveTextContent("2026");
    expect(apiMock.get).toHaveBeenCalledWith("/year-review/me", { params: undefined });
    expect(screen.getByTestId("year-review")).toHaveAttribute("data-animate", "on");
    expect(screen.getByTestId("year-review-position")).toHaveTextContent("1 / 8");

    fireEvent.click(screen.getByTestId("year-review-tap-next"));
    expect(await screen.findByTestId("year-review-page-tournaments")).toHaveTextContent("31");
    expect(screen.getByTestId("year-review-comparison")).toHaveTextContent("Mehr Turniere als 9 von 10 im Verein.");
    fireEvent.click(screen.getByTestId("year-review-tap-prev"));
    expect(await screen.findByTestId("year-review-page-intro")).toBeInTheDocument();
    act(() => { fireEvent.keyDown(window, { key: "ArrowRight" }); });
    act(() => { fireEvent.keyDown(window, { key: "ArrowRight" }); });
    expect(await screen.findByTestId("year-review-page-favorite")).toHaveTextContent("EA SPORTS FC 26");
    expect(screen.getByTestId("year-review-bar-2").style.transform).toBe("scaleX(1)");
    expect(screen.getByTestId("year-review-bar-3").style.transform).toBe("scaleX(0)");
    for (let i = 0; i < 6; i += 1) fireEvent.click(screen.getByTestId("year-review-next"));
    expect(await screen.findByTestId("year-review-page-share")).toBeInTheDocument();
    expect(screen.getByTestId("year-review-next")).toBeDisabled();
    // Auf der letzten Seite liegen keine Tippflächen über den Knöpfen.
    expect(screen.queryByTestId("year-review-tap-next")).toBeNull();
    expect(await screen.findByTestId("year-review-card")).toHaveAttribute("src", "blob:mein-jahr");
    expect(fetch).toHaveBeenCalledWith("/api/year-review/me/card.png", { credentials: "include" });
    expect(screen.getByTestId("year-review-download")).toHaveAttribute("download", "mein-jahr-2026.png");
    act(() => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(await screen.findByTestId("dashboard")).toBeInTheDocument();
  });

  it("mit „Bewegung reduzieren“ ohne Animation; Vorschau fragt mit ?vorschau", async () => {
    reducedMotion(true);
    apiMock.get.mockResolvedValue({ data: { ...FULL, preview: true } });
    renderPage("/dein-jahr?vorschau=1");
    expect(await screen.findByTestId("year-review")).toHaveAttribute("data-animate", "off");
    expect(apiMock.get).toHaveBeenCalledWith("/year-review/me", { params: { vorschau: true } });
    expect(screen.getByTestId("year-review-bar-0").style.transition).toBe("none");
    expect(screen.getByTestId("year-review")).toHaveTextContent("Dein 2026 · Vorschau");
  });

  it("ohne Rückblick ein Hinweis statt leerer Seiten", async () => {
    reducedMotion(false);
    apiMock.get.mockRejectedValue({ response: { status: 404 } });
    renderPage();
    expect(await screen.findByTestId("year-review-none")).toHaveTextContent("Gerade kein Jahresrückblick");
    await waitFor(() => expect(screen.queryByTestId("year-review")).toBeNull());
  });
});
