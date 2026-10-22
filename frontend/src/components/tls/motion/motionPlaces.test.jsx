import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StandingsTable } from "@/components/tls/tournament/StandingsTable";
import { Points } from "@/components/tls/series/SeriesStandings";

// Bausteine im Einsatz (#1969): Punkte in Turnier- und Serientabellen zählen beim ersten Sichtbarwerden hoch. Ohne
// Auskunft des Browsers (kein matchMedia) stehen sie sofort - so lesen die übrigen Tests weiter den Endwert.

afterEach(() => {
  delete window.matchMedia;
});

const ROWS = [{ registration_id: "a", rank: 1, display_name: "Probe Eins", played: 3, won: 3, drawn: 0, lost: 0, score_diff: 5, form: ["W"], points: 9 }];

test("Turnier-Tabelle: die Punkte zählen hoch, andere Spalten stehen", () => {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  render(<StandingsTable rows={ROWS} />);
  const row = screen.getByTestId("standing-row-a");
  expect(within(row).getByText("9", { selector: ".sr-only" })).toBeInTheDocument();
  expect(row.querySelector("[data-counting='true']")).not.toBeNull();
});

test("Serien-Tabelle: Punkte zählen hoch; ohne matchMedia sofort der Endwert", () => {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const { unmount } = render(<MemoryRouter><span data-testid="p"><Points row={{ points: 37.5 }} topN={0} /></span></MemoryRouter>);
  expect(screen.getByTestId("p").querySelector("[data-counting='true']")).not.toBeNull();
  unmount();
  delete window.matchMedia;
  render(<MemoryRouter><span data-testid="p"><Points row={{ points: 37.5 }} topN={0} /></span></MemoryRouter>);
  expect(screen.getByTestId("p")).toHaveTextContent("37,5");
  expect(screen.getByTestId("p").querySelector("[data-counting]")).toBeNull();
});
