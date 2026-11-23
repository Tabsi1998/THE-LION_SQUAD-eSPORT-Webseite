import { readFileSync } from "node:fs";
import path from "node:path";
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

describe("Gold nur für Wappen und „Meister“ (Fabian 23.11.)", () => {
  const css = readFileSync(path.join(process.cwd(), "src/components/tls/league/leagueBadge.css"), "utf8");

  it("der Beiname bleibt in seiner normalen Farbe, auch beim Meister", () => {
    expect(css).toMatch(/\.tls-lbadge__nick \{[^}]*color: var\(--tls-brand, #29B6E8\)/);
    expect(css).not.toMatch(/data-metal="gold"\][^{]*\.tls-lbadge__nick/);
    expect(css).not.toMatch(/\.tls-lbadge__nick \{[^}]*--tls-lbadge-rgb/);
    expect(css).toMatch(/\.tls-lbadge__champion \{[^}]*color: var\(--tls-honor\)/);
  });

  it("„Meister“ steht als eigener Teil neben dem Beinamen", () => {
    render(<LeagueBadge badge={{ level: 1, nickname: "Elite", champion: true }} testId="m" />);
    const label = screen.getByTestId("m-label");
    expect(label.querySelector(".tls-lbadge__nick")).toHaveTextContent("Elite");
    expect(label.querySelector(".tls-lbadge__nick")).not.toHaveTextContent("Meister");
    expect(label.querySelector(".tls-lbadge__champion")).toHaveTextContent("Meister");
  });
});

describe("Saisonverlauf: höchstens vier Co-Teams, der Rest als Text (Fabian 23.11.)", () => {
  const team = (name, level, rank) => [1, 2].map((number) => ({ season_id: `s${number}`, season_name: `Season ${number}`,
    closed_at: `2026-0${number}-01`, rank, of: 6, badge: { level }, display_name: name }));
  const six = [team("Kader A", 1, 1), team("Kader B", 1, 3), team("Kader C", 2, 1), team("Kader D", 2, 2), team("Kader E", 3, 1),
    team("Kader F", 3, 4)].flat();

  it("zeigt die vier besten und nennt die übrigen", () => {
    render(<LeagueSeasonLine rows={six} byTeam testId="l" />);
    const legend = screen.getByTestId("l-legend");
    expect([...legend.querySelectorAll("li")].map((node) => node.textContent)).toEqual(["Kader A", "Kader B", "Kader C", "Kader D"]);
    expect(screen.getByTestId("l-more")).toHaveTextContent("und 2 weitere Co-Teams");
  });

  it("sagt es bei einem in der Einzahl", () => {
    render(<LeagueSeasonLine rows={six.filter((row) => row.display_name !== "Kader F")} byTeam testId="l" />);
    expect(screen.getByTestId("l-more")).toHaveTextContent("und 1 weiteres Co-Team");
  });

  it("ohne mehr als vier Co-Teams kein Hinweis", () => {
    render(<LeagueSeasonLine rows={six.slice(0, 8)} byTeam testId="l" />);
    expect(screen.queryByTestId("l-more")).toBeNull();
  });
});

describe("Review #1638: Saisonlinie lesbar und per Tastatur erreichbar", () => {
  const point = (name, number, level, rank) => ({ season_id: `s${number}`, season_name: `Season ${number}`, closed_at: `2026-0${number}-01`,
    rank, of: 6, badge: { level }, display_name: name });

  it("beschriftet den Platz nur am Anfang, am Ende und bei einem Wechsel - je Linie versetzt", () => {
    const rows = [1, 2, 3, 4].map((number) => point("Kader A", number, 2, number === 3 ? 2 : 1))
      .concat([1, 2, 3, 4].map((number) => point("Kader B", number, 2, 3)));
    render(<LeagueSeasonLine rows={rows} byTeam testId="l" />);
    expect(screen.getByTestId("l-rank-0-0")).toBeInTheDocument();
    expect(screen.queryByTestId("l-rank-0-1")).toBeNull();
    expect(screen.getByTestId("l-rank-0-2")).toHaveTextContent("2.");
    expect(screen.getByTestId("l-rank-0-3")).toBeInTheDocument();
    expect(screen.queryByTestId("l-rank-1-1")).toBeNull();
    const above = Number(screen.getByTestId("l-rank-0-0").getAttribute("y"));
    const below = Number(screen.getByTestId("l-rank-1-0").getAttribute("y"));
    expect(below).toBeGreaterThan(above + 20);
  });

  it("die Wischfläche ist per Tastatur erreichbar und benannt", () => {
    render(<LeagueSeasonLine rows={[point("Kader A", 1, 1, 1), point("Kader A", 2, 1, 2)]} testId="l" />);
    const region = screen.getByRole("region", { name: "Saisonverlauf, seitlich scrollbar" });
    expect(region).toHaveAttribute("tabindex", "0");
  });
});
