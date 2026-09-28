import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Jahreszeiten (#633): Hauptschalter und Saison-Schalter speichern sofort, Texte mit eigenem Knopf,
// die Vorschau merkt sich das Token nur in dieser Sitzung, der Stand steht in Worten.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));

const { SeasonsSettings, stateText, PREVIEW_STORAGE_KEY } = await import("./SeasonsSettings");

function season(overrides) {
  return {
    key: "halloween", label: "Halloween", description: "Spinnweben und Kürbisse.", enabled: true, mode: "auto", until: null, intensity: "normal",
    channels: ["web", "app"], texts: { greeting: "Happy Halloween von THE LION SQUAD" }, defaults: { greeting: "Happy Halloween von THE LION SQUAD" },
    active_now: false, phase: null, forced: false, next_start: "2026-10-25T00:00:00+02:00", next_end: "2026-11-01T23:59:59+01:00", needs_founded_on: false,
    ...overrides,
  };
}

const VIEW = {
  enabled: true, now: "2026-09-28T12:00:00+02:00", founded_on: null,
  seasons: [season(), season({ key: "new_year", label: "Silvester", texts: { greeting: "Frohes neues Jahr" }, defaults: { greeting: "Frohes neues Jahr" }, next_start: "2026-12-29T18:00:00+01:00", next_end: "2027-01-01T23:59:59+01:00" }),
    season({ key: "club_birthday", label: "Vereinsgeburtstag", texts: {}, defaults: {}, next_start: null, next_end: null, needs_founded_on: true })],
  calendar: [{ key: "halloween", label: "Halloween", phase: "deko", start: "2026-10-25T00:00:00+02:00", end: "2026-11-01T23:59:59+01:00" }],
  intensities: ["subtle", "normal", "full"], channels: ["web", "app"],
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  apiMock.get.mockResolvedValue({ data: VIEW });
  apiMock.put.mockImplementation(async (_url, patch) => ({ data: { ...VIEW, enabled: patch.enabled ?? VIEW.enabled } }));
  apiMock.post.mockResolvedValue({ data: { token: "halloween.123.456.abc", seconds: 60, key: "halloween" } });
});

test("Stand in Worten", () => {
  expect(stateText(season())).toBe("Nächstes Mal 25.10.2026 bis 01.11.2026.");
  expect(stateText(season({ active_now: true, phase: "deko" }))).toBe("Läuft gerade (deko).");
  expect(stateText(season({ active_now: true, forced: true }))).toBe("Läuft gerade – erzwungen.");
  expect(stateText(season({ enabled: false }))).toBe("Ausgeschaltet.");
  expect(stateText(season({ mode: "force_off", until: "2026-12-05T00:00:00+01:00" }))).toMatch(/^Aus bis 05\.12\.2026/);
  expect(stateText(season({ needs_founded_on: true }))).toContain("Gründungsdatum");
});

test("Hauptschalter und Saison-Schalter speichern sofort, Texte mit eigenem Knopf", async () => {
  const user = userEvent.setup();
  render(<SeasonsSettings />);
  expect(await screen.findByTestId("season-halloween-state")).toHaveTextContent("Nächstes Mal 25.10.2026 bis 01.11.2026.");
  expect(screen.getByTestId("season-club_birthday-state")).toHaveTextContent("Gründungsdatum");
  await user.click(screen.getByTestId("seasons-enabled"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/seasons", { enabled: false }));
  expect(toastMock.success).toHaveBeenCalledWith("Saisonale Deko aus – nirgends mehr zu sehen, Einstellungen bleiben.");
  await user.selectOptions(screen.getByTestId("season-halloween-mode"), "force_on");
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/seasons", { seasons: { halloween: { mode: "force_on" } } }));
  await user.selectOptions(screen.getByTestId("season-halloween-intensity"), "full");
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/seasons", { seasons: { halloween: { intensity: "full" } } }));
  await user.click(screen.getByTestId("season-halloween-channel-app"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/seasons", { seasons: { halloween: { channels: ["web"] } } }));
  // Texte: erst tippen, dann speichern - der Knopf ist vorher aus.
  expect(screen.getByTestId("season-halloween-text-save")).toBeDisabled();
  await user.clear(screen.getByTestId("season-halloween-text-greeting"));
  await user.type(screen.getByTestId("season-halloween-text-greeting"), "Buh!");
  expect(screen.getByTestId("season-halloween-text-save")).toBeEnabled();
  await user.click(screen.getByTestId("season-halloween-text-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/seasons", { seasons: { halloween: { texts: { greeting: "Buh!" } } } }));
  expect(toastMock.success).toHaveBeenCalledWith("Texte gespeichert.");
});

test("Vorschau merkt sich das Token nur in dieser Sitzung und sagt der Bühne sofort Bescheid, Silvester mit Zeit", async () => {
  const user = userEvent.setup();
  let previewEvents = 0;
  window.addEventListener("tls:season-preview", () => { previewEvents += 1; });
  render(<SeasonsSettings />);
  await user.click(await screen.findByTestId("season-halloween-preview"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/seasons/halloween/preview", {}));
  expect(JSON.parse(sessionStorage.getItem(PREVIEW_STORAGE_KEY)).token).toBe("halloween.123.456.abc");
  expect(toastMock.success).toHaveBeenCalledWith("Vorschau läuft 60 Sekunden – hier und auf jeder Seite in diesem Tab.");
  expect(previewEvents).toBe(1);
  expect(screen.queryByTestId("season-halloween-preview-at")).toBeNull();
  await user.type(screen.getByTestId("season-new_year-preview-at"), "2026-12-31T23:59");
  await user.click(screen.getByTestId("season-new_year-preview"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/seasons/new_year/preview", { at: "2026-12-31T23:59" }));
});

test("Kalender blättert über die öffentliche Abfrage", async () => {
  const user = userEvent.setup();
  apiMock.get.mockImplementation(async (url) => (url.startsWith("/seasonal/calendar") ? { data: { year: 2027, items: [{ key: "easter", label: "Ostern", phase: "deko", start: "2027-03-21T00:00:00+01:00", end: "2027-03-29T23:59:59+02:00" }] } } : { data: VIEW }));
  render(<SeasonsSettings />);
  expect(await screen.findByTestId("seasons-calendar")).toHaveTextContent("Kalender 2026");
  expect(screen.getByTestId("seasons-calendar")).toHaveTextContent("Halloween");
  await user.click(screen.getByTestId("seasons-calendar-next"));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/seasonal/calendar?year=2027"));
  expect(await screen.findByText(/Kalender 2027/)).toBeInTheDocument();
  expect(screen.getByTestId("seasons-calendar")).toHaveTextContent("Ostern");
});

test("Ladefehler in Worten", async () => {
  apiMock.get.mockRejectedValue(new Error("down"));
  render(<SeasonsSettings />);
  expect(await screen.findByTestId("seasons-error")).toHaveTextContent("konnte nicht geladen werden");
});
