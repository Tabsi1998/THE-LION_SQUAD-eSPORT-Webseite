import { render, screen } from "@testing-library/react";
import { TvTreeContext, TvTreeNode } from "./TvTreeNode";
import { decide, find, heatDoubleElimination } from "../../../e2e/fixtures/tvBrackets.mjs";
import { finderFor } from "@/lib/slotSource";
import { buildPodiumMap } from "@/lib/bracketPodium";

// Ein Sammellauf nach dem Zusammenlegen (#2044): ruhende Plätze („Quelle unerfüllbar“, die Quelle lebt noch) sind
// Merkposten am Lauf (`dormant_slots`), keine Plätze. Der TV zählt und zeigt nur die echten Plätze - vier Fahrer sind
// „4 Spieler“ und vier Zeilen, auch wenn der Lauf vier Merkposten trägt.

function renderNode(bracket, key) {
  const match = find(bracket, key);
  const regMap = new Map(bracket.registrations.map((reg) => [reg.id, reg]));
  const value = {
    matches: bracket.matches_v2, hiddenSlots: new Set(), landing: new Set(), goldCards: new Set(), goldRows: new Set(),
    finished: false, lastStageId: null, isTable: () => false,
  };
  return render(
    <TvTreeContext.Provider value={value}>
      <TvTreeNode match={match} regMap={regMap} podiumMap={buildPodiumMap(bracket.matches_v2, bracket.stages)} findMatch={finderFor(bracket.matches_v2)(match)} />
    </TvTreeContext.Provider>,
  );
}

test("ein Sammellauf mit ruhenden Plätzen zeigt nur seine echten Plätze: „4 Spieler“, vier Zeilen", () => {
  const bracket = heatDoubleElimination();
  decide(bracket, "A");
  decide(bracket, "B");
  const merged = find(bracket, "D");
  // Wie der Lauf-Umbau nach dem Zusammenlegen: vier besetzte Plätze, Laufgröße 4, dazu vier Merkposten ruhender Plätze.
  merged.rebuilt_at = "2026-10-31T19:00:00+00:00";
  merged.settings = { ...merged.settings, match_size: 4 };
  merged.dormant_slots = [
    { flow: "W", match_key: "LA", rank: 2, raw: "W:LA:2" },
    { flow: "W", match_key: "LB", rank: 2, raw: "W:LB:2" },
    { flow: "L", match_key: "F", rank: 1, raw: "L:F:1" },
    { flow: "L", match_key: "F", rank: 2, raw: "L:F:2" },
  ];
  renderNode(bracket, "D");
  const card = screen.getByTestId("tv-match-m-D");
  expect(card).toHaveTextContent("4 Spieler · 2 kommen weiter");
  expect(card).not.toHaveTextContent("8 Spieler");
  expect(card.querySelectorAll("[data-tv-slot]")).toHaveLength(4);
  expect([...card.querySelectorAll("[data-tv-slot]")].every((row) => row.getAttribute("data-tv-reg"))).toBe(true);
});
