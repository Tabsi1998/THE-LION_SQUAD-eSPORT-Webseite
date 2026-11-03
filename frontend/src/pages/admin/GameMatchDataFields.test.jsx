import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { GameModesEditor, GameTournamentPresets, modeSummary } from "./GameMatchDataFields";
import { emptyMode, gameMatchDataToForm } from "@/lib/gameMatchData";

// Schlimmster Fall für die Spiel-Daten (#1554, break-ui): lange Modusnamen bis zur Grenze (60), 20 Modi, eine
// Punktetabelle mit 64 Plätzen, ein Gerät, das die Liste nicht kennt, Best-of außerhalb der Auswahl, 600 Minuten.
// Seit #2249 im Reiter „Modi“ der Spielseite: je Modus eine Zeile mit Name, Zustand, Spieler je Seite, Ergebnisregel und
// Dauer, aufklappbar für alle Felder.

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

// `usage`: null = Zählung unbekannt (der Server prüft), undefined = lädt noch, sonst die Antwort von /games/{id}/usage.
function Harness({ game, onValue, ...rest }) {
  const usage = "usage" in rest ? rest.usage : null;
  const [value, setValue] = useState(gameMatchDataToForm(game));
  const change = (next) => {
    setValue(next);
    onValue?.(next);
  };
  return (
    <>
      <GameModesEditor modes={value.match_modes} onChange={(modes) => change({ ...value, match_modes: modes })} usage={usage} />
      <GameTournamentPresets value={value} onChange={change} />
    </>
  );
}

test("20 Modi: „Modus hinzufügen“ ist gesperrt und sagt warum; die Zeile zeigt Name und Dauer", () => {
  render(<Harness game={WORST} />);
  expect(WORST.match_modes[0].label).toHaveLength(60);
  expect(screen.getByTestId("game-edit-mode-name-0")).toHaveTextContent(WORST.match_modes[0].label);
  expect(screen.getByTestId("game-edit-mode-add")).toBeDisabled();
  expect(screen.getByTestId("game-edit-modes-full")).toHaveTextContent("Höchstens 20 Modi");
  expect(screen.getByTestId("game-edit-mode-more-1")).toHaveTextContent("600 Min. je Spiel");
  fireEvent.click(screen.getByTestId("game-edit-mode-more-1"));
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
  expect(screen.getByTestId("game-edit-modes-empty")).toHaveTextContent("Noch kein Modus");
});

test("ein Modus ohne Namen: als „Neuer Modus“ lesbar, der Löschen-Knopf bleibt erreichbar", () => {
  render(<Harness game={{ match_modes: [{ mode: "x", label: "", minutes: 5 }] }} />);
  expect(screen.getByTestId("game-edit-mode-name-0")).toHaveTextContent("Neuer Modus");
  fireEvent.click(screen.getByTestId("game-edit-mode-remove-0"));
  expect(screen.getByTestId("game-edit-modes-empty")).toBeInTheDocument();
});

test("ein neuer Modus kommt aufgeklappt, damit man gleich den Namen tippt", () => {
  let last = null;
  render(<Harness game={{}} onValue={(value) => { last = value; }} />);
  fireEvent.click(screen.getByTestId("game-edit-mode-add"));
  expect(screen.getByTestId("game-edit-mode-more-0")).toHaveAttribute("aria-expanded", "true");
  fireEvent.change(screen.getByTestId("game-edit-mode-label-0"), { target: { value: "Stellung" } });
  expect(screen.getByTestId("game-edit-mode-name-0")).toHaveTextContent("Stellung");
  expect(last.match_modes).toEqual([{ ...emptyMode(), label: "Stellung" }]);
});

// Spielmodi mit Zustand und Ergebnisregel (#2206, C.1).
const TWO = { match_modes: [{ mode: "zonen", label: "Zonen" }, { mode: "jagd", label: "Jagd", status: "inactive" }] };
const USAGE = { modes: { zonen: { in_use: true }, jagd: { in_use: false } } };

test("verwendete Modi: kein Entfernen, nur der Hinweis zum Deaktivieren", () => {
  render(<Harness game={TWO} usage={USAGE} />);
  expect(screen.queryByTestId("game-edit-mode-remove-0")).toBeNull();
  expect(screen.getByTestId("game-edit-mode-locked-0")).toBeInTheDocument();
  expect(screen.getByTestId("game-edit-mode-used-0")).toHaveTextContent("nur deaktivieren oder archivieren");
  expect(screen.getByTestId("game-edit-mode-remove-1")).toBeEnabled();
  expect(screen.queryByTestId("game-edit-mode-used-1")).toBeNull();
});

