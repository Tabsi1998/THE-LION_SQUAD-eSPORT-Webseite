import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { seasonTarget } from "@/lib/seasonTabs";

// Erinnerungen je Season (#1647): Vorgaben sichtbar, ein Schalter je Art, Zeiten nur mit eingeschalteter Art, Speichern schickt
// Schalter und ganze Zahlen, Fehler des Servers stehen beim Kasten.

const apiMock = { get: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeasonReminderRulesPanel, reminderRulesPayload } = await import("./SeasonReminderRulesPanel");

const DEFAULTS = {
  upcoming: true, upcoming_early_hours: 24, upcoming_late_minutes: 60, unscheduled: true, unscheduled_week_percent: 50,
  result_missing: true, veto_turn: true, veto_idle_seconds: 20, veto_min_left_seconds: 5, discord: false,
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.put.mockReset();
});

test("eine Season ohne gespeicherte Werte zeigt die Vorgaben, Speichern schickt Schalter und Zahlen", async () => {
  apiMock.get.mockResolvedValue({ data: { reminder_rules: null, active: false, defaults: DEFAULTS, result_reminder_hours: 24, staffeln: 2 } });
  apiMock.put.mockResolvedValue({ data: { reminder_rules: { ...DEFAULTS, upcoming_early_hours: 12, discord: true }, active: true,
    defaults: DEFAULTS, result_reminder_hours: 24, staffeln_updated: 2 } });
  render(<SeasonReminderRulesPanel seasonId="s1" />);
  expect(await screen.findByTestId("reminder-rules-inactive")).toBeInTheDocument();
  expect(screen.getByTestId("reminder-rules-early")).toHaveValue(24);
  expect(screen.getByTestId("reminder-rules-veto-idle")).toHaveValue(20);
  expect(screen.getByTestId("reminder-rules-veto-left")).toHaveValue(5);
  expect(screen.getByTestId("reminder-rules-discord")).not.toBeChecked();
  expect(screen.getByTestId("reminder-rules-result-box")).toHaveTextContent("24 h nach dem Termin");
  fireEvent.change(screen.getByTestId("reminder-rules-early"), { target: { value: "12" } });
  fireEvent.click(screen.getByTestId("reminder-rules-discord"));
  fireEvent.click(screen.getByTestId("reminder-rules-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/reminder-rules",
    { ...DEFAULTS, upcoming_early_hours: 12, discord: true }));
  await waitFor(() => expect(screen.queryByTestId("reminder-rules-inactive")).toBeNull());
});

test("eine ausgeschaltete Art sperrt ihre Zeiten", async () => {
  apiMock.get.mockResolvedValue({ data: { reminder_rules: DEFAULTS, active: true, defaults: DEFAULTS } });
  render(<SeasonReminderRulesPanel seasonId="s1" />);
  const toggle = await screen.findByTestId("reminder-rules-veto");
  expect(screen.getByTestId("reminder-rules-veto-idle")).toBeEnabled();
  fireEvent.click(toggle);
  expect(screen.getByTestId("reminder-rules-veto-idle")).toBeDisabled();
  expect(screen.getByTestId("reminder-rules-early")).toBeEnabled();
});

test("ein Fehler des Servers steht beim Kasten", async () => {
  apiMock.get.mockResolvedValue({ data: { reminder_rules: DEFAULTS, active: true, defaults: DEFAULTS } });
  apiMock.put.mockRejectedValue({ response: { data: { detail: "„Map-Veto wartet“ nach Sekunden ohne Zug muss eine ganze Zahl von 5 bis 300 sein." } } });
  render(<SeasonReminderRulesPanel seasonId="s1" />);
  fireEvent.click(await screen.findByTestId("reminder-rules-save"));
  expect(await screen.findByTestId("reminder-rules-error")).toHaveTextContent("von 5 bis 300");
});

test("leere Zahlen bleiben weg, Schalter gehen immer mit", () => {
  expect(reminderRulesPayload({ ...DEFAULTS, upcoming_late_minutes: "", veto_turn: undefined }))
    .toEqual({ ...Object.fromEntries(Object.entries(DEFAULTS).filter(([key]) => key !== "upcoming_late_minutes")), veto_turn: false });
});

test("die Sprungmarke #erinnerungen führt in den Reiter Termine", () => {
  expect(seasonTarget("#erinnerungen")).toEqual({ tab: "termine", section: "erinnerungen" });
});
