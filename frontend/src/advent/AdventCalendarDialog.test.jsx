import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";

// Das Fenster des Adventkalenders (#963): geht vom Speicher aus auf, über die alte Adresse /advent (Verlauf-Zustand) und
// schließt mit dem Knopf; drinnen steht der Kalender.

vi.mock("./AdventCalendarPanel", async () => {
  const { Link } = await vi.importActual("react-router-dom");
  return {
    AdventCalendarPanel: ({ titleId }) => (
      <div data-testid="advent-page">
        <h1 id={titleId}>Adventkalender 2026</h1>
        <Link to="/login">Anmelden</Link>
        <Link to="/news/advent">Zu den News</Link>
        <Link to="/">Zur Startseite</Link>
      </div>
    ),
  };
});

const { AdventCalendarDialog } = await import("./AdventCalendarDialog");
const { OPEN_STATE_KEY, closeAdventCalendar, isAdventCalendarOpen, openAdventCalendar } = await import("./calendarDialog");

function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <span data-testid="state">{location.state?.[OPEN_STATE_KEY] ? "gewünscht" : "leer"}</span>
      <span data-testid="path">{location.pathname}</span>
      <button type="button" onClick={() => navigate(-1)}>Zurück</button>
      <button type="button" onClick={() => navigate(1)}>Weiter</button>
    </>
  );
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

// #991: ein Link im Fenster wechselt die Seite - dann geht das Fenster zu, die Zielseite ist frei und bedienbar.
test("Anmelden führt auf /login und schließt das Fenster", async () => {
  show();
  act(() => openAdventCalendar());
  await screen.findByTestId("advent-window");
  fireEvent.click(screen.getByRole("link", { name: "Anmelden" }));
  expect(screen.getByTestId("path")).toHaveTextContent("/login");
  await waitFor(() => expect(isAdventCalendarOpen()).toBe(false));
  await waitFor(() => expect(screen.queryByTestId("advent-window")).toBeNull());
  expect(document.body).not.toHaveAttribute("data-scroll-locked");
  expect(document.body.style.pointerEvents).not.toBe("none");
});

test("auch News-Links und ein Link auf die Seite, auf der man schon ist, schließen das Fenster", async () => {
  show();
  act(() => openAdventCalendar());
  await screen.findByTestId("advent-window");
  fireEvent.click(screen.getByRole("link", { name: "Zu den News" }));
  expect(screen.getByTestId("path")).toHaveTextContent("/news/advent");
  await waitFor(() => expect(isAdventCalendarOpen()).toBe(false));

  fireEvent.click(screen.getByRole("button", { name: "Zurück" }));
  expect(screen.getByTestId("path")).toHaveTextContent("/");
  act(() => openAdventCalendar());
  await screen.findByTestId("advent-window");
  fireEvent.click(screen.getByRole("link", { name: "Zur Startseite" }));
  await waitFor(() => expect(isAdventCalendarOpen()).toBe(false));
});

test("nach der Umleitung von /advent bleibt das Fenster offen; Zurück und Weiter öffnen es nicht noch einmal", async () => {
  show(["/news", { pathname: "/", state: { [OPEN_STATE_KEY]: true } }]);
  expect(await screen.findByTestId("advent-window")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("leer"));
  expect(isAdventCalendarOpen()).toBe(true);
  fireEvent.click(screen.getByRole("link", { name: "Anmelden" }));
  await waitFor(() => expect(isAdventCalendarOpen()).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Zurück" }));
  expect(screen.getByTestId("path")).toHaveTextContent("/");
  fireEvent.click(screen.getByRole("button", { name: "Zurück" }));
  expect(screen.getByTestId("path")).toHaveTextContent("/news");
  fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
  expect(screen.getByTestId("path")).toHaveTextContent("/");
  await act(async () => {});
  expect(isAdventCalendarOpen()).toBe(false);
  expect(screen.queryByTestId("advent-window")).toBeNull();
});
