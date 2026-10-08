import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CookieConsentProvider, MAX_AGE_DAYS, useCookieConsent } from "./CookieConsent";

// TV und Beamer (#1110, Entscheidung vom 07.10.2026): auf den Anzeige-Seiten kein Cookie-Hinweis, und dort läuft nur
// das Nötige - auch wenn im Browser eine Zustimmung gespeichert ist. Auf allen anderen Seiten das Blatt unten (#1226):
// zwei gleiche Knöpfe, „Einzeln wählen“ mit benannten Schaltern, die Wahl gilt sechs Monate. Die Uhr steht fest.

const DAY = 24 * 60 * 60 * 1000;
const KEY = "tls_cookie_consent_v1";

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

const stored = () => JSON.parse(window.localStorage.getItem(KEY));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

test("ohne Zustimmung: auf normalen Seiten das Blatt, auf TV-Seiten nicht", () => {
  const { unmount } = renderAt("/");
  expect(screen.getByRole("heading", { name: "Cookies und eingebettete Inhalte" })).toBeInTheDocument();
  expect(screen.getByTestId("cookie-sheet")).toBeInTheDocument();
  unmount();
  renderAt("/display/bracket/t1");
  expect(screen.queryByTestId("cookie-sheet")).not.toBeInTheDocument();
  expect(screen.getByTestId("probe")).toHaveTextContent("Statistik aus");
});

test("mit gespeicherter Zustimmung: Statistik auf normalen Seiten an, auf TV-Seiten aus", () => {
  const now = Date.now();
  window.localStorage.setItem(KEY, JSON.stringify({ essential: true, analytics: true, saved_at: now, expires_at: now + DAY }));
  const { unmount } = renderAt("/news");
  expect(screen.getByTestId("probe")).toHaveTextContent("Statistik an");
  unmount();
  renderAt("/display/event/e1");
  expect(screen.getByTestId("probe")).toHaveTextContent("Statistik aus");
});

test("zwei gleich große, gleich gestaltete Knöpfe - kein Fenster über der Seite", () => {
  renderAt("/");
  const essential = screen.getByRole("button", { name: "Nur Nötiges" });
  const all = screen.getByRole("button", { name: "Alle erlauben" });
  expect(essential.className).toBe(all.className);
  const sheet = screen.getByTestId("cookie-sheet");
  expect(sheet.className).not.toMatch(/inset-0|backdrop-blur/);
  expect(sheet.className).toContain("bottom-0");
});

test("„Nur Nötiges“ speichert nichts Optionales und gilt 180 Tage", () => {
  renderAt("/");
  fireEvent.click(screen.getByRole("button", { name: "Nur Nötiges" }));
  expect(screen.queryByTestId("cookie-sheet")).not.toBeInTheDocument();
  expect(stored()).toMatchObject({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false });
  expect(MAX_AGE_DAYS).toBe(180);
  expect(stored().expires_at - stored().saved_at).toBe(180 * DAY);
  expect(screen.getByTestId("probe")).toHaveTextContent("Statistik aus");
});

test("die Wahl gilt sechs Monate - danach fragt das Blatt einmal neu", () => {
  const { unmount } = renderAt("/");
  fireEvent.click(screen.getByRole("button", { name: "Alle erlauben" }));
  expect(stored()).toMatchObject({ external_media: true, analytics: true, meta: true, tiktok: true });
  unmount();
  vi.setSystemTime(new Date(Date.now() + 179 * DAY));
  const later = renderAt("/");
  expect(screen.queryByTestId("cookie-sheet")).not.toBeInTheDocument();
  expect(screen.getByTestId("probe")).toHaveTextContent("Statistik an");
  later.unmount();
  vi.setSystemTime(new Date(Date.now() + 2 * DAY));
  renderAt("/");
  expect(screen.getByTestId("cookie-sheet")).toBeInTheDocument();
  expect(screen.getByTestId("probe")).toHaveTextContent("Statistik aus");
});

test("eine ältere, gespeicherte Wahl gilt bis zu ihrem eigenen Ablauf", () => {
  const savedAt = Date.now() - 20 * DAY;
  window.localStorage.setItem(KEY, JSON.stringify({ essential: true, analytics: true, saved_at: savedAt, expires_at: savedAt + 30 * DAY }));
  const { unmount } = renderAt("/");
  expect(screen.queryByTestId("cookie-sheet")).not.toBeInTheDocument();
  unmount();
  vi.setSystemTime(new Date(Date.now() + 11 * DAY));
  renderAt("/");
  expect(screen.getByTestId("cookie-sheet")).toBeInTheDocument();
});

test("„Einzeln wählen“ öffnet benannte Schalter mit der Rolle switch", () => {
  renderAt("/");
  fireEvent.click(screen.getByRole("button", { name: /Einzeln wählen/ }));
  const media = screen.getByRole("switch", { name: "Externe Medien erlauben" });
  expect(media).toHaveAttribute("aria-checked", "false");
  expect(screen.getByRole("switch", { name: "Statistik erlauben" })).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "Meta erlauben" })).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "TikTok erlauben" })).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "Essentiell – immer an" })).toBeDisabled();
  fireEvent.click(media);
  expect(media).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("button", { name: "Auswahl speichern" }));
  expect(stored()).toMatchObject({ external_media: true, analytics: false, meta: false, tiktok: false });
});
