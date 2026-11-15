import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { applicationToForm } from "@/lib/leagueApplications";

const apiMock = { post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
const { SeasonApplicationSection } = await import("./SeasonApplicationSection");

// Selbstanmeldung je Season (docs/LIGA.md, B.4): „Anmeldungen automatisch annehmen“ (#2348) mit dem Hinweis auf offene Anmeldungen von vorher.
function renderSection(season, waiting, extra = {}) {
  const set = vi.fn();
  const form = { ...applicationToForm(season), ...extra };
  render(<SeasonApplicationSection form={form} set={set} waiting={waiting} />);
  return set;
}

test("die Einstellung ist aus und schaltet sich ein", () => {
  const set = renderSection({}, 2);

  const toggle = screen.getByTestId("season-form-application-auto-accept");
  expect(toggle).not.toBeChecked();
  expect(screen.getByTestId("season-application-settings")).toHaveTextContent("Anmeldungen automatisch annehmen");
  expect(screen.queryByTestId("season-form-application-auto-waiting")).toBeNull();
  fireEvent.click(toggle);
  expect(set).toHaveBeenCalledWith("application_auto_accept", true);
});

test("eingeschaltet nennt sie die offenen Anmeldungen, die bei der Leitung bleiben", () => {
  renderSection({ application_auto_accept: true }, 2);

  expect(screen.getByTestId("season-form-application-auto-accept")).toBeChecked();
  expect(screen.getByTestId("season-form-application-auto-waiting")).toHaveTextContent("2 Anmeldungen warten auf Prüfung und halten ihren Platz frei. Entscheide sie im Eingang.");
});

test("ohne offene Anmeldungen steht kein Hinweis da", () => {
  renderSection({ application_auto_accept: true }, 0);

  expect(screen.queryByTestId("season-form-application-auto-waiting")).toBeNull();
});

test("Nachmeldung (Nr. 180): endet die Anmeldung nach dem Season-Start, steht ein Hinweis da - davor nicht", () => {
  const season = { application_opens_at: "2026-11-01T17:00:00+00:00", application_closes_at: "2026-11-20T19:00:00+00:00" };
  renderSection(season, 0, { start_day: "2026-11-17" });
  expect(screen.getByTestId("season-form-application-after-start")).toHaveTextContent("Anmeldung läuft nach Season-Start weiter (bis 20.11.2026, 20:00 Uhr).");
});

test("ohne Nachmeldung kein Hinweis", () => {
  const season = { application_opens_at: "2026-11-01T17:00:00+00:00", application_closes_at: "2026-11-15T19:00:00+00:00" };
  renderSection(season, 0, { start_day: "2026-11-17" });
  expect(screen.queryByTestId("season-form-application-after-start")).toBeNull();
});

// Nachmeldefrist (#2422, Nr. 184): Vorgabe 14 Tage nach dem Start, auch wenn das Fenster länger läuft; Verlängern nur mit Grund.
const LONG = { application_opens_at: "2026-11-01T17:00:00+00:00", application_closes_at: "2026-12-31T19:00:00+00:00" };

test("Nachmeldefrist: leer heißt 14 Tage, der Hinweis nennt das wirksame Ende", () => {
  const set = renderSection(LONG, 0, { start_day: "2026-11-17" });
  const field = screen.getByTestId("season-form-late-days");
  expect(field).toHaveValue(null);
  expect(field).toHaveAttribute("placeholder", "14");
  expect(screen.getByTestId("season-form-application-after-start")).toHaveTextContent("Anmeldung läuft nach Season-Start weiter (bis 01.12.2026, 00:00 Uhr).");
  expect(screen.getByTestId("season-form-late-cap")).toHaveTextContent("Die Anmeldung schließt am 01.12.2026, 00:00 Uhr, auch wenn das Fenster länger eingestellt ist.");
  fireEvent.change(field, { target: { value: "30" } });
  expect(set).toHaveBeenCalledWith("late_registration_days", "30");
});

test("Nachmeldefrist: mit eigener Frist und ohne Kappung kein Hinweis zur Frist", () => {
  renderSection(LONG, 0, { start_day: "2026-11-17", late_registration_days: "60" });
  expect(screen.getByTestId("season-form-application-after-start")).toHaveTextContent("(bis 31.12.2026, 20:00 Uhr)");
  expect(screen.queryByTestId("season-form-late-cap")).toBeNull();
});

test("Verlängern mit Grund: erst mit fünf Zeichen, dann an den Server", async () => {
  apiMock.post.mockResolvedValue({ data: {} });
  const onReload = vi.fn();
  const form = { ...applicationToForm(LONG), start_day: "2026-11-17" };
  render(<SeasonApplicationSection form={form} set={vi.fn()} seasonId="s1" onReload={onReload} late={{ days: 14, extension: null }} />);
  fireEvent.click(screen.getByTestId("season-late-extension-open"));
  fireEvent.change(screen.getByTestId("season-late-extension-until"), { target: { value: "2026-12-10T18:00" } });
  fireEvent.change(screen.getByTestId("season-late-extension-reason"), { target: { value: "kurz" } });
  expect(screen.getByTestId("season-late-extension-save")).toBeDisabled();
  fireEvent.change(screen.getByTestId("season-late-extension-reason"), { target: { value: "Nachrücker aus Liga 2" } });
  fireEvent.click(screen.getByTestId("season-late-extension-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/application-extension",
    { until: "2026-12-10T17:00:00.000Z", reason: "Nachrücker aus Liga 2" }));
  await waitFor(() => expect(onReload).toHaveBeenCalled());
});

test("eine Verlängerung steht mit Grund da und verschiebt das Ende", () => {
  const form = { ...applicationToForm(LONG), start_day: "2026-11-17" };
  render(<SeasonApplicationSection form={form} set={vi.fn()} seasonId="s1"
    late={{ days: 14, extension: { until: "2026-12-10T17:00:00+00:00", reason: "Nachrücker aus Liga 2" } }} />);
  expect(screen.getByTestId("season-late-extension-current")).toHaveTextContent("Verlängert bis 10.12.2026, 18:00 Uhr. Grund: Nachrücker aus Liga 2");
  expect(screen.getByTestId("season-form-late-cap")).toHaveTextContent("Verlängert bis 10.12.2026, 18:00 Uhr.");
});

test("ohne Fenster über den Start gibt es nichts zu verlängern", () => {
  const form = { ...applicationToForm({ application_opens_at: "2026-11-01T17:00:00+00:00", application_closes_at: "2026-11-15T19:00:00+00:00" }), start_day: "2026-11-17" };
  render(<SeasonApplicationSection form={form} set={vi.fn()} seasonId="s1" late={{ days: 14, extension: null }} />);
  expect(screen.queryByTestId("season-late-extension")).toBeNull();
});

test("Enter im Verlängern speichert nicht den Reiter (Review #2422), mit vollständiger Eingabe die Verlängerung", async () => {
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: {} });
  const onSubmit = vi.fn((event) => event.preventDefault());
  const form = { ...applicationToForm(LONG), start_day: "2026-11-17" };
  render(<form onSubmit={onSubmit}><SeasonApplicationSection form={form} set={vi.fn()} seasonId="s1" late={{ days: 14, extension: null }} /></form>);
  fireEvent.click(screen.getByTestId("season-late-extension-open"));
  const reason = screen.getByTestId("season-late-extension-reason");
  expect(fireEvent.keyDown(reason, { key: "Enter" })).toBe(false);
  expect(apiMock.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("season-late-extension-until"), { target: { value: "2026-12-10T18:00" } });
  fireEvent.change(reason, { target: { value: "Nachrücker aus Liga 2" } });
  expect(fireEvent.keyDown(reason, { key: "Enter" })).toBe(false);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/application-extension",
    { until: "2026-12-10T17:00:00.000Z", reason: "Nachrücker aus Liga 2" }));
  expect(onSubmit).not.toHaveBeenCalled();
});
