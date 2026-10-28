import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RafflePanel } from "./RafflePanel";

// Ziehen nur, wer darf (#2122 NW11): ohne das Recht der Vereinsleitung ein Satz statt eines Knopfs, der am Server scheitert.

const RAFFLE = { id: "r12", label: "TLS-Hoodie", value: "", winners: 1, audience: "all", staff_may_enter: false, closes_at: "2026-12-13T20:00:00+01:00",
  status: "closed", entries: 5, can_draw: true, may_draw: true, needs_close_early: false, terms: [], protocol: [] };

test("mit Recht: Knopf „Ziehen“", () => {
  render(<MemoryRouter><RafflePanel day={12} raffle={RAFFLE} isOpen onDraw={() => {}} onRedraw={() => {}} /></MemoryRouter>);
  expect(screen.getByTestId("advent-raffle-draw-12")).toBeInTheDocument();
  expect(screen.queryByTestId("advent-raffle-no-draw-12")).toBeNull();
});

test("ohne Recht: Satz statt Knopf", () => {
  render(<MemoryRouter><RafflePanel day={12} raffle={{ ...RAFFLE, can_draw: false, may_draw: false }} isOpen onDraw={() => {}} onRedraw={() => {}} /></MemoryRouter>);
  expect(screen.queryByTestId("advent-raffle-draw-12")).toBeNull();
  expect(screen.getByTestId("advent-raffle-no-draw-12")).toHaveTextContent("Gezogen wird von der Vereinsleitung.");
});
