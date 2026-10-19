import { fireEvent, render, screen } from "@testing-library/react";
import { AccessSection } from "./AccessSection";

// System → Zugang (#1802): Grenze je Netz und Event-Zeitraum einstellen, gespeichert über denselben Weg wie die Schalter.

const config = {
  password_login_enabled: true, registration_enabled: true,
  login_ip_limit_per_minute: 30, register_ip_limit_per_hour: 5,
  event_login_ip_limit_per_minute: 150, event_register_ip_limit_per_hour: 50,
  event_limits_from: "", event_limits_until: "", event_limits_active: false,
};

function renderSection(overrides = {}, saveAuth = vi.fn()) {
  render(<AccessSection authSwitches={() => null} authConfig={{ ...config, ...overrides }} savingAuth={false} saveAuth={saveAuth} />);
  return saveAuth;
}

test("zeigt die geltenden Grenzen mit Schranken und speichert einen höheren Wert", () => {
  const saveAuth = renderSection();
  const login = screen.getByTestId("access-limit-login_ip_limit_per_minute");
  expect(login).toHaveValue(30);
  expect(login).toHaveAttribute("min", "10");
  expect(login).toHaveAttribute("max", "300");
  expect(screen.getByTestId("access-limits")).toHaveTextContent("Schutz je Konto");
  fireEvent.change(login, { target: { value: "120" } });
  fireEvent.click(screen.getByTestId("access-limits-save"));
  expect(saveAuth).toHaveBeenCalledWith(expect.objectContaining({ login_ip_limit_per_minute: 120, register_ip_limit_per_hour: 5, password_login_enabled: true }));
});

test("ein laufender Event-Zeitraum ist sichtbar und lässt sich leeren", () => {
  const saveAuth = renderSection({
    event_limits_from: "2026-10-31T15:00:00+00:00", event_limits_until: "2026-11-01T01:00:00+00:00", event_limits_active: true,
  });
  expect(screen.getByTestId("access-event-active")).toHaveTextContent("Läuft gerade");
  expect(screen.getByTestId("access-event-from").value).toMatch(/^2026-10-31T\d\d:00$/);
  fireEvent.click(screen.getByTestId("access-event-clear"));
  expect(saveAuth).toHaveBeenCalledWith(expect.objectContaining({ event_limits_from: "", event_limits_until: "" }));
});

test("ohne Event-Zeitraum gibt es nichts zu leeren", () => {
  renderSection();
  expect(screen.queryByTestId("access-event-active")).toBeNull();
  expect(screen.getByTestId("access-event-clear")).toBeDisabled();
});

test("ein anderer Zugangs-Schalter lässt ungespeicherte Grenzen stehen, gespeicherte Werte kommen an", () => {
  const props = { authSwitches: () => null, savingAuth: false, saveAuth: vi.fn() };
  const { rerender } = render(<AccessSection {...props} authConfig={config} />);
  fireEvent.change(screen.getByTestId("access-limit-login_ip_limit_per_minute"), { target: { value: "90" } });
  // Schalter „Registrierung offen“ umgelegt: neue Einstellungen vom Server, Grenzen unverändert.
  rerender(<AccessSection {...props} authConfig={{ ...config, registration_enabled: false }} />);
  expect(screen.getByTestId("access-limit-login_ip_limit_per_minute")).toHaveValue(90);
  // Kommen neue Grenzen vom Server (gespeichert), zeigt die Karte sie.
  rerender(<AccessSection {...props} authConfig={{ ...config, registration_enabled: false, login_ip_limit_per_minute: 120 }} />);
  expect(screen.getByTestId("access-limit-login_ip_limit_per_minute")).toHaveValue(120);
});
