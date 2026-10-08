import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Vitrine (#1334): Gold, Silber und Bronze als gezeichnete Pokale auf dem Brett, Teilnahmen ohne Podest stehen nicht
// darin; ein Klick öffnet die Details. „Über uns“ zeigt die drei neuesten.

vi.mock("@/lib/api", () => ({ resolveMediaUrl: (value) => value || "" }));

const { TrophyShelf, fieldSize, trophiesOf } = await import("./TrophyShelf");

const ITEMS = [
  { id: "bronze", title: "Racing League 35", best_placement: 3, start_date: "2025-05-03", game: { name: "F1 25" }, entries: [{ kind: "solo", placement: 3, participant_count: 13 }] },
  { id: "gold", title: "Herbst-Cup 3er-Teams", best_placement: 1, start_date: "2024-09-28", game: { name: "Call of Duty" }, entries: [{ kind: "team", placement: 1, team_count: 11 }] },
  { id: "silver", title: "Liga Saison 3", best_placement: 2, start_date: "2024-06-17", game: { name: "Rocket League" }, entries: [{ kind: "team", placement: 2, team_count: 10 }] },
  { id: "fuenfter", title: "Frühjahrs-Cup", best_placement: 5, start_date: "2026-03-03", game: { name: "Call of Duty" }, entries: [{ kind: "team", placement: 5, team_count: 16 }] },
];

test("Gold, Silber, Bronze als Pokale mit Platz, Wettbewerb und Feldgröße; ohne Podest nicht in der Vitrine", () => {
  const trophies = trophiesOf(ITEMS);
  expect(trophies.map((item) => item.id)).toEqual(["gold", "silver", "bronze"]);
  render(<MemoryRouter><TrophyShelf items={trophies} testId="t" /></MemoryRouter>);
  expect(screen.getByTestId("t-gold")).toHaveTextContent("1. PlatzHerbst-Cup 3er-TeamsCall of Duty · 11 Teams");
  expect(screen.getByTestId("t-gold")).toHaveAttribute("href", "/references/gold");
  expect(screen.getByTestId("t-gold")).toHaveClass("tls-card", "tls-trophy--gold");
  expect(screen.getByTestId("t-gold").querySelector("svg")).toHaveAttribute("data-medal", "gold");
  expect(screen.getByTestId("t-silver").querySelector("svg")).toHaveAttribute("data-medal", "silver");
  expect(screen.getByTestId("t-bronze")).toHaveTextContent("3. PlatzRacing League 35F1 25 · 13 Teilnehmende");
  expect(screen.queryByTestId("t-fuenfter")).toBeNull();
  expect(screen.getByRole("img", { name: "Pokal in Silber" })).toBeInTheDocument();
});

test("„Über uns“: die drei neuesten Pokale, klein ohne Spielnamen", () => {
  const newest = trophiesOf(ITEMS, { newest: true, limit: 2 });
  expect(newest.map((item) => item.id)).toEqual(["bronze", "gold"]);
  render(<MemoryRouter><TrophyShelf items={newest} compact testId="t" /></MemoryRouter>);
  expect(screen.getByTestId("t-gold")).toHaveTextContent("1. PlatzHerbst-Cup 3er-Teams11 Teams");
  expect(fieldSize({ best_placement: 2, entries: [] })).toBe("");
});

test("ohne Pokale bleibt die Vitrine weg", () => {
  const { container } = render(<MemoryRouter><TrophyShelf items={[]} /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
});
