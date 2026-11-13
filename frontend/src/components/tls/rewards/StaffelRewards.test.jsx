import { render, screen } from "@testing-library/react";
import { StaffelRewards } from "./StaffelRewards";

// Ligaseite (F.4, #2214): vor dem Abschluss „Darum wird gespielt“, danach Podest mit Belohnung je Platz. Erfundene Namen.

const item = (id, name, places, holders = []) => ({ id, kind: "medal", kind_label: "Medaille", name, places, place_label: places.mode === "rank" ? `${places.rank}. Platz`
  : places.mode === "range" ? `Platz ${places.from}–${places.to}` : "Alle Teilnehmer", recipients_label: "Team", holders });
const ROWS = [1, 2, 3, 4].map((rank) => ({ registration_id: `r${rank}`, display_name: `Probe ${rank}`, rank, points: 12 - 3 * rank }));
const ITEMS = [item("g", "Goldmedaille", { mode: "rank", rank: 1 }, [{ registration_id: "r1", display_name: "Probe 1", rank: 1 }]),
  item("p", "Podest-Emblem", { mode: "range", from: 2, to: 3 }, [{ registration_id: "r2", display_name: "Probe 2" }, { registration_id: "r3", display_name: "Probe 3" }]),
  item("a", "Season-Banner", { mode: "all" }, ROWS.map((row) => ({ registration_id: row.registration_id, display_name: row.display_name })))];

test("vor dem Abschluss: worum gespielt wird", () => {
  render(<StaffelRewards staffel={{ staffel: "A" }} data={{ standings: ROWS, teams: [], staffel: { rewards: { granted: false, items: ITEMS.map((row) => ({ ...row, holders: [] })) } } }} />);
  const block = screen.getByTestId("league-rewards-A");
  expect(block).toHaveAttribute("data-granted", "false");
  expect(block).toHaveTextContent("Darum wird gespielt");
  expect(screen.getByTestId("league-rewards-A-planned-p")).toHaveTextContent("Platz 2–3 · Medaille · Team");
  expect(screen.queryByTestId("podium")).toBeNull();
});

test("nach dem Abschluss: Podest, je Platz die Belohnung, Bereiche mit Inhabern und „alle“", () => {
  render(<StaffelRewards staffel={{ staffel: "A" }} data={{ standings: ROWS, teams: [], staffel: { rewards: { granted: true, items: ITEMS } } }} />);
  expect(screen.getByTestId("podium")).toBeInTheDocument();
  expect(screen.getByTestId("league-rewards-A-place-1")).toHaveTextContent("Goldmedaille");
  expect(screen.getByTestId("league-rewards-A-place-2")).not.toHaveTextContent("Goldmedaille");
  expect(screen.getByTestId("league-rewards-A-other-p")).toHaveTextContent("Probe 2, Probe 3");
  expect(screen.getByTestId("league-rewards-A-everyone")).toHaveTextContent("Alle Teilnehmer bekommen: Season-Banner.");
});

test("ohne Belohnungen bleibt der Baustein weg", () => {
  const { container } = render(<StaffelRewards staffel={{ staffel: "A" }} data={{ standings: ROWS, staffel: { rewards: null } }} />);
  expect(container).toBeEmptyDOMElement();
});
