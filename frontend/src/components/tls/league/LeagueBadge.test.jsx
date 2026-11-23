import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeagueBadge } from "./LeagueBadge";
import { LeagueCurrent } from "./LeagueCurrent";
import { LeagueSeasonLine } from "./LeagueSeasonLine";

// Liga-Abzeichen (#1638) und laufende Ligen (#1630). Nur erfundene Namen.

function reduceMotion(reduce) {
  vi.stubGlobal("matchMedia", (query) => ({ matches: reduce && query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
}

afterEach(() => vi.unstubAllGlobals());

describe("LeagueBadge", () => {
  it.each([
    [1, "top", true],
    [2, "mid", false],
    [3, "base", false],
    [7, "base", false],
  ])("Liga %i hat die Form %s, die Krone nur Liga 1", (level, tier, crown) => {
    render(<LeagueBadge badge={{ level }} testId="b" />);
    expect(screen.getByTestId("b")).toHaveAttribute("data-tier", tier);
    expect(screen.queryByTestId("b-crown") !== null).toBe(crown);
    expect(screen.getByTestId("b-art").querySelector("text")).toHaveTextContent(String(level));
  });

  it("ist Cyan, Gold nur für den Season-Meister", () => {
    render(<><LeagueBadge badge={{ level: 2 }} testId="a" /><LeagueBadge badge={{ level: 2, champion: true }} testId="m" /></>);
    expect(screen.getByTestId("a")).toHaveAttribute("data-metal", "cyan");
    expect(screen.getByTestId("m")).toHaveAttribute("data-metal", "gold");
    expect(screen.getByTestId("m-label")).toHaveTextContent("Meister");
  });

  it("schreibt den Beinamen als Text daneben", () => {
    render(<LeagueBadge badge={{ level: 1, nickname: "Elite" }} testId="b" />);
    expect(screen.getByTestId("b-label")).toHaveTextContent("Liga 1 · Elite");
    expect(screen.getByTestId("b-art")).toHaveAttribute("aria-hidden", "true");
  });

  it("trägt ohne Text die Beschreibung am Wappen - mit Meister", () => {
    render(<LeagueBadge badge={{ level: 1, nickname: "Elite", champion: true }} label={false} testId="b" />);
    expect(screen.getByRole("img", { name: "Liga 1 · Elite, Season-Meister" })).toBeInTheDocument();
    expect(screen.queryByTestId("b-label")).toBeNull();
  });

  it.each(["list", "card", "hero"])("gibt es in der Größe %s", (size) => {
    render(<LeagueBadge badge={{ level: 3 }} size={size} testId="b" />);
    expect(screen.getByTestId("b").className).toContain(`tls-lbadge--${size}`);
  });

  it("zeichnet ohne gültige Liga N nichts", () => {
    const { container } = render(<LeagueBadge badge={{ level: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("steht mit „Bewegung reduzieren“ still und spielt sonst einmal", () => {
    reduceMotion(true);
    render(<LeagueBadge badge={{ level: 1 }} testId="still" />);
    expect(screen.getByTestId("still")).toHaveAttribute("data-play", "done");
    reduceMotion(false);
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<LeagueBadge badge={{ level: 1 }} testId="run" />);
    expect(screen.getByTestId("run")).toHaveAttribute("data-play", "run");
  });
});

const ROW = {
  registration_id: "r1", display_name: "Probe 1 · Kader B", squad_name: "Kader B", division_label: "Liga 1 · Elite", staffel: "A",
  badge: { level: 1, nickname: "Elite", champion: false }, league: { name: "Probe-Liga" }, season: { name: "Season 2" },
  link: "/liga/probe-liga/season-2#staffel-a", rank: 2, of: 6, zone: "playoff_promotion", zone_label: "Relegation um den Aufstieg",
  next_match: { opponent: "Probe 4", scheduled_at: null, matchday: 5 }, internal: true,
};

describe("LeagueCurrent", () => {
  it("zeigt Abzeichen, Staffel, Platz von N, Zone, nächstes Spiel und das Etikett", () => {
    render(<MemoryRouter><LeagueCurrent rows={[ROW]} nameOf={(row) => row.display_name} testId="p" /></MemoryRouter>);
    const row = screen.getByTestId("p-r1");
    expect(row).toHaveAttribute("href", "/liga/probe-liga/season-2#staffel-a");
    expect(screen.getByTestId("p-r1-label")).toHaveTextContent("Liga 1 · Elite · Staffel A");
    expect(screen.getByTestId("p-r1-badge")).toHaveAttribute("data-tier", "top");
    expect(screen.getByTestId("p-r1-place")).toHaveTextContent("Platz 2 von 6");
    expect(screen.getByTestId("p-r1-zone")).toHaveTextContent("Relegation um den Aufstieg");
    expect(screen.getByTestId("p-r1-next")).toHaveTextContent("gegen Probe 4 · Spieltag 5");
    expect(screen.getByTestId("p-r1-internal")).toBeInTheDocument();
    expect(row).toHaveTextContent("Probe 1 · Kader B");
  });

  it("vor dem ersten Ergebnis ohne Platz und ohne Zone", () => {
    render(<MemoryRouter><LeagueCurrent rows={[{ ...ROW, rank: null, zone: null, internal: false }]} testId="p" /></MemoryRouter>);
    expect(screen.getByTestId("p-r1-place")).toHaveTextContent("Noch ohne Ergebnis · 6 Teams");
    expect(screen.queryByTestId("p-r1-zone")).toBeNull();
    expect(screen.queryByTestId("p-r1-internal")).toBeNull();
  });

  it("ohne laufende Liga kein Abschnitt", () => {
    const { container } = render(<MemoryRouter><LeagueCurrent rows={[]} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});

const HISTORY = [
  { season_id: "s1", season_name: "Season 1", closed_at: "2026-03-01", rank: 1, of: 4, badge: { level: 2 }, display_name: "Kader A", zone: "promotion" },
  { season_id: "s2", season_name: "Season 2", closed_at: "2026-06-01", rank: 1, of: 4, badge: { level: 1 }, display_name: "Kader A", champion: true },
  { season_id: "s2", season_name: "Season 2", closed_at: "2026-06-01", rank: 3, of: 4, badge: { level: 2 }, display_name: "Kader B" },
  { season_id: "s1", season_name: "Season 1", closed_at: "2026-03-01", rank: 4, of: 4, badge: { level: 2 }, display_name: "Kader B" },
];

describe("LeagueSeasonLine", () => {
  it("zeichnet je Season einen Punkt, Meister in Gold, und beschreibt den Verlauf", () => {
    render(<LeagueSeasonLine rows={HISTORY.slice(0, 2)} testId="l" />);
    expect(screen.getByRole("img", { name: /Season 1: Liga 2, Platz 1 von 4; Season 2: Liga 1, Platz 1 von 4, Meister/ })).toBeInTheDocument();
    expect(screen.getByTestId("l-point-0-1")).toHaveAttribute("data-champion", "true");
    expect(screen.getByTestId("l-point-0-0")).not.toHaveAttribute("data-champion");
    expect(screen.queryByTestId("l-legend")).toBeNull();
  });

  it("zeigt auf der Teamseite je Co-Team eine Linie mit Legende", () => {
    render(<LeagueSeasonLine rows={HISTORY} byTeam testId="l" />);
    expect(screen.getByTestId("l-legend")).toHaveTextContent("Kader A");
    expect(screen.getByTestId("l-legend")).toHaveTextContent("Kader B");
    expect(screen.getAllByText(/^Liga \d$/).map((node) => node.textContent)).toEqual(["Liga 1", "Liga 2"]);
  });

  it("zeigt unter zwei Seasons nichts", () => {
    const { container } = render(<LeagueSeasonLine rows={HISTORY.slice(0, 1)} />);
    expect(container).toBeEmptyDOMElement();
  });
});
