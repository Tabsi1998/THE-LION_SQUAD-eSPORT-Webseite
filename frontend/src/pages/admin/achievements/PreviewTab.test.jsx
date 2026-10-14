import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin", ceremony_mode: "subtle" } }) }));
const playCeremonySound = vi.fn(() => true);
vi.mock("@/components/achievements/ceremony/sounds", async (importOriginal) => ({ ...(await importOriginal()), playCeremonySound: (...args) => playCeremonySound(...args) }));

const { PreviewTab } = await import("./PreviewTab");

// Warum so gezielt gearbeitet wird: Die Vorschau zeichnet über 140 Abzeichen (je ein SVG mit vielen Knoten), und jeder
// Schalter rendert sie alle neu; `getAllByRole` prüft zudem für jeden Treffer die Zugänglichkeit über die berechneten
// Stile aller Vorfahren. In jsdom ist beides teuer und war auf einem ausgelasteten CI-Runner der Grund, warum zwei
// Tests die 5-s-Grenze rissen. Deshalb: Rollen mit `hidden: true` abfragen und nach der Prüfung der vollen Galerie
// per Suche auf ein Motiv verengen, wo der Test die Galerie nicht mehr braucht.
const SINGLE_MOTIF = "stopwatch";

describe("Vorschau im Erfolge-Admin (E8/E10)", () => {
  beforeEach(() => playCeremonySound.mockClear());

  it("zeigt alle Motive im Material, die Materialreihe und reagiert auf die Schalter", () => {
    render(<MemoryRouter><PreviewTab /></MemoryRouter>);
    const gallery = screen.getByTestId("preview-gallery");
    expect(within(gallery).getAllByRole("button", { hidden: true }).length).toBeGreaterThanOrEqual(140);
    expect(screen.getByTestId("preview-count")).toHaveTextContent(/\d+ Motive/);
    const row = screen.getByTestId("preview-material-row");
    expect(within(row).getAllByRole("img", { hidden: true })).toHaveLength(9);
    expect(within(row).getByTestId("preview-material-legendary").querySelector("[data-lion-crest]")).not.toBeNull();

    // Ab hier genügt ein Motiv in der Galerie: Die Schalter rendern sonst jedes Mal alle 140+ Abzeichen neu.
    fireEvent.change(screen.getByTestId("preview-search"), { target: { value: SINGLE_MOTIF } });
    fireEvent.change(screen.getByTestId("preview-material"), { target: { value: "diamond" } });
    expect(within(gallery).getByTestId("preview-motif-stopwatch").querySelector("svg")).toHaveAttribute("data-material", "diamond");
    fireEvent.click(screen.getByTestId("preview-locked"));
    expect(within(gallery).getByTestId("preview-motif-stopwatch").querySelector("svg")).toHaveAttribute("data-locked", "true");
    fireEvent.click(screen.getByTestId("preview-motif-stopwatch"));
    expect(row).toHaveTextContent("„stopwatch“ in jedem Material");
    fireEvent.change(screen.getByTestId("preview-search"), { target: { value: "lion" } });
    expect(screen.getByTestId("preview-count")).toHaveTextContent("3 Motive");
  });

  it("zeigt auf Wunsch jedes Motiv in allen neun Materialien", () => {
    render(<MemoryRouter><PreviewTab /></MemoryRouter>);
    fireEvent.change(screen.getByTestId("preview-search"), { target: { value: "stopwatch" } });
    fireEvent.change(screen.getByTestId("preview-material"), { target: { value: "all" } });
    const line = within(screen.getByTestId("preview-matrix")).getByTestId("preview-matrix-stopwatch");
    const materials = [...line.querySelectorAll("svg[data-material]")].map((svg) => svg.getAttribute("data-material"));
    expect(materials).toEqual(["wood", "iron", "bronze", "silver", "gold", "platinum", "diamond", "legendary", "hidden"]);
  });

  it("spielt eine Zeremonie aus Material, Kategorie und Ablauf ab – mit Klang und weniger Bewegung als Schalter", async () => {
    render(<MemoryRouter initialEntries={["/admin/achievements?tab=preview"]}><PreviewTab /></MemoryRouter>);
    fireEvent.change(screen.getByTestId("preview-search"), { target: { value: SINGLE_MOTIF } });
    fireEvent.change(screen.getByTestId("ceremony-material"), { target: { value: "legendary" } });
    fireEvent.change(screen.getByTestId("ceremony-category"), { target: { value: "club" } });
    expect(screen.getByTestId("ceremony-reduced")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("ceremony-play"));
    const overlay = screen.getByTestId("achievement-unlock-overlay");
    expect(overlay).toHaveAttribute("data-material", "legendary");
    expect(overlay).toHaveAttribute("data-sequence", "legendary");
    expect(overlay).toHaveAttribute("data-motion", "banner");
    expect(overlay).toHaveAttribute("data-reduced", "true");
    expect(playCeremonySound).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ force: true }));
    fireEvent.click(screen.getByTestId("achievement-unlock-close"));
    await waitFor(() => expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull());

    // Klang aus, volle Bewegung: kein Ton, keine reduzierte Fassung.
    playCeremonySound.mockClear();
    fireEvent.click(screen.getByTestId("ceremony-sound"));
    fireEvent.click(screen.getByTestId("ceremony-reduced"));
    fireEvent.change(screen.getByTestId("ceremony-sequence"), { target: { value: "levelup" } });
    fireEvent.click(screen.getByTestId("ceremony-play"));
    const next = screen.getByTestId("achievement-unlock-overlay");
    expect(next).toHaveAttribute("data-sequence", "levelup");
    expect(next).not.toHaveAttribute("data-reduced");
    expect(playCeremonySound).not.toHaveBeenCalled();
  });
});
