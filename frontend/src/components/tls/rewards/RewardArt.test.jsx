import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RewardArt, placeMark } from "./RewardArt";
import { RewardChip, RewardCollection } from "./RewardCollection";

// Lionsquad-Vorlagen und Sammlung der Belohnungen (F.4, #2214, Nr. 164). Erfundene Namen.

const reward = (kind, extra = {}) => ({ kind, kind_label: { medal: "Medaille", banner: "Banner", emblem: "Emblem", title: "Titel" }[kind], name: `Probe ${kind}`,
  art: { league: "Probe-Liga", season: "Season 1", division: "Liga 2", place: "1. Platz", metal: "gold" }, ...extra });

test("jede Art ist eine eigene Vorlage, beschriftet mit Season, Liga N und Platz", () => {
  for (const kind of ["medal", "banner", "emblem", "title"]) {
    const { unmount } = render(<RewardArt reward={reward(kind)} testId={`art-${kind}`} />);
    const art = screen.getByTestId(`art-${kind}`);
    expect(art).toHaveClass(`tls-reward--${kind}`);
    expect(art).toHaveAttribute("data-metal", "gold");
    expect(art).toHaveAccessibleName(expect.stringContaining("Season 1 · Liga 2 · 1. Platz"));
    expect(art.querySelector("svg")).not.toBeNull();
    unmount();
  }
});

test("die Ziffer kommt aus dem Platz, ein Bereich bleibt ein Bereich, sonst ein Stern", () => {
  expect(placeMark("1. Platz")).toBe("1");
  expect(placeMark("Platz 4–6")).toBe("4–6");
  expect(placeMark("Alle Teilnehmer")).toBe("★");
  render(<RewardArt reward={reward("medal", { art: { place: "3. Platz", metal: "bronze" } })} testId="bronze" />);
  expect(screen.getByTestId("bronze").querySelector(".tls-reward__mark")).toHaveTextContent("3");
  expect(screen.getByTestId("bronze")).toHaveAttribute("data-metal", "bronze");
});

test("ein eigenes Bild steht an Stelle der Vorlage; unbekanntes Metall wird Lionsquad-Blau", () => {
  render(<RewardArt reward={reward("banner", { image_url: "/api/static/uploads/banner.png", art: { metal: "platin" } })} testId="own" />);
  const own = screen.getByTestId("own");
  expect(own.querySelector("img")).toHaveAttribute("src", expect.stringContaining("/api/static/uploads/banner.png"));
  expect(own.querySelector("svg")).toBeNull();
  expect(own).toHaveAttribute("data-metal", "lion");
});

test("die Bewegung spielt nur auf Wunsch und staffelt über den Index", () => {
  render(<><RewardArt reward={reward("medal")} play="run" index={2} testId="run" /><RewardArt reward={reward("medal")} testId="still" /></>);
  expect(screen.getByTestId("run")).toHaveAttribute("data-play", "run");
  expect(screen.getByTestId("run").style.getPropertyValue("--tls-i")).toBe("2");
  expect(screen.getByTestId("still")).not.toHaveAttribute("data-play");
});

const award = (id, kind, season, extra = {}) => ({ id, rank: 1, kind, updated_at: `2026-0${season}-01`, league: { season_id: `s${season}`, division_label: "Liga 2", staffel: "A" },
  team: { name: "Nordlicht" }, tournament: { slug: `probe-${season}` }, reward: { ...reward(kind), name: `${kind} ${season}`, art: { ...reward(kind).art, season: `Season ${season}` } }, ...extra });

test("die Sammlung zeigt je Season eine Gruppe; Auswahl nur mit Rechten, Titel nur für Titel", () => {
  const onFeature = vi.fn();
  const onTitle = vi.fn();
  const awards = [award("a", "medal", 1), award("b", "title", 2), { id: "pokal", rank: 1, kind: "trophy", reward: null }];
  const { rerender } = render(<MemoryRouter><RewardCollection awards={awards} featuredId="a" onFeature={onFeature} onTitle={onTitle} /></MemoryRouter>);
  const groups = screen.getAllByTestId("reward-collection-season");
  expect(groups.map((group) => group.querySelector("h3").textContent)).toEqual(["Season 2", "Season 1"]);
  expect(screen.queryByTestId("reward-card-pokal")).toBeNull();
  expect(screen.getByTestId("reward-card-a")).toHaveAttribute("data-featured", "true");
  expect(screen.getByTestId("reward-card-a")).toHaveTextContent("1. Platz · Liga 2 · Staffel A");
  expect(screen.getByTestId("reward-feature-a")).toHaveTextContent("Banner ✓");
  expect(screen.queryByTestId("reward-title-a")).toBeNull();
  screen.getByTestId("reward-title-b").click();
  expect(onTitle).toHaveBeenCalledWith("b");
  screen.getByTestId("reward-feature-a").click();
  expect(onFeature).toHaveBeenCalledWith(null);

  rerender(<MemoryRouter><RewardCollection awards={awards} /></MemoryRouter>);
  expect(screen.queryByTestId("reward-feature-a")).toBeNull();
  rerender(<MemoryRouter><RewardCollection awards={[{ id: "pokal", reward: null }]} /></MemoryRouter>);
  expect(screen.queryByTestId("reward-collection")).toBeNull();
});

test("der Titel neben dem Namen zeigt Grafik und Namen - ohne Belohnung nichts", () => {
  const { rerender } = render(<RewardChip award={award("b", "title", 2)} testId="chip" />);
  expect(screen.getByTestId("chip")).toHaveTextContent("title 2");
  rerender(<RewardChip award={null} testId="chip" />);
  expect(screen.queryByTestId("chip")).toBeNull();
});
