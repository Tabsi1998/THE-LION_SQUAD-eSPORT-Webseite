import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Check-in je Season (#1652): Vorgaben sichtbar, alte Seasons mit Hinweis, Speichern schickt ganze Zahlen und zeigt Fehler.

const apiMock = { get: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeasonCheckinRulesPanel, checkinRulesPayload } = await import("./SeasonCheckinRulesPanel");

const DEFAULTS = { opens_minutes_before: 15, closes_minutes_after: 15, min_present: 3, remind_minutes_before_close: 5 };

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.put.mockReset();
});

test("eine ältere Season zeigt die Vorgaben und den Hinweis, Speichern schickt Zahlen", async () => {
  apiMock.get.mockResolvedValue({ data: { checkin_rules: null, active: false, defaults: DEFAULTS, staffeln: 2 } });
  apiMock.put.mockResolvedValue({ data: { checkin_rules: { ...DEFAULTS, min_present: 2 }, active: true, defaults: DEFAULTS, staffeln_updated: 2 } });
  render(<SeasonCheckinRulesPanel seasonId="s1" />);
  expect(await screen.findByTestId("checkin-rules-inactive")).toBeInTheDocument();
  expect(screen.getByTestId("checkin-rules-min")).toHaveValue(3);
  fireEvent.change(screen.getByTestId("checkin-rules-min"), { target: { value: "2" } });
  fireEvent.click(screen.getByTestId("checkin-rules-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/checkin-rules",
    { opens_minutes_before: 15, closes_minutes_after: 15, min_present: 2, remind_minutes_before_close: 5 }));
  await waitFor(() => expect(screen.queryByTestId("checkin-rules-inactive")).toBeNull());
});

test("ein Fehler des Servers steht beim Kasten", async () => {
  apiMock.get.mockResolvedValue({ data: { checkin_rules: DEFAULTS, active: true, defaults: DEFAULTS } });
  apiMock.put.mockRejectedValue({ response: { data: { detail: "Mindestens Anwesende je Seite: erlaubt sind 1 bis 50." } } });
  render(<SeasonCheckinRulesPanel seasonId="s1" />);
  fireEvent.click(await screen.findByTestId("checkin-rules-save"));
  expect(await screen.findByTestId("checkin-rules-error")).toHaveTextContent("erlaubt sind 1 bis 50");
});

test("leere Zahlen bleiben weg", () => {
  expect(checkinRulesPayload({ ...DEFAULTS, opens_minutes_before: "", remind_minutes_before_close: "0" }))
    .toEqual({ closes_minutes_after: 15, min_present: 3, remind_minutes_before_close: 0 });
});

test("die Erinnerung an fehlende Angaben ist einstellbar (#2313)", async () => {
  const rules = { ...DEFAULTS, open_points_remind_hours: 48 };
  apiMock.get.mockResolvedValue({ data: { checkin_rules: rules, active: true, defaults: rules } });
  apiMock.put.mockResolvedValue({ data: { checkin_rules: { ...rules, open_points_remind_hours: 72 }, active: true, defaults: rules } });
  render(<SeasonCheckinRulesPanel seasonId="s1" />);
  expect(await screen.findByTestId("checkin-rules-open-points")).toHaveValue(48);
  fireEvent.change(screen.getByTestId("checkin-rules-open-points"), { target: { value: "72" } });
  fireEvent.click(screen.getByTestId("checkin-rules-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/checkin-rules", { ...DEFAULTS, open_points_remind_hours: 72 }));
});
