import { render, screen } from "@testing-library/react";
import { INTERNAL_HINT, InternalTag } from "./InternalTag";

// „Vereinsintern“ (#2516): sichtbar nur das Wort, die Erklärung steht zusätzlich als Text für Screenreader - `title` liest nicht
// jeder vor.
test("Etikett: das Wort sichtbar, die Erklärung als Screenreader-Text und als title", () => {
  render(<InternalTag testId="tag" />);
  const tag = screen.getByTestId("tag");
  expect(screen.getByText("Vereinsintern")).toBeInTheDocument();
  const hint = screen.getByText(`– ${INTERNAL_HINT}`);
  expect(hint).toHaveClass("sr-only");
  expect(tag).toHaveAttribute("title", INTERNAL_HINT);
  expect(tag).toHaveTextContent(`Vereinsintern – ${INTERNAL_HINT}`);
});
