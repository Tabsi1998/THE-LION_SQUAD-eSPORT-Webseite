import { fireEvent, render, screen } from "@testing-library/react";
import { applicationToForm } from "@/lib/leagueApplications";
import { SeasonApplicationSection } from "./SeasonApplicationSection";

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
