import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SeriesProgress, SeriesRules } from "./SeriesParts";

// Serienseite (#2015): geplante Termine zeigen „3 von 9“ samt leeren Feldern für die Termine, die noch nicht im
// Kalender stehen, und die Regeln nennen, wie Double Up zählt. Nur erfundene Daten.

const round = (number, state) => ({ id: `t${number}`, code: `T${number}`, club_day: `2026-10-0${number}`, state, kind: "regular", counts: true });

test("3 von 9 gewertet, fünf leere Felder für die Termine, die noch fehlen", () => {
  const rounds = [round(1, "scored"), round(2, "scored"), round(3, "scored"), round(4, "planned")];
  render(<MemoryRouter><SeriesProgress progress={{ scored: 3, total: 9, cancelled: 0, next: null }} rounds={rounds} /></MemoryRouter>);
  expect(screen.getByTestId("series-progress")).toHaveTextContent("3 von 9 Runden gewertet");
  expect(screen.getAllByTestId("series-step-planned")).toHaveLength(5);
});

test("die Regeln nennen Double Up bei Turniertagen", () => {
  render(<SeriesRules rules={{ points_mode: "scheme", points_by_place: [35, 30, 26], day_rounds: { count: 5, points_by_place: [8, 7] }, tiebreakers: [] }} />);
  expect(screen.getByTestId("series-rules")).toHaveTextContent("Team-Platz k zählt wie Einzelplatz 2k−1");
});
