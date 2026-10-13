import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Event als Klammer (#1371): im Turnier- und Fast-Lap-Formular steht nur noch, wozu der Eintrag gehört - geändert wird
// im Event. Lädt das Programm nicht, steht ein Satz statt eines leeren Kastens.

vi.mock("@/lib/api", () => ({ api: { get: vi.fn() }, formatRequestError: (_err, fallback) => fallback }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { EventMembershipLine, EventProgramPanel } = await import("./EventProgramPanel");

test("Zeile im Formular: Event mit Weg dorthin, ohne Event der Hinweis auf das Programm", () => {
  const { rerender } = render(
    <MemoryRouter><EventMembershipLine eventId="ev-1" events={[{ id: "ev-1", name: "Herbst-LAN" }]} testId="line" /></MemoryRouter>,
  );
  expect(screen.getByTestId("line")).toHaveTextContent("Gehört zu Herbst-LAN – ändern im Event");
  expect(screen.getByRole("link", { name: "ändern im Event" })).toHaveAttribute("href", "/admin/events/ev-1");
  expect(screen.queryByRole("combobox")).toBeNull();

  rerender(<MemoryRouter><EventMembershipLine eventId="" events={[]} testId="line" /></MemoryRouter>);
  expect(screen.getByTestId("line")).toHaveTextContent("Gehört zu keinem Event");
});

test("Programm lädt nicht: ein Satz; leeres Programm: Hinweis und die Knöpfe zum Anlegen", () => {
  const { rerender } = render(<MemoryRouter><EventProgramPanel eventId="ev-1" program={null} failed reload={() => {}} /></MemoryRouter>);
  expect(screen.getByTestId("event-program-error")).toHaveTextContent("lässt sich gerade nicht laden");

  rerender(
    <MemoryRouter>
      <EventProgramPanel eventId="ev-1" program={{ tournaments: [], fastlaps: [], candidates: {}, event: { window: "am 14.11.2026" } }} reload={() => {}} />
    </MemoryRouter>,
  );
  expect(screen.getByTestId("event-program-empty")).toBeInTheDocument();
  expect(screen.getByTestId("event-program-new-tournament")).toHaveTextContent("Turnier in diesem Event");
  expect(screen.queryByTestId("event-program-add")).toBeNull();
});
