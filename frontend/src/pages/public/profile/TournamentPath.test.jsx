import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Profil (#1193): Turnierweg zum Aufklappen und die Bilanz gegen Gegner - Farben wie im Baum (Siege hell, Niederlagen grau).

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (v) => v || "" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { RecordCard, ReferenceWithPath, initials, recordLabel, stepLine } = await import("./TournamentPath");

const ITEM = { id: "tournament:t-old", kind: "tournament", title: "FC 26 Cup", target_id: "fc-26-cup", rank: 2 };
const PATH = {
  tournament: { id: "t-old", slug: "fc-26-cup", title: "FC 26 Cup" }, kind: "knockout", team_name: null, date: "2026-10-17T13:00:00Z",
  steps: [
    { kind: "duel", label: "Viertelfinale", result: "2:0", outcome: "win", opponent: "Blitzbirne" },
    { kind: "duel", label: "Halbfinale", result: "2:1", outcome: "win", opponent: null },
    { kind: "duel", label: "Finale", result: "1:2", outcome: "loss", opponent: "TurboTina" },
  ],
  final: { rank: 2, participant_count: 8 },
  share: { shareable: true, path: "/tournaments/fc-26-cup/ergebnis/neonfalke", image_paths: { story: "/s.png", wide: "/w.png" }, headline: "Platz 2 im FC 26 Cup", share_text: "Ich habe Platz 2 im FC 26 Cup geholt." },
};

function renderPath(props = {}) {
  return render(
    <MemoryRouter>
      <ReferenceWithPath item={ITEM} username="neonfalke" {...props}><div data-testid="row">FC 26 Cup</div></ReferenceWithPath>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
});

describe("Turnierweg", () => {
  it("klappt auf, lädt den Weg erst dann und zeigt Runden, Gegner und Endplatz", async () => {
    apiMock.get.mockResolvedValue({ data: PATH });
    renderPath({ own: true });
    expect(screen.getByTestId("row")).toBeInTheDocument();
    expect(apiMock.get).not.toHaveBeenCalled();
    const toggle = screen.getByTestId("reference-path-toggle-tournament:t-old");
    expect(toggle).toHaveTextContent("Dein Weg");
    fireEvent.click(toggle);
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/profile/neonfalke/tournaments/fc-26-cup/path", undefined));
    const steps = await screen.findAllByTestId("tournament-path-step");
    expect(steps.map((step) => step.textContent)).toEqual([
      "Viertelfinale2:0 gegen Blitzbirne (Sieg)", "Halbfinale2:1 (Sieg)", "Finale1:2 gegen TurboTina (Niederlage)",
    ]);
    expect(screen.getByTestId("tournament-path-final")).toHaveTextContent("2. Platz von 8");
    expect(screen.getByTestId("reference-share-tournament:t-old")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(screen.queryByTestId("tournament-path-tournament:t-old")).toBeNull();
  });

  it("für andere: öffentliche Sicht, ohne Teilen-Knopf; Fehler ergeben einen Satz", async () => {
    apiMock.get.mockResolvedValue({ data: { ...PATH, share: null } });
    renderPath({ publicView: true });
    fireEvent.click(screen.getByTestId("reference-path-toggle-tournament:t-old"));
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/profile/neonfalke/tournaments/fc-26-cup/path", { params: { view_as: "public" } }));
    await screen.findAllByTestId("tournament-path-step");
    expect(screen.queryByTestId("reference-share-tournament:t-old")).toBeNull();
  });

  it("Fast Laps und Einträge ohne Ziel klappen nicht auf", () => {
    render(<MemoryRouter><ReferenceWithPath item={{ ...ITEM, kind: "fastlap" }} username="neonfalke"><div data-testid="row" /></ReferenceWithPath></MemoryRouter>);
    expect(screen.queryByTestId("reference-path-toggle-tournament:t-old")).toBeNull();
  });

  it("Zeilentext für Freilos und Durchgänge", () => {
    expect(stepLine({ kind: "duel", result: "", opponent: "Freilos" })).toBe("weiter · Freilos");
    expect(stepLine({ kind: "heat", result: "Platz 2 von 4" })).toBe("Platz 2 von 4");
    expect(stepLine({ kind: "duel", result: "2:0", opponent: "Blitzbirne" })).toBe("2:0 gegen Blitzbirne");
  });
});

describe("Bilanz gegen Gegner", () => {
  it("zeigt die häufigsten Gegner mit Siegen in Cyan und Niederlagen grau, mit Link nur bei öffentlichem Profil", async () => {
    apiMock.get.mockResolvedValue({ data: { opponents: [
      { key: "user:u-pp", kind: "user", name: "PixelPanther", username: "pixelpanther", wins: 3, losses: 1, draws: 0, games: 4 },
      { key: "user:u-tt", kind: "user", name: "TurboTina", username: null, wins: 1, losses: 2, draws: 1, games: 4 },
      { key: "team:t-pxp", kind: "team", name: "Pixelpiraten", tag: "PXP", team_id: "t-pxp", wins: 2, losses: 0, draws: 0, games: 2 },
    ] } });
    render(<MemoryRouter><RecordCard username="neonfalke" /></MemoryRouter>);
    expect(await screen.findByTestId("profile-record")).toHaveTextContent("Bilanz gegen");
    expect(apiMock.get).toHaveBeenCalledWith("/profile/neonfalke/record", undefined);
    const panther = screen.getByTestId("profile-record-user:u-pp");
    expect(panther).toHaveAttribute("aria-label", "gegen PixelPanther: 3 Siege, 1 Niederlage");
    expect(panther.querySelector("a")).toHaveAttribute("href", "/u/pixelpanther");
    expect(screen.getByTestId("profile-record-user:u-tt").querySelector("a")).toBeNull();
    expect(screen.getByTestId("profile-record-team:t-pxp").querySelector("a")).toHaveAttribute("href", "/teams/t-pxp");
    expect(screen.getByTestId("profile-record-user:u-tt")).toHaveAttribute("aria-label", "gegen TurboTina: 1 Sieg, 1 Unentschieden, 2 Niederlagen");
  });

  it("ohne Gegner steht nichts da; die öffentliche Sicht fragt mit view_as", async () => {
    apiMock.get.mockResolvedValue({ data: { opponents: [] } });
    const { container } = render(<MemoryRouter><RecordCard username="neonfalke" publicView /></MemoryRouter>);
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/profile/neonfalke/record", { params: { view_as: "public" } }));
    expect(container).toBeEmptyDOMElement();
    expect(recordLabel({ name: "X", wins: 1, losses: 1, draws: 0 })).toBe("gegen X: 1 Sieg, 1 Niederlage");
    expect([initials("PixelPanther"), initials("Lions Rocket"), initials("lunabyte")]).toEqual(["PP", "LR", "LU"]);
  });
});
