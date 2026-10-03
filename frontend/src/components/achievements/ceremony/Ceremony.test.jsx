import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Ceremony } from "./Ceremony";
import { planCeremony } from "./select";

// Zeremonie-Bühne (E8): Abläufe rendern das Richtige (Stapel mit Pfeilen, Sockel, Vitrine, Prisma,
// Legendär-Banner mit Fotomodus, erster Erfolg mit Link, Level-up mit Zahl und Titel), Escape schließt,
// reduzierte Bewegung lässt Partikel und Effekte weg, Klang folgt dem Plan.

vi.mock("./sounds", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, playCeremonySound: vi.fn(() => true) };
});
const { playCeremonySound } = await import("./sounds");

const tier = (code, material, rank, category, extra = {}) => ({ code, name: `Name ${code}`, description: `Beschreibung ${code}`, material, rank, category, points: rank * 10, icon: "trophy", art: "crossed-swords", group_name: "Gruppe", award_id: `aw-${code}`, ...extra });

function renderPlan(pkg, props = {}) {
  const plan = planCeremony(pkg);
  const onClose = vi.fn();
  const utils = render(<MemoryRouter><Ceremony plan={plan} onClose={onClose} {...props} /></MemoryRouter>);
  return { ...utils, plan, onClose };
}

beforeEach(() => { playCeremonySound.mockClear(); localStorage.clear(); });

