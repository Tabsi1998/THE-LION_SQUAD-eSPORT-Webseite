import { render, screen } from "@testing-library/react";
import { ModerationStateBadge } from "./ModerationStateBadge";

// Wortfilter (#417): nur „wird geprüft“ und „zurückgewiesen“ bekommen ein Abzeichen - alles andere nicht.

test("zeigt den Zustand nur für zurückgehaltene und zurückgewiesene Nachrichten", () => {
  const { rerender } = render(<ModerationStateBadge moderation={{ state: "held" }} />);
  expect(screen.getByTestId("moderation-state")).toHaveTextContent("Wird geprüft – nur du siehst diese Nachricht");
  rerender(<ModerationStateBadge moderation={{ state: "rejected" }} />);
  expect(screen.getByTestId("moderation-state")).toHaveAttribute("data-state", "rejected");
  rerender(<ModerationStateBadge moderation={{ state: "flagged" }} />);
  expect(screen.queryByTestId("moderation-state")).toBeNull();
  rerender(<ModerationStateBadge moderation={null} />);
  expect(screen.queryByTestId("moderation-state")).toBeNull();
});
