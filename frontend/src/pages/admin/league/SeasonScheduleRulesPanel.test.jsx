import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Terminregeln je Season (#2194): Vorgaben sichtbar, alte Seasons mit Hinweis, Speichern schickt ganze Zahlen und zeigt Fehler.

const apiMock = { get: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeasonScheduleRulesPanel, scheduleRulesPayload } = await import("./SeasonScheduleRulesPanel");

const DEFAULTS = { home_rule: true, home_rule_hours: 72, reschedule_notice_hours: 24, reschedule_max: 2, reschedule_same_week: true,
  result_reminder_hours: 24, result_overdue_hours: 48 };

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.put.mockReset();
});

test("eine ältere Season zeigt die Vorgaben und den Hinweis, Speichern schickt Zahlen", async () => {
  apiMock.get.mockResolvedValue({ data: { schedule_rules: null, active: false, defaults: DEFAULTS, staffeln: 2 } });
  apiMock.put.mockResolvedValue({ data: { schedule_rules: { ...DEFAULTS, reschedule_max: 1 }, active: true, defaults: DEFAULTS, staffeln_updated: 2 } });
  render(<SeasonScheduleRulesPanel seasonId="s1" />);
  expect(await screen.findByTestId("schedule-rules-inactive")).toBeInTheDocument();
  expect(screen.getByTestId("schedule-rules-home-hours")).toHaveValue(72);
  fireEvent.change(screen.getByTestId("schedule-rules-max"), { target: { value: "1" } });
  fireEvent.click(screen.getByTestId("schedule-rules-same-week"));
  fireEvent.click(screen.getByTestId("schedule-rules-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/schedule-rules",
    expect.objectContaining({ reschedule_max: 1, reschedule_same_week: false, home_rule_hours: 72 })));
  await waitFor(() => expect(screen.queryByTestId("schedule-rules-inactive")).toBeNull());
});

test("ein Fehler des Servers steht beim Kasten", async () => {
  apiMock.get.mockResolvedValue({ data: { schedule_rules: DEFAULTS, active: true, defaults: DEFAULTS } });
  apiMock.put.mockRejectedValue({ response: { data: { detail: "„Überfällig nach“ darf nicht vor der Erinnerung liegen." } } });
  render(<SeasonScheduleRulesPanel seasonId="s1" />);
  fireEvent.click(await screen.findByTestId("schedule-rules-save"));
  expect(await screen.findByTestId("schedule-rules-error")).toHaveTextContent("Überfällig");
});

test("leere Zahlen bleiben weg", () => {
  expect(scheduleRulesPayload({ ...DEFAULTS, home_rule_hours: "", reschedule_max: "0" })).toEqual({
    home_rule: true, reschedule_same_week: true, reschedule_notice_hours: 24, reschedule_max: 0, result_reminder_hours: 24, result_overdue_hours: 48 });
});
