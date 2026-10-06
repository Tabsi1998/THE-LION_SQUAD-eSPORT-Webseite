import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// Das Fenster des Adventkalenders (#963): geht vom Speicher aus auf, über die alte Adresse /advent (Verlauf-Zustand) und
// schließt mit dem Knopf; drinnen steht der Kalender.

vi.mock("./AdventCalendarPanel", () => ({ AdventCalendarPanel: ({ titleId }) => <div data-testid="advent-page"><h1 id={titleId}>Adventkalender 2026</h1></div> }));

const { AdventCalendarDialog } = await import("./AdventCalendarDialog");
const { OPEN_STATE_KEY, closeAdventCalendar, isAdventCalendarOpen, openAdventCalendar } = await import("./calendarDialog");

function Probe() {
  const location = useLocation();
  return <span data-testid="state">{location.state?.[OPEN_STATE_KEY] ? "gewünscht" : "leer"}</span>;
}

function show(entries = ["/"]) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <Routes>
        <Route path="*" element={<><Probe /><AdventCalendarDialog /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => closeAdventCalendar());

test("zu, auf, zu - mit Knopf und Escape", async () => {
  show();
  expect(screen.queryByTestId("advent-window")).toBeNull();
  act(() => openAdventCalendar());
  expect(await screen.findByTestId("advent-window")).toBeInTheDocument();
  expect(screen.getByTestId("advent-page")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Adventkalender 2026");
  fireEvent.click(screen.getByTestId("advent-window-close"));
  await waitFor(() => expect(isAdventCalendarOpen()).toBe(false));
  act(() => openAdventCalendar());
  await screen.findByTestId("advent-window");
  fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
  await waitFor(() => expect(isAdventCalendarOpen()).toBe(false));
});

test("die Umleitung von /advent öffnet das Fenster einmal und räumt den Wunsch aus dem Verlauf", async () => {
  show([{ pathname: "/", state: { [OPEN_STATE_KEY]: true } }]);
  expect(await screen.findByTestId("advent-window")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("leer"));
});
