import { fireEvent, render, screen } from "@testing-library/react";
import { BallotChoice, BallotResult, normalizeBallot, normalizeBallotList, sharePercent } from "./BallotParts";

// Ein Baustein für Abstimmungen (#2612): Versammlungen und Abstimmungen am Event teilen Form, Auswahl und Ergebnis.

const OPTIONS = [{ code: "a", label: "Garage" }, { code: "b", label: "Garten" }];
const RIGHT = { right_id: "user:u1", for: "self", state: "open", can_use: true };

test("sichere Form: ohne Kennung nichts, kaputte Listen werden leer", () => {
  expect(normalizeBallot(null)).toBeNull();
  expect(normalizeBallot({ question: "x" })).toBeNull();
  const ballot = normalizeBallot({ id: "p1", question: 7, options: [null, { code: "a", label: "Garage" }, { label: "ohne Code" }], rights: "alle" });
  expect(ballot.question).toBe("");
  expect(ballot.options).toEqual([{ code: "a", label: "Garage" }]);
  expect(ballot.rights).toEqual([]);
  expect(normalizeBallotList("kaputt")).toEqual([]);
  expect(normalizeBallotList([{ id: 1 }, null, "x"]).map((item) => item.id)).toEqual([1]);
});

test("Auswahl: eine Antwort oder mehrere, gewählte mit aria-pressed", () => {
  const onChoose = vi.fn();
  const { rerender } = render(<BallotChoice ballot={{ question: "Wo?", options: OPTIONS }} right={RIGHT} chosen="b" onChoose={onChoose} />);
  expect(screen.getByTestId("ballot-option-user:u1-b")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("ballot-option-user:u1-a")).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByTestId("ballot-option-user:u1-a"));
  expect(onChoose).toHaveBeenCalledWith("a");
  rerender(<BallotChoice ballot={{ question: "Wo?", options: OPTIONS }} right={RIGHT} chosen={["a", "b"]} onChoose={onChoose} multiple label="Deine Stimme" />);
  expect(screen.getByRole("group", { name: "Deine Stimme" })).toBeInTheDocument();
  expect(screen.getByTestId("ballot-option-user:u1-a")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("ballot-option-user:u1-b")).toHaveAttribute("aria-pressed", "true");
});

test("Ergebnis als Zeile (Versammlungen) und als Balken (Event)", () => {
  const result = { outcome_label: "Mehrheit", winner: "a", winner_label: "Garage", valid: 3,
    counts: [{ code: "a", label: "Garage", count: 2 }, { code: "b", label: "Garten", count: 1 }] };
  const { rerender } = render(<BallotResult result={result} testId="r" />);
  expect(screen.getByTestId("r")).toHaveTextContent("Ergebnis: Mehrheit – Garage");
  expect(screen.getByTestId("r")).toHaveTextContent("Garage 2 · Garten 1 · gültig 3");
  rerender(<BallotResult result={result} testId="r" bars title="Stand" />);
  expect(screen.getByTestId("r")).toHaveTextContent("Stand");
  expect(screen.getByTestId("r-valid")).toHaveTextContent("3 Stimmen");
  expect(screen.getByTestId("r-a")).toHaveAttribute("data-winner", "1");
  expect(screen.getByTestId("r-a")).toHaveTextContent("2 · 67 %");
  expect(screen.getByTestId("r-b")).not.toHaveAttribute("data-winner");
  rerender(<BallotResult result={null} testId="r" />);
  expect(screen.queryByTestId("r")).toBeNull();
});

test("Anteil: gerundet, ohne Stimmen 0", () => {
  expect(sharePercent(1, 3)).toBe(33);
  expect(sharePercent(0, 0)).toBe(0);
  expect(sharePercent("2", "4")).toBe(50);
});
