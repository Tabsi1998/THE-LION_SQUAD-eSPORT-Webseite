import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { GameMatchDataFields } from "./GameMatchDataFields";
import { gameMatchDataToForm } from "@/lib/gameMatchData";

// Schlimmster Fall für die Spiel-Daten (#1554, break-ui): lange Modusnamen bis zur Grenze (60), 20 Modi, eine
// Punktetabelle mit 64 Plätzen, ein Gerät, das die Liste nicht kennt, Best-of außerhalb der Auswahl, 600 Minuten.
// Bleibt als Rückfall-Test liegen.

const WORST = {
  match_modes: Array.from({ length: 20 }, (_, index) => ({
    mode: `m${index}`,
    label: index === 0 ? "Grand Prix 4 Rennen – 150cc, Spiegel-Modus, alle Items an".padEnd(60, "!") : `Modus ${index + 1}`,
    minutes: index === 1 ? 600 : 1,
    per_game: index % 2 === 1,
  })),
  players_per_run_local: 64,
  players_per_run_online: 1,
  station_devices: ["switch", "vr_brille"],
  setup_minutes: 0,
  points_table: Array.from({ length: 64 }, (_, index) => Math.max(0, 1000 - index * 16)),
  default_best_of: 9,
};

function Harness({ game }) {
  const [value, setValue] = useState(gameMatchDataToForm(game));
  return <GameMatchDataFields value={value} onChange={setValue} />;
}

test("20 Modi: „+ Modus“ ist gesperrt und sagt warum", () => {
  render(<Harness game={WORST} />);
  expect(WORST.match_modes[0].label).toHaveLength(60);
  expect(screen.getByTestId("game-edit-mode-label-0")).toHaveValue(WORST.match_modes[0].label);
  expect(screen.getByTestId("game-edit-mode-add")).toBeDisabled();
  expect(screen.getByTestId("game-edit-modes-full")).toHaveTextContent("Höchstens 20 Modi");
  expect(screen.getByTestId("game-edit-mode-minutes-1")).toHaveValue(600);
});

test("unbekanntes Gerät bleibt sichtbar und lesbar, Best of 9 bleibt wählbar", () => {
  render(<Harness game={WORST} />);
  expect(screen.getByTestId("game-edit-device-vr_brille")).toBeChecked();
  expect(screen.getByTestId("game-edit-device-vr_brille").closest("label")).toHaveTextContent("Vr Brille");
  expect(screen.getByTestId("game-edit-best-of")).toHaveValue("9");
});

test("64 Plätze: die Vorschau bleibt kurz", () => {
  render(<Harness game={WORST} />);
  const preview = screen.getByTestId("game-edit-points-preview");
  expect(preview).toHaveTextContent("64 Plätze: 1. 1000 · 2. 984");
  expect(preview).toHaveTextContent("… 64. 0");
  expect(preview.textContent.length).toBeLessThan(120);
});

test("ein Platz und leere Werte: Einzahl, keine „undefined“", () => {
  render(<Harness game={{ points_table: [1] }} />);
  expect(screen.getByTestId("game-edit-points-preview")).toHaveTextContent("1 Platz: 1. 1");
  expect(screen.getByTestId("game-edit-match-data")).not.toHaveTextContent("undefined");
  expect(screen.getByTestId("game-edit-match-data")).not.toHaveTextContent("NaN");
});

test("ein Modus ohne Namen: der Löschen-Knopf bleibt erreichbar", () => {
  render(<Harness game={{ match_modes: [{ mode: "x", label: "", minutes: 5 }] }} />);
  fireEvent.click(screen.getByTestId("game-edit-mode-remove-0"));
  expect(screen.getByTestId("game-edit-modes-empty")).toBeInTheDocument();
});
