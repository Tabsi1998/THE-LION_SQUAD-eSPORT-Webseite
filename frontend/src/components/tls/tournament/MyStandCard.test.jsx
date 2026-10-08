import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// „Dein Stand“ (#1194): nach dem Turnier „Ergebnis teilen“ - vorher und ohne bestätigte Teilnahme nicht.

vi.mock("@/components/tls/ResultShareButton", () => ({ ResultShareButton: ({ tournamentId }) => <div data-testid="share-stub">{tournamentId}</div> }));
vi.mock("@/components/tls/tournament/TeamDayPanel", () => ({ TeamDayPanel: () => null }));

const { MyStandCard } = await import("./MyStandCard");

function renderCard(tournament, registration) {
  return render(<MemoryRouter><MyStandCard tournament={{ id: "t1", ...tournament }} registration={{ id: "r1", ...registration }} /></MemoryRouter>);
}

test("nach dem Turnier steht „Ergebnis teilen“ für bestätigte Teilnehmer", () => {
  renderCard({ status: "results_published" }, { status: "checked_in" });
  expect(screen.getByTestId("share-stub")).toHaveTextContent("t1");
});

test("vor dem Ende oder ohne bestätigte Teilnahme gibt es nichts zu teilen", () => {
  const { unmount } = renderCard({ status: "live" }, { status: "approved" });
  expect(screen.queryByTestId("share-stub")).toBeNull();
  unmount();
  renderCard({ status: "completed" }, { status: "waitlist" });
  expect(screen.queryByTestId("share-stub")).toBeNull();
});
