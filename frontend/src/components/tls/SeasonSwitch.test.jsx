import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Adventkalender und Ostereiersuche (#1360): der Schalter steht auf der eigenen Seite - an/aus, Zeitraum, wo sie erscheinen.

const apiMock = { get: vi.fn(), put: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeasonSwitch, switchWindowText } = await import("./SeasonSwitch");

const STATE = { key: "advent_calendar", label: "Adventkalender", enabled: false, channels: ["web", "app"], supported_channels: ["web", "app"], mode: "auto", until: null,
  active_now: false, next_start: "2026-12-01T06:00:00+01:00", next_end: "2027-01-06T23:59:59+01:00", seasons_enabled: true };

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: STATE });
});

test("Zeitraum in Worten - aus, an, läuft", () => {
  expect(switchWindowText(STATE)).toMatch(/^Aus – erscheint nicht\. Eingeschaltet zu sehen von 1\. Dezember 2026/);
  expect(switchWindowText({ ...STATE, enabled: true })).toMatch(/^Sichtbar von 1\. Dezember 2026.*06:00 bis 6\. Jänner 2027/);
  expect(switchWindowText({ ...STATE, enabled: true, active_now: true })).toBe("Läuft gerade.");
});

test("einschalten und die App abwählen geht über den schmalen Weg", async () => {
  apiMock.put.mockImplementation(async (_url, patch) => ({ data: { ...STATE, ...patch } }));
  const user = userEvent.setup();
  render(<SeasonSwitch seasonKey="advent_calendar" label="Adventkalender" />);
  expect(await screen.findByTestId("season-switch-title")).toHaveTextContent("Adventkalender ist aus");
  await user.click(screen.getByTestId("season-switch-enabled"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/seasonal/switch/advent_calendar", { enabled: true }));
  expect(await screen.findByTestId("season-switch-title")).toHaveTextContent("Adventkalender ist an");
  expect(toastMock.success).toHaveBeenCalledWith("Adventkalender ist an.");
  await user.click(screen.getByTestId("season-switch-channel-app"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/seasonal/switch/advent_calendar", { channels: ["web"] }));
});

test("sind die Jahreszeiten insgesamt aus, sagt der Kasten, wer das ändert", async () => {
  apiMock.get.mockResolvedValue({ data: { ...STATE, enabled: true, seasons_enabled: false } });
  render(<SeasonSwitch seasonKey="easter_hunt" label="Ostereiersuche" />);
  expect(await screen.findByTestId("season-switch-global-off")).toHaveTextContent("einschalten kann das System unter Auftritt → Jahreszeiten");
});
