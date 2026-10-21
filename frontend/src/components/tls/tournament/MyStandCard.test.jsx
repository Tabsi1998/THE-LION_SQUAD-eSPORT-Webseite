import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// „Dein Stand“ (#1194): nach dem Turnier „Ergebnis teilen“ - vorher und ohne bestätigte Teilnahme nicht.

vi.mock("@/components/tls/ResultShareButton", () => ({ ResultShareButton: ({ tournamentId }) => <div data-testid="share-stub">{tournamentId}</div> }));
vi.mock("@/components/tls/tournament/TeamDayPanel", () => ({ TeamDayPanel: () => null }));
vi.mock("@/components/tls/live/LiveQueueStatus", () => ({ LiveQueueStatus: ({ tournamentId }) => <div data-testid="queue-stub">{tournamentId}</div> }));

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

test("nach dem Check-in-Ende (#1551) gibt es keinen Knopf „Jetzt einchecken“ mehr", () => {
  const { unmount } = render(<MemoryRouter><MyStandCard tournament={{ id: "t1", status: "check_in" }} registration={{ id: "r1", status: "approved" }} canCheckIn /></MemoryRouter>);
  expect(screen.getByTestId("tournament-checkin-btn")).toBeInTheDocument();
  unmount();
  render(<MemoryRouter><MyStandCard tournament={{ id: "t1", status: "check_in", check_in_closed_at: "2026-10-31T16:50:00+00:00" }} registration={{ id: "r1", status: "approved" }} canCheckIn /></MemoryRouter>);
  expect(screen.queryByTestId("tournament-checkin-btn")).toBeNull();
});

test("vor Ort im laufenden Turnier (#1556): „Du bist als Nächstes an Station 2“ - online und vorher nicht", () => {
  const { unmount } = renderCard({ status: "live", event_mode: "local" }, { status: "checked_in" });
  expect(screen.getByTestId("queue-stub")).toHaveTextContent("t1");
  unmount();
  const online = renderCard({ status: "live", event_mode: "online" }, { status: "checked_in" });
  expect(screen.queryByTestId("queue-stub")).toBeNull();
  online.unmount();
  renderCard({ status: "check_in", event_mode: "local" }, { status: "approved" });
  expect(screen.queryByTestId("queue-stub")).toBeNull();
});

test("#1938: der Check-in nennt die wirksamen Zeiten - nie „ab 10:56 bis 10:48“", () => {
  const { unmount } = renderCard({
    status: "live", check_in_from: "2099-10-21T08:56:00+00:00", check_in_until: "2026-10-21T08:48:00+00:00", check_in_closed_at: "2026-10-21T08:49:00+00:00",
  }, { status: "checked_in" });
  expect(screen.getByTestId("tournament-my-checkin")).toHaveTextContent(/^bis 21\.10\.2026, 10:48$/);
  unmount();
  renderCard({ status: "check_in", check_in_from: "2026-10-21T08:30:00+00:00", check_in_until: "2099-10-21T08:55:00+00:00" }, { status: "approved" });
  expect(screen.getByTestId("tournament-my-checkin")).toHaveTextContent("ab 21.10.2026, 10:30 bis 21.10.2099, 10:55");
});

test("#1888: nach dem Ende keine Warteschlange mehr, auch wenn der Rohstatus noch „live“ ist", () => {
  const { unmount } = renderCard({ status: "live", event_mode: "local", public_phase: { state: "completed" } }, { status: "checked_in" });
  expect(screen.queryByTestId("queue-stub")).toBeNull();
  unmount();
  renderCard({ status: "live", event_mode: "local", public_phase: { state: "live" } }, { status: "checked_in" });
  expect(screen.getByTestId("queue-stub")).toHaveTextContent("t1");
});