test("solange die Zählung lädt, wartet der Knopf; neue Zeilen lassen sich immer entfernen", () => {
  render(<Harness game={TWO} usage={undefined} />);
  expect(screen.getByTestId("game-edit-mode-remove-0")).toBeDisabled();
  fireEvent.click(screen.getByTestId("game-edit-mode-add"));
  expect(screen.getByTestId("game-edit-mode-remove-2")).toBeEnabled();
});

test("Zustand steht in der Zeile; aufgeklappt als Auswahl mit Erklärung", () => {
  let last = null;
  render(<Harness game={TWO} usage={USAGE} onValue={(value) => { last = value; }} />);
  expect(screen.getByTestId("game-edit-mode-chip-0")).toHaveTextContent("Aktiv");
  expect(screen.getByTestId("game-edit-mode-chip-1")).toHaveTextContent("Inaktiv");
  fireEvent.click(screen.getByTestId("game-edit-mode-more-1"));
  expect(screen.getByTestId("game-edit-mode-status-1")).toHaveValue("inactive");
  expect(screen.getByTestId("game-edit-mode-status-hint-1")).toHaveTextContent("nicht mehr zur Wahl");
  fireEvent.click(screen.getByTestId("game-edit-mode-more-0"));
  fireEvent.change(screen.getByTestId("game-edit-mode-status-0"), { target: { value: "archived" } });
  expect(last.match_modes[0].status).toBe("archived");
  expect(screen.getByTestId("game-edit-mode-status-hint-0")).toHaveTextContent("Archiviert");
  expect(screen.getByTestId("game-edit-mode-chip-0")).toHaveTextContent("Archiviert");
});

test("Details: Beschreibung, Spieler je Seite, Format und Ergebnisregel, die Zeile fasst sie zusammen", () => {
  let last = null;
  render(<Harness game={TWO} usage={USAGE} onValue={(value) => { last = value; }} />);
  const more = screen.getByTestId("game-edit-mode-more-0");
  expect(more).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByTestId("game-edit-mode-details-0")).toBeNull();
  fireEvent.click(more);
  expect(more).toHaveAttribute("aria-expanded", "true");
  fireEvent.change(screen.getByTestId("game-edit-mode-players-0"), { target: { value: "4" } });
  fireEvent.change(screen.getByTestId("game-edit-mode-rule-kind-0"), { target: { value: "rounds" } });
  expect(screen.getByTestId("game-edit-mode-rule-limit-0")).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("game-edit-mode-rule-target-0"), { target: { value: "6" } });
  fireEvent.click(screen.getByTestId("game-edit-mode-rule-overtime-0"));
  expect(last.match_modes[0]).toMatchObject({ players_per_side: "4", rule_kind: "rounds", rule_target: "6", rule_overtime: true });
  expect(screen.getByTestId("game-edit-mode-summary-0")).toHaveTextContent("4 je Seite · Runden gewinnen: 6 Siege · Verlängerung");
  expect(more).toHaveTextContent("4 je Seite");
  expect(more).toHaveTextContent("Runden gewinnen: 6 Siege · Verlängerung");
  fireEvent.change(screen.getByTestId("game-edit-mode-rule-kind-0"), { target: { value: "highest" } });
  expect(screen.queryByTestId("game-edit-mode-rule-target-0")).toBeNull();
  expect(screen.queryByTestId("game-edit-mode-rule-limit-0")).toBeNull();
});

test("Zusammenfassung ohne Angaben sagt, was sich aufklappen lässt", () => {
  expect(modeSummary({ label: "Zonen" })).toContain("aufklappen");
  expect(modeSummary({ label: "GP", minutes: "12", per_game: true, format: "  150cc " })).toBe("150cc · 12 Min. je Spiel");
});

test("schlimmster Fall: lange Beschreibung wird an der Grenze abgeschnitten, nichts „undefined“", () => {
  let last = null;
  render(<Harness game={TWO} usage={USAGE} onValue={(value) => { last = value; }} />);
  fireEvent.click(screen.getByTestId("game-edit-mode-more-1"));
  fireEvent.change(screen.getByTestId("game-edit-mode-description-1"), { target: { value: "x".repeat(700) } });
  expect(last.match_modes[1].description).toHaveLength(500);
  expect(screen.getByTestId("game-edit-modes")).toHaveTextContent("500 / 500 Zeichen");
  expect(screen.getByTestId("game-edit-modes")).not.toHaveTextContent("undefined");
});
