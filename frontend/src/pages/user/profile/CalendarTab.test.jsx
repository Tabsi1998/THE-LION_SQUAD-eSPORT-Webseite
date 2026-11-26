import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mein Kalender-Abo (#1788): ein fester Eintrag unter „Konto & Sicherheit“ in „Mein Bereich“ (#2059), mit dem Abo-Kasten und dem Weg zu
// „Mein Kalender“.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));

const { CalendarTab } = await import("./CalendarTab");
const { ProfileNav } = await import("./ProfileNav");
const { SETTINGS_GROUPS } = await import("./constants");

test("der Eintrag steht unter Konto & Sicherheit (#2059)", () => {
  const konto = SETTINGS_GROUPS.find((group) => group.key === "konto").tabs;
  render(<MemoryRouter><ProfileNav tabs={konto} tab="calendar" onSelect={() => {}} /></MemoryRouter>);
  const entry = screen.getByTestId("profile-tab-calendar");
  expect(entry).toHaveTextContent("Kalender-Abo");
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
