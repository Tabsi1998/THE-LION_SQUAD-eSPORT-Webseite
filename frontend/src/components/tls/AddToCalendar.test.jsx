import { render, screen } from "@testing-library/react";
import { AddToCalendar } from "./AddToCalendar";

// „Zum Kalender hinzufügen“ (#580): Google, Outlook und die ICS vom Server; ohne Kennung die ICS aus dem Browser.

const item = { id: "e1", kind: "event", slug: "sommerfest", title: "Sommerfest", start: "2026-12-12T18:00:00+01:00", location: "Vereinsheim", detail: "Vereinsevent", url: "https://lionsquad.at/events/sommerfest" };

test("drei Wege: Google, Outlook und die ICS-Datei vom Server", () => {
  render(<AddToCalendar item={item} />);
  expect(screen.getByTestId("add-to-calendar")).toHaveTextContent("Zum Kalender hinzufügen");
  expect(screen.getByTestId("add-to-calendar-google")).toHaveAttribute("href", expect.stringContaining("calendar.google.com"));
  expect(screen.getByTestId("add-to-calendar-outlook")).toHaveAttribute("href", expect.stringContaining("outlook.live.com"));
  const ics = screen.getByTestId("add-to-calendar-ics");
  expect(ics.tagName).toBe("A");
  expect(ics).toHaveAttribute("href", "/api/calendar/events/sommerfest.ics");
  expect(ics).toHaveAttribute("download");
});

test("ohne Kennung wird die ICS im Browser gebaut; ohne Beginn gibt es keinen Knopf", () => {
  render(<AddToCalendar item={{ ...item, id: null, slug: null }} />);
  expect(screen.getByTestId("add-to-calendar-ics").tagName).toBe("BUTTON");
  const { container } = render(<AddToCalendar item={{ ...item, start: null }} />);
  expect(container.querySelector("[data-testid='add-to-calendar']")).toBeNull();
});
