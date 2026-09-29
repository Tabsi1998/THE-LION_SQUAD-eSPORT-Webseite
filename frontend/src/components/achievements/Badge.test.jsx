import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";
import { BADGE_ART_KEYS, MOTIFS, ALIASES, resolveArt, hasMotif } from "./badgeArt";
import { MATERIAL_LOOKS, MATERIAL_ORDER, materialForLevel, rankNotches } from "./materials";

// Abzeichen (E8, #618): Material-Klasse und Kerben, Silhouette mit Fortschrittsring, Motiv aus dem
// Katalog-Schlüssel mit Verwandten, Lucide-Rückfall, Legendär mit Löwenkopf, Geheim mit Fragezeichen.

describe("Badge", () => {
  it("rendert Material, Rang-Kerben und das Motiv", () => {
    render(<Badge material="gold" rank={5} art="crossed-swords" testId="b" />);
    const svg = screen.getByTestId("b");
    expect(svg).toHaveAttribute("data-material", "gold");
    expect(svg).toHaveAttribute("data-rank", "5");
    expect(svg.querySelector("[data-notches='5']").querySelectorAll("line")).toHaveLength(5);
    expect(svg.querySelector("[data-motif='crossed-swords']")).not.toBeNull();
    expect(svg.querySelector("[data-texture]")).toBeNull();
    expect(svg.querySelector(".tls-badge__sparkles")).not.toBeNull();
    expect(svg).toHaveAttribute("aria-label", "Gold V");
    expect(svg.classList.contains("tls-badge--animate")).toBe(false);
  });

  it("zeigt die Silhouette mit Fortschrittsring statt Material", () => {
    render(<Badge material="diamond" rank={7} art="stopwatch" earned={false} percent={40} testId="b" />);
    const svg = screen.getByTestId("b");
    expect(svg).toHaveAttribute("data-locked", "true");
    expect(svg.querySelector("[data-progress='40']")).not.toBeNull();
    expect(svg.querySelector("[data-facets]")).toBeNull();
    expect(svg.querySelector(".tls-badge__sheen")).toBeNull();
    expect(svg.classList.contains("tls-badge--locked")).toBe(true);
  });

  it("leitet das Material aus dem alten Level ab und zeichnet Texturen je Material", () => {
    expect(materialForLevel(1)).toBe("bronze");
    expect(materialForLevel(4)).toBe("platinum");
    expect(materialForLevel(5)).toBe("legendary");
    expect(materialForLevel(5, { negative: true })).toBe("hidden");
    render(<Badge level={4} art="gauge" testId="b" />);
    expect(screen.getByTestId("b")).toHaveAttribute("data-material", "platinum");
    expect(screen.getByTestId("b").querySelector("[data-texture='ice']")).not.toBeNull();
    expect(rankNotches(0, "diamond")).toBe(7);
    expect(rankNotches(3, "gold")).toBe(3);
    expect(rankNotches(0, "legendary")).toBe(0);
  });

  it("Legendär trägt den Löwenkopf im Rand und Flammen, Geheim das Fragezeichen", () => {
    const { rerender } = render(<Badge material="legendary" art="honor-lion" animate testId="b" />);
    let svg = screen.getByTestId("b");
    expect(svg.querySelector("[data-lion-crest]")).not.toBeNull();
    expect(svg.querySelector(".tls-badge__flames")).not.toBeNull();
    expect(svg.classList.contains("tls-badge--animate")).toBe(true);
    rerender(<Badge material="hidden" art="secret" testId="b" />);
    svg = screen.getByTestId("b");
    expect(svg.querySelector(".tls-badge__question")).toHaveTextContent("?");
    expect(svg.querySelector("[data-texture='veil']")).not.toBeNull();
  });

  it("fällt bei unbekanntem Motiv auf das Lucide-Symbol zurück, kennt aber Verwandte", () => {
    expect(resolveArt("swords")).toBe("crossed-swords");
    expect(resolveArt("")).toBe("negative");
    expect(resolveArt("gibt-es-nicht")).toBeNull();
    expect(hasMotif("trophy")).toBe(true);
    render(<Badge material="silver" art="gibt-es-nicht" icon="trophy" testId="b" />);
    const svg = screen.getByTestId("b");
    expect(svg.querySelector("[data-motif]")).not.toBeNull();
    render(<Badge material="silver" art="wirklich-unbekannt" icon="wirklich-unbekannt" testId="c" />);
    expect(screen.getByTestId("c").querySelector("foreignObject")).not.toBeNull();
  });

  it("jedes Motiv zeichnet mindestens eine Form, Verwandte zeigen auf echte Motive", () => {
    expect(BADGE_ART_KEYS.length).toBeGreaterThanOrEqual(140);
    for (const key of BADGE_ART_KEYS) {
      const { container, unmount } = render(<svg><Badge material="bronze" art={key} /></svg>);
      const motif = container.querySelector(`[data-motif='${key}']`);
      expect(motif, key).not.toBeNull();
      expect(motif.querySelectorAll("path, circle, rect, ellipse, polygon, line").length, key).toBeGreaterThan(0);
      unmount();
    }
    for (const [alias, target] of Object.entries(ALIASES)) expect(MOTIFS[target], `${alias} → ${target}`).toBeTruthy();
    expect(MATERIAL_ORDER).toEqual(["wood", "iron", "bronze", "silver", "gold", "platinum", "diamond", "legendary", "hidden"]);
    for (const key of MATERIAL_ORDER) expect(MATERIAL_LOOKS[key].rim).toMatch(/^#/);
  });
});
