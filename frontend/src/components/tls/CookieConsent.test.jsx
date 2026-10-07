import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CookieConsentProvider, useCookieConsent } from "./CookieConsent";

// TV und Beamer (#1110, Entscheidung vom 07.10.2026): auf den Anzeige-Seiten kein Cookie-Hinweis, und dort läuft nur
// das Nötige - auch wenn im Browser eine Zustimmung gespeichert ist. Auf allen anderen Seiten wie bisher.

function Probe() {
  const { hasConsent } = useCookieConsent();
  return <p data-testid="probe">{hasConsent("analytics") ? "Statistik an" : "Statistik aus"}</p>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CookieConsentProvider><Probe /></CookieConsentProvider>
    </MemoryRouter>,
  );
}

afterEach(() => window.localStorage.clear());

test("ohne Zustimmung: auf normalen Seiten der Hinweis, auf TV-Seiten nicht", () => {
  const { unmount } = renderAt("/");
  expect(screen.getByRole("heading", { name: "Cookie-Einstellungen" })).toBeInTheDocument();
  unmount();
  renderAt("/display/bracket/t1");
  expect(screen.queryByRole("heading", { name: "Cookie-Einstellungen" })).not.toBeInTheDocument();
  expect(screen.getByTestId("probe")).toHaveTextContent("Statistik aus");
});

test("mit gespeicherter Zustimmung: Statistik auf normalen Seiten an, auf TV-Seiten aus", () => {
  const now = Date.now();
  window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, analytics: true, saved_at: now, expires_at: now + 86400000 }));
  const { unmount } = renderAt("/news");
  expect(screen.getByTestId("probe")).toHaveTextContent("Statistik an");
  unmount();
  renderAt("/display/event/e1");
  expect(screen.getByTestId("probe")).toHaveTextContent("Statistik aus");
});
