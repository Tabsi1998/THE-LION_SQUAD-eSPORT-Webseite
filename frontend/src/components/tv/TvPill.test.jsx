import { render, screen } from "@testing-library/react";
import { STATUS_KIND_ORDER } from "@/lib/statusKinds";
import { TvPill, TvStatusPill } from "./TvParts";

// TV-Pille (#1306): dieselben Arten wie die Zustands-Schilder der Website, in Beamer-Größe - mit Symbol, normal geschrieben.

test.each(STATUS_KIND_ORDER)("Art %s: Zustands-Pille mit Art und Symbol", (kind) => {
  render(<TvPill kind={kind} testId="pill">Wort</TvPill>);
  const pill = screen.getByTestId("pill");
  expect(pill).toHaveClass("tv-pill", "tv-pill--status");
  expect(pill).toHaveAttribute("data-kind", kind);
  expect(pill).toHaveTextContent(/^Wort$/);
  if (kind === "live") expect(pill.querySelector(".tv-live-dot")).not.toBeNull();
  else expect(pill.querySelector("svg.tv-pill__icon")).not.toBeNull();
});

test("TvStatusPill: Wort aus der Tabelle, Unbekanntes mit dem Wort der Stelle", () => {
  const { rerender } = render(<TvStatusPill status="check_in" testId="pill" />);
  expect(screen.getByTestId("pill")).toHaveTextContent(/^Check-in offen$/);
  expect(screen.getByTestId("pill")).toHaveAttribute("data-kind", "checkin");
  rerender(<TvStatusPill status="neu" label="Etwas Neues" testId="pill" />);
  expect(screen.getByTestId("pill")).toHaveTextContent(/^Etwas Neues$/);
});

test("ohne Art bleibt die Pille ein Hinweis-Schild", () => {
  render(<TvPill tone="gold" testId="pill">3 Aufrufe</TvPill>);
  expect(screen.getByTestId("pill")).toHaveClass("tv-pill--gold");
  expect(screen.getByTestId("pill")).not.toHaveAttribute("data-kind");
});
