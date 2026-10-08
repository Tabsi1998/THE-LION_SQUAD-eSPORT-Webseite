import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Die Teilen-Seite eines Ergebnisses (#1194): hohes Bild, Platz, Turnier, Person bzw. Team, Weg und Knöpfe;
// bei 404 „nicht öffentlich“.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (v) => v || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: ResultSharePage } = await import("./ResultSharePage");

const DATA = {
  tournament: { id: "t1", slug: "fc26-cup", title: "FC 26 Herbst-Cup" }, event_name: "LAN-Wochenende Herbst", date: "20.09.2026",
  user: { username: "neonfalke", display_name: "Neonfalke" }, team_name: null, rank: 2, participant_count: 16, participant_word: "Spieler",
  kind: "knockout", chips: ["Halbfinale 2:1", "Finale 1:2"],
  steps: [{ label: "Halbfinale", result: "2:1", outcome: "win", kind: "duel" }, { label: "Finale", result: "1:2", outcome: "loss", kind: "duel" }],
  club_name: "THE LION SQUAD", domain: "verein.example", path: "/tournaments/fc26-cup/ergebnis/neonfalke",
  image_paths: { story: "/api/share/result/fc26-cup/neonfalke/story.png", wide: "/api/share/result/fc26-cup/neonfalke/wide.png" },
  headline: "Platz 2 im FC 26 Herbst-Cup", share_text: "Ich habe Platz 2 im FC 26 Herbst-Cup geholt – bei THE LION SQUAD.",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/tournaments/fc26-cup/ergebnis/neonfalke"]}>
      <Routes><Route path="/tournaments/:slug/ergebnis/:username" element={<ResultSharePage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
});

describe("ResultSharePage", () => {
  it("zeigt Bild, Platz, Turnier, Person, Weg und die Knöpfe", async () => {
    apiMock.get.mockResolvedValue({ data: DATA });
    renderPage();
    expect(await screen.findByTestId("result-share-headline")).toHaveTextContent("Platz 2 im FC 26 Herbst-Cup");
    expect(apiMock.get).toHaveBeenCalledWith("/share/result/fc26-cup/neonfalke");
    expect(screen.getByTestId("result-share-image")).toHaveAttribute("src", DATA.image_paths.story);
    expect(screen.getByTestId("result-share-rank")).toHaveTextContent("2.");
    expect(screen.getByTestId("result-share-card")).toHaveTextContent("von 16 Spieler");
    expect(screen.getByTestId("result-share-person")).toHaveAttribute("href", "/u/neonfalke");
    const steps = screen.getAllByTestId("result-path-step");
    expect(steps.map((step) => step.textContent)).toEqual(["HalbfinaleSieg2:1", "FinaleNiederlage1:2"]);
    expect(screen.getByTestId("result-share-wide")).toHaveAttribute("download", "ergebnis-fc26-cup-neonfalke-wide.png");
    expect(screen.getByTestId("result-share-actions")).toBeInTheDocument();
    expect(screen.queryByTestId("result-share-actions-page")).toBeNull();
    expect(screen.getByTestId("result-share-back")).toHaveAttribute("href", "/tournaments/fc26-cup");
  });

  it("beim Team steht der Teamname und wer geteilt hat", async () => {
    apiMock.get.mockResolvedValue({ data: { ...DATA, team_name: "Lions Rocket", rank: 1, participant_word: "Teams", headline: "Platz 1 im FC 26 Herbst-Cup" } });
    renderPage();
    expect(await screen.findByTestId("result-share-person")).toHaveTextContent("Lions Rocketgeteilt von Neonfalke");
    expect(screen.getByTestId("result-path")).toHaveTextContent("Weg des Teams");
  });

  it("nicht öffentlich: ein freundlicher Hinweis statt Bild", async () => {
    apiMock.get.mockRejectedValue({ response: { status: 404 } });
    renderPage();
    expect(await screen.findByTestId("result-share-private")).toHaveTextContent("Dieses Ergebnis ist nicht öffentlich");
  });
});