describe("Ceremony", () => {
  it("zeigt ein einzelnes Abzeichen mit Bewegung, Punkten und Klang; Escape schließt", () => {
    const { onClose } = renderPlan({ tiers: [tier("a", "gold", 5, "fastlap")] });
    const overlay = screen.getByTestId("achievement-unlock-overlay");
    expect(overlay).toHaveAttribute("data-sequence", "single");
    expect(overlay).toHaveAttribute("data-motion", "driveby");
    expect(overlay).toHaveAttribute("data-material", "gold");
    expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("Neues Achievement!");
    expect(screen.getByTestId("ceremony-sub")).toHaveTextContent("Gold V freigeschaltet");
    expect(screen.getByTestId("ceremony-points")).toHaveTextContent("+50 Punkte");
    expect(screen.getByTestId("ceremony-badge")).toHaveAttribute("data-material", "gold");
    expect(screen.getByTestId("ceremony-particles")).toBeInTheDocument();
    expect(screen.getByTestId("ceremony-live")).toHaveTextContent("Name a, Gold, plus 50 Punkte");
    expect(playCeremonySound).toHaveBeenCalledWith({ material: "gold", special: null }, expect.objectContaining({ user: null }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("fächert den Stapel auf und blättert mit Pfeilen", () => {
    renderPlan({ tiers: [tier("a", "silver", 4, "match"), tier("b", "gold", 5, "team"), tier("c", "wood", 1, "profile")] });
    expect(screen.getByTestId("achievement-unlock-overlay")).toHaveAttribute("data-sequence", "stack");
    expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("3 neue Achievements!");
    expect(screen.getByTestId("ceremony-stack-index")).toHaveTextContent("1 / 3");
    expect(screen.getByTestId("ceremony-tier-b")).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByTestId("ceremony-next"));
    expect(screen.getByTestId("ceremony-stack-index")).toHaveTextContent("2 / 3");
    expect(screen.getByTestId("ceremony-tier-a")).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByTestId("ceremony-tier-c"));
    expect(screen.getByTestId("ceremony-stack-index")).toHaveTextContent("3 / 3");
    expect(screen.getByTestId("ceremony-next")).toBeDisabled();
    expect(playCeremonySound).toHaveBeenCalledWith({ material: "gold", special: null }, expect.anything());
  });

  it("Legendär: Banner, Name in Großbuchstaben, Fotomodus zur Teilen-Karte, Löwen-Klang", () => {
    renderPlan({ tiers: [tier("honor", "legendary", 8, "special", { name: "Ehrenlöwe" })] });
    expect(screen.getByTestId("ceremony-legendary-banner")).toHaveTextContent("Legendär");
    expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("EHRENLÖWE");
    expect(screen.getByTestId("ceremony-photo-mode")).toHaveAttribute("href", "/achievements/a/aw-honor");
    expect(playCeremonySound).toHaveBeenCalledWith({ material: "legendary", special: "legendary" }, expect.anything());
  });

  it("Diamant mit Prisma, Gruppe mit Sockel und sieben Stufen, Kategorie mit Vitrine und Flut", () => {
    const { unmount } = renderPlan({ tiers: [tier("d", "diamond", 7, "match")] });
    expect(screen.getByTestId("ceremony-prism")).toBeInTheDocument();
    unmount();
    const second = renderPlan({ tiers: [tier("g", "diamond", 7, "match")], context: { groupCompleted: "grp" } });
    expect(screen.getByTestId("achievement-unlock-overlay")).toHaveAttribute("data-sequence", "group");
    expect(within(screen.getByTestId("ceremony-pedestal")).getAllByRole("img")).toHaveLength(7);
    expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("Gruppe vollständig");
    second.unmount();
    renderPlan({ tiers: [tier("k", "gold", 5, "season")], context: { categoryCompleted: "season" } });
    expect(screen.getByTestId("ceremony-vitrine")).toBeInTheDocument();
    expect(screen.getByTestId("ceremony-flood")).toBeInTheDocument();
  });

  it("erster Erfolg erklärt und verlinkt den Schaukasten; Level-up zeigt Zahl und Titel, Prestige den Stern", () => {
    const { unmount } = renderPlan({ tiers: [tier("f", "wood", 1, "community")], context: { firstEver: true } });
    expect(screen.getByTestId("ceremony-first-text")).toHaveTextContent("Das war dein erster Erfolg");
    expect(screen.getByTestId("ceremony-showcase-link")).toHaveAttribute("href", "/achievements");
    unmount();
    const level = renderPlan({ tiers: [], levelUp: { level: 10, previous: 9, title: "Kämpfer", titleChanged: true, prestige: 1, prestigeGained: false } }, { reduced: true });
    expect(screen.getByTestId("achievement-unlock-overlay")).toHaveAttribute("data-sequence", "levelup");
    expect(screen.getByTestId("ceremony-level-number")).toHaveTextContent("10");
    expect(screen.getByTestId("ceremony-title-banner")).toHaveTextContent("Neuer Titel: Kämpfer");
    expect(screen.queryByTestId("ceremony-prestige-stars")).toBeNull();
    expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("Level 10 erreicht");
    level.unmount();
    // Prestige (#617): von 60 zurück auf 1, ein Stern mehr - die Überschrift nennt das Prestige, nicht „Level 1 erreicht“.
    renderPlan({ tiers: [], levelUp: { level: 1, previous: 60, title: "Rookie", titleChanged: true, prestige: 1, prestigeGained: true } }, { reduced: true });
    expect(screen.getByTestId("ceremony-level-number")).toHaveTextContent("1");
    expect(screen.getByTestId("ceremony-prestige-stars")).toBeInTheDocument();
    expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("Prestige");
    expect(screen.getByTestId("ceremony-sub")).toHaveTextContent("1. Stern · Neustart bei Level 1");
  });

  it("Level-Zeremonien glitzern - nur mit „Bewegung reduzieren“ nicht", () => {
    const { unmount } = renderPlan({ tiers: [], levelUp: { level: 12, previous: 11, title: "Kämpfer" } });
    expect(screen.getByTestId("ceremony-particles")).toBeInTheDocument();
    unmount();
    renderPlan({ tiers: [], levelUp: { level: 12, previous: 11, title: "Kämpfer" } }, { reduced: true });
    expect(screen.queryByTestId("ceremony-particles")).toBeNull();
  });

  it("reduzierte Bewegung: keine Partikel, kein Prisma, kürzeres Schließen; Stumm schaltet den Klang", () => {
    vi.useFakeTimers();
    const { onClose } = renderPlan({ tiers: [tier("d", "diamond", 7, "match")] }, { reduced: true });
    expect(screen.queryByTestId("ceremony-particles")).toBeNull();
    expect(screen.queryByTestId("ceremony-prism")).toBeNull();
    expect(screen.getByTestId("achievement-unlock-overlay")).toHaveAttribute("data-reduced", "true");
    fireEvent.click(screen.getByTestId("achievement-unlock-mute"));
    expect(localStorage.getItem("tls_sound_muted")).toBe("1");
    act(() => { vi.advanceTimersByTime(4600); });
    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("hängt ein Level-up nach dem Abzeichen an", () => {
    vi.useFakeTimers();
    const { onClose } = renderPlan({ tiers: [tier("a", "bronze", 3, "match")], levelUp: { level: 4, previous: 3, title: "Rookie" } }, { reduced: true });
    expect(screen.getByTestId("ceremony-stage")).toHaveAttribute("data-phase", "badge");
    act(() => { vi.advanceTimersByTime(4600); });
    expect(screen.getByTestId("ceremony-stage")).toHaveAttribute("data-phase", "level");
    expect(screen.getByTestId("ceremony-level-number")).toHaveTextContent("4");
    expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(6100); });
    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
