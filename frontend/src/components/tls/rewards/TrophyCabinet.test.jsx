import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EmblemRow, TrophyCabinet } from "./TrophyCabinet";

// Reiter „Trophäen“ (#2425): Karten mit Bild, Name, Wettbewerb, Platz, Datum und Link, Filter, leerer Zustand, Embleme (höchstens drei).
// Erfundene Daten - auch die schlimmsten Fälle: ein Name ohne Leerzeichen, ein Zeichen, Emoji.

vi.mock("@/lib/api", () => ({ resolveMediaUrl: (value) => value || "" }));
const motion = { allowed: false };
vi.mock("@/lib/motion", () => ({ motionAllowed: () => motion.allowed }));

const LONG = "Unglaublichlangerbelohnungsnameohneeinzigesleerzeichenderjedekartesprengenwürde";
const reward = (id, kind, name, extra = {}) => ({
  id, kind, rank: 1, rank_label: "1. Platz", date: "2026-11-09", game: { name: "Probe Shooter" }, season: { name: "Season 1" },
  tournament: { id: "t1", slug: "probe-a", title: "Probe-Liga · Season 1" }, league: { division_label: "Liga 1", staffel: "A" },
  reward: { id, kind, kind_label: kind, name, art: { season: "Season 1", division: "Liga 1", place: "1. Platz", metal: "gold" } }, ...extra,
});
const CUP = { id: "cup", kind: "trophy", rank: 2, rank_label: "2. Platz", date: "2025-05-03", game: { name: "Rennspiel" }, participants: 12,
  tournament: { id: "t9", slug: "fruehjahrs-cup", title: "Frühjahrs-Cup" }, reward: null };
const AWARDS = [CUP, reward("gold", "medal", LONG), reward("e1", "emblem", "🦁"), reward("e2", "emblem", "X"), reward("e3", "emblem", "Drittes Emblem"),
  reward("banner", "banner", "Season-Banner")];

function renderCabinet(props) {
  return render(<MemoryRouter><TrophyCabinet awards={AWARDS} empty="Noch keine Trophäen." animate={false} {...props} /></MemoryRouter>);
}

test("Karten: Bild, Name, Wettbewerb, Platz, Datum und Link - Pokal und Belohnung zusammen", () => {
  renderCabinet();
  const cup = screen.getByTestId("trophy-card-cup");
  expect(cup).toHaveTextContent("Pokal");
  expect(cup).toHaveTextContent("Frühjahrs-Cup");
  expect(cup).toHaveTextContent("Rennspiel · 12 Teilnehmer");
  expect(cup).toHaveTextContent("2. Platz");
  expect(cup).toHaveTextContent("3.5.2025");
  expect(within(cup).getByRole("link")).toHaveAttribute("href", "/tournaments/fruehjahrs-cup");
  expect(within(cup).getByTestId("trophy-art-cup")).toHaveAttribute("data-medal", "silver");
  expect(screen.getByTestId("trophy-name-gold")).toHaveTextContent(LONG);
  expect(screen.getByTestId("trophy-competition-gold")).toHaveTextContent("Probe-Liga · Season 1 · Liga 1 · Staffel A");
  expect(screen.getByTestId("trophy-cabinet-count")).toHaveTextContent("6 Trophäen");
  // Gäste wählen nichts.
  expect(screen.queryByTestId("trophy-banner-cup")).toBeNull();
});

test("Filter: Art, Spiel, Season bzw. Jahr und Platz; passt nichts, steht es da - mit Zurücksetzen", () => {
  renderCabinet();
  fireEvent.click(screen.getByTestId("trophy-cabinet-kind-emblem"));
  expect(screen.getByTestId("trophy-cabinet-count")).toHaveTextContent("3 von 6");
  expect(screen.queryByTestId("trophy-card-cup")).toBeNull();
  fireEvent.change(screen.getByTestId("trophy-cabinet-game"), { target: { value: "Rennspiel" } });
  expect(screen.getByTestId("trophy-cabinet-no-match")).toHaveTextContent("Keine Trophäe passt zu diesem Filter.");
  fireEvent.click(screen.getByTestId("trophy-cabinet-reset"));
  expect(screen.getByTestId("trophy-cabinet-count")).toHaveTextContent("6 Trophäen");
  fireEvent.change(screen.getByTestId("trophy-cabinet-period"), { target: { value: "2025" } });
  expect(screen.getAllByTestId(/^trophy-card-/).map((node) => node.dataset.testid)).toEqual(["trophy-card-cup"]);
  fireEvent.click(screen.getByTestId("trophy-cabinet-reset"));
  fireEvent.change(screen.getByTestId("trophy-cabinet-place"), { target: { value: "2" } });
  expect(screen.getAllByTestId(/^trophy-card-/)).toHaveLength(1);
});

