import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Event als Klammer (#1371): im Turnier- und Fast-Lap-Formular steht nur noch, wozu der Eintrag gehört - geändert wird
// im Event. Lädt das Programm nicht, steht ein Satz statt eines leeren Kastens.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (err, fallback) => err?.response?.data?.detail || fallback }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("sonner", () => ({ toast: toastMock }));

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

// Nach Codex-Prüfung: Absagen des Servers stehen als Satz da; ein Turnier mit Anmeldungen bleibt in der Liste,
// „schon verbunden“ lädt das Programm neu.
test("Absagen des Servers: Satz im Hinweis, Liste bleibt, bei 409 wird neu geladen", async () => {
  const program = {
    tournaments: [{ id: "t1", title: "Kart-Cup" }], fastlaps: [],
    candidates: { tournaments: [{ id: "t2", title: "Rocket-Cup" }], fastlaps: [] }, event: {},
  };
  const reload = vi.fn(async () => {});
  apiMock.delete.mockRejectedValue({ response: { status: 409, data: { detail: "Das Turnier hat schon Anmeldungen – lösen geht erst, wenn niemand mehr angemeldet ist." } } });
  apiMock.post.mockRejectedValue({ response: { status: 409, data: { detail: "Inzwischen gehört es schon zu einem Event – lade das Programm neu." } } });
  render(<MemoryRouter><EventProgramPanel eventId="ev-1" program={program} reload={reload} /></MemoryRouter>);

  fireEvent.click(screen.getByTestId("event-program-remove-t1"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("schon Anmeldungen")));
  expect(screen.getByTestId("event-program-item-t1")).toBeInTheDocument();
  expect(reload).not.toHaveBeenCalled();

  fireEvent.change(screen.getByTestId("event-program-choice"), { target: { value: "tournament:t2" } });
  fireEvent.click(screen.getByTestId("event-program-add-submit"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("Inzwischen gehört es schon")));
  expect(reload).toHaveBeenCalledTimes(1);
});
