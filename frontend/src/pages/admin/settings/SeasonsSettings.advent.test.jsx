import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Jahreszeiten und Adventkalender (#641, #1360): Adventkalender und Ostereiersuche stehen hier nur zum Lesen - ein- und
// ausgeschaltet und gepflegt werden sie an genau einer Stelle, ihrer eigenen Seite; dorthin führt der Verweis.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));

const { SeasonsSettings } = await import("./SeasonsSettings");

function season(overrides) {
  return {
    key: "halloween", label: "Halloween", description: "Spinnweben und Kürbisse.", enabled: true, mode: "auto", until: null, intensity: "normal",
    channels: ["web", "app"], supported_channels: ["web", "app"], always: false, texts: {}, defaults: {},
    active_now: false, phase: null, forced: false, next_start: "2026-10-25T00:00:00+02:00", next_end: "2026-11-01T23:59:59+01:00", needs_founded_on: false,
    ...overrides,
  };
}

test("nur die Karte des Adventkalenders führt zu seiner Seite", async () => {
  apiMock.get.mockResolvedValue({ data: {
    enabled: true, now: "2026-09-30T12:00:00+02:00", founded_on: null, calendar: [], intensities: ["subtle", "normal", "full"], channels: ["web", "app"],
    seasons: [season(), season({ key: "advent_calendar", label: "Adventkalender", description: "24 Türchen vom 1. bis 24. Dezember, nachholen bis Dreikönig.", next_start: "2026-12-01T00:00:00+01:00", next_end: "2027-01-06T23:59:59+01:00" })],
  } });
  render(<MemoryRouter><SeasonsSettings /></MemoryRouter>);
  const line = await screen.findByTestId("season-advent_calendar-managed");
  expect(line).toHaveTextContent("gepflegt unter Adventkalender");
  expect(screen.getByRole("link", { name: "Adventkalender" })).toHaveAttribute("href", "/admin/advent");
  expect(screen.queryByTestId("season-halloween-managed")).toBeNull();
  expect(screen.getAllByRole("link")).toHaveLength(1);
});

test("die Ostereiersuche führt zu ihrer Seite (#858)", async () => {
  apiMock.get.mockResolvedValue({ data: {
    enabled: true, now: "2026-09-30T12:00:00+02:00", founded_on: null, calendar: [], intensities: ["subtle", "normal", "full"], channels: ["web", "app"],
    seasons: [season(), season({ key: "easter_hunt", label: "Ostereiersuche", description: "Versteckte Eier von Karfreitag bis Ostermontag.", next_start: "2027-03-26T00:00:00+01:00", next_end: "2027-03-29T23:59:59+02:00" })],
  } });
  render(<MemoryRouter><SeasonsSettings /></MemoryRouter>);
  const line = await screen.findByTestId("season-easter_hunt-managed");
  expect(line).toHaveTextContent("gepflegt unter Ostereiersuche");
  expect(screen.getByRole("link", { name: "Ostereiersuche" })).toHaveAttribute("href", "/admin/ostern");
  expect(screen.queryByTestId("season-halloween-managed")).toBeNull();
});