test("Leerer Zustand ohne jede Trophäe", () => {
  render(<MemoryRouter><TrophyCabinet awards={[]} empty="Noch keine Trophäen aus öffentlichen Wettbewerben." /></MemoryRouter>);
  expect(screen.getByTestId("trophy-cabinet-empty")).toHaveTextContent("Noch keine Trophäen aus öffentlichen Wettbewerben.");
  expect(screen.queryByTestId("trophy-cabinet-filters")).toBeNull();
});

test("Besitzer: Banner, Titel und höchstens drei Embleme - beim vierten ist der Knopf gesperrt und sagt warum", () => {
  const owner = { featuredId: "banner", titleId: null, emblemIds: ["e1", "e2"], onFeature: vi.fn(), onTitle: vi.fn(), onEmblems: vi.fn() };
  const { rerender } = renderCabinet({ owner });
  expect(screen.getByTestId("trophy-banner-banner")).toHaveTextContent("Banner ✓");
  expect(screen.getByTestId("trophy-emblem-e2")).toHaveTextContent("Emblem 2 ✓");
  // Nur Emblem und Medaille einer Belohnung: kein Emblem-Knopf am Pokal oder am Banner.
  expect(screen.queryByTestId("trophy-emblem-cup")).toBeNull();
  expect(screen.queryByTestId("trophy-emblem-banner")).toBeNull();
  expect(screen.getByTestId("trophy-cabinet-emblem-hint")).toHaveTextContent("2 von 3 gewählt.");
  fireEvent.click(screen.getByTestId("trophy-emblem-gold"));
  expect(owner.onEmblems).toHaveBeenLastCalledWith(["e1", "e2", "gold"]);
  fireEvent.click(screen.getByTestId("trophy-emblem-e1"));
  expect(owner.onEmblems).toHaveBeenLastCalledWith(["e2"]);
  fireEvent.click(screen.getByTestId("trophy-banner-banner"));
  expect(owner.onFeature).toHaveBeenLastCalledWith(null);
  fireEvent.click(screen.getByTestId("trophy-banner-cup"));
  expect(owner.onFeature).toHaveBeenLastCalledWith("cup");

  const full = { ...owner, emblemIds: ["e1", "e2", "e3"], onEmblems: vi.fn() };
  rerender(<MemoryRouter><TrophyCabinet awards={AWARDS} empty="" animate={false} owner={full} /></MemoryRouter>);
  const blocked = screen.getByTestId("trophy-emblem-gold");
  expect(blocked).toBeDisabled();
  expect(blocked).toHaveAttribute("title", "Höchstens 3 Embleme – nimm zuerst eines weg.");
  fireEvent.click(blocked);
  expect(full.onEmblems).not.toHaveBeenCalled();
});

test("Bewegung: beim Öffnen gestaffelt, beim Filtern nicht mehr", () => {
  motion.allowed = true;
  render(<MemoryRouter><TrophyCabinet awards={AWARDS} empty="" /></MemoryRouter>);
  const cards = screen.getAllByTestId(/^trophy-card-/);
  expect(cards.every((card) => card.getAttribute("data-play") === "run")).toBe(true);
  expect(cards.map((card) => card.style.getPropertyValue("--tls-i"))).toEqual(["0", "1", "2", "3", "4", "5"]);
  fireEvent.click(screen.getByTestId("trophy-cabinet-kind-medal"));
  expect(screen.getByTestId("trophy-card-gold")).not.toHaveAttribute("data-play");
  motion.allowed = false;
});

test("Embleme neben dem Namen: höchstens drei, nur Belohnungen, mit Namen als Hinweis", () => {
  const { container, rerender } = render(<EmblemRow emblems={[...AWARDS.slice(1, 5)]} testId="row" />);
  expect(screen.getByTestId("row")).toHaveAttribute("aria-label", `Embleme: ${LONG}, 🦁, X`);
  expect(container.querySelectorAll(".tls-emblem-row__item")).toHaveLength(3);
  rerender(<EmblemRow emblems={[CUP]} testId="row" />);
  expect(screen.queryByTestId("row")).toBeNull();
  rerender(<EmblemRow emblems={null} testId="row" />);
  expect(screen.queryByTestId("row")).toBeNull();
});
