import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import AdventCalendarPage from "./AdventCalendarPage";
import { OPEN_STATE_KEY } from "@/advent/calendarDialog";

// /advent (#963): keine Seite mehr - die Adresse führt auf die Startseite und lässt dort das Kalender-Fenster aufgehen.

function Home() {
  const location = useLocation();
  return <div data-testid="home">{location.state?.[OPEN_STATE_KEY] ? "Fenster auf" : "nichts"}</div>;
}

test("/advent leitet auf die Startseite um und wünscht sich das offene Fenster", () => {
  render(
    <MemoryRouter initialEntries={["/advent"]}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/advent" element={<AdventCalendarPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByTestId("home")).toHaveTextContent("Fenster auf");
});
