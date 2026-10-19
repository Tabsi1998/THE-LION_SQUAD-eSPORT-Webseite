import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProfileNav } from "./ProfileNav";

// Mein Kalender-Abo (#1788): ein fester Eintrag unter „Konto“ in den Einstellungen, mit dem Abo-Kasten und dem Weg zu
// „Mein Kalender“.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));

const { CalendarTab } = await import("./CalendarTab");

test("der Eintrag steht unter Konto", () => {
  render(<MemoryRouter><ProfileNav tab="calendar" onSelect={() => {}} /></MemoryRouter>);
  const entry = within(screen.getByTestId("settings-group-account")).getByTestId("profile-tab-calendar");
  expect(entry).toHaveTextContent("Mein Kalender-Abo");
  expect(entry).toHaveAttribute("aria-current", "page");
});

test("Abo-Stand und Weg zu Mein Kalender", async () => {
  apiMock.get.mockResolvedValue({ data: { active: true, created_at: "2099-09-01T10:00:00+00:00", last_used_at: null } });
  render(<MemoryRouter><CalendarTab /></MemoryRouter>);
  expect(await screen.findByTestId("settings-calendar-personal-active")).toHaveTextContent("noch von keinem Kalender abgerufen");
  expect(screen.getByTestId("settings-calendar-personal-renew")).toBeInTheDocument();
  expect(screen.getByTestId("settings-calendar-personal-revoke")).toBeInTheDocument();
  expect(screen.getByTestId("settings-calendar-open")).toHaveAttribute("href", "/calendar/mine");
  expect(apiMock.get).toHaveBeenCalledWith("/calendar/personal");
});
