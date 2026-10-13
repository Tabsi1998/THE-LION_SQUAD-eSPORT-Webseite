import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// 403 (#292): die Seite nennt den fehlenden Bereich und wer ihn vergibt.

vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
const authState = { current: null };
vi.mock("@/context/AuthContext", () => ({ useOptionalAuth: () => authState.current }));

beforeEach(() => {
  authState.current = null;
});

const { ForbiddenPage } = await import("./ErrorPages");

test("mit Bereich aus der Weiterleitung steht er im Text", () => {
  render(
    <MemoryRouter initialEntries={[{ pathname: "/403", state: { areas: ["content"] } }]}>
      <ForbiddenPage />
    </MemoryRouter>
  );
  expect(screen.getByTestId("error-detail-403")).toHaveTextContent("Dafür fehlt dir der Bereich „Redaktion“. Vergeben kann ihn der Superadmin unter Admin → Alle Benutzer.");
});

test("ohne Angabe bleibt der allgemeine Text", () => {
  render(<MemoryRouter initialEntries={["/403"]}><ForbiddenPage /></MemoryRouter>);
  expect(screen.getByTestId("error-detail-403")).toHaveTextContent("Du bist nicht berechtigt");
});

// Angemeldet (#1352): kein „Anmelden“-Knopf. Wer einen Dienst hat, liest genau den Bereich der Seite und kommt mit einem
// Tipp zu seiner Arbeit; wer keinen hat, liest den freundlichen Satz mit dem Weg zum Kontaktformular.
const mfa = { mfa_enabled: true, auth_mfa_verified: true };

function renderForbidden(state) {
  return render(<MemoryRouter initialEntries={[{ pathname: "/403", state }]}><ForbiddenPage /></MemoryRouter>);
}

test("angemeldet mit Dienst: genau ein Bereich, kein Anmelden, ein Knopf zur eigenen Arbeit", () => {
  authState.current = { user: { id: "h", role: "player", has_staff_assignment: true } };
  renderForbidden({ areas: ["tournaments"] });
  expect(screen.getByTestId("error-detail-403")).toHaveTextContent("Dafür fehlt dir der Bereich „Turnierleitung“.");
  expect(screen.getByTestId("error-detail-403")).not.toHaveTextContent("Redaktion");
  expect(screen.queryByTestId("error-login-btn")).toBeNull();
  expect(screen.getByTestId("error-duty-btn")).toHaveAttribute("href", "/admin");
  expect(screen.getByTestId("error-duty-btn")).toHaveTextContent("Zu meinem Dienst");
});

test("angemeldet mit Verwaltungsbereich: „Zur Verwaltung“", () => {
  authState.current = { user: { id: "r", role: "player", areas: ["content"], ...mfa } };
  renderForbidden({ areas: ["club"] });
  expect(screen.getByTestId("error-detail-403")).toHaveTextContent("Dafür fehlt dir der Bereich „Vereinsverwaltung“.");
  expect(screen.getByTestId("error-duty-btn")).toHaveTextContent("Zur Verwaltung");
});

test("angemeldet ohne Dienst: der freundliche Satz statt der Bereichsliste, kein Anmelden", () => {
  authState.current = { user: { id: "p", role: "player" } };
  renderForbidden({ noDuty: true });
  expect(screen.getByTestId("error-detail-403")).toHaveTextContent("Die Verwaltung ist für Vereinsdienste. Du möchtest mithelfen? Schreib uns.");
  expect(screen.getByTestId("error-detail-403")).not.toHaveTextContent("Bereich");
  expect(screen.getByTestId("error-contact-link")).toHaveAttribute("href", "/contact");
  expect(screen.queryByTestId("error-login-btn")).toBeNull();
});

test("Gäste behalten den Anmelden-Knopf", () => {
  renderForbidden({ areas: ["content"] });
  expect(screen.getByTestId("error-login-btn")).toBeInTheDocument();
});
