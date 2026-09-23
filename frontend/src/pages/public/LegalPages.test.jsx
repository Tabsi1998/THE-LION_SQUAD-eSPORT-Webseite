import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Datenschutzerklärung (Rechtliches II): die Abschnitte folgen den Schaltern, die wirklich an sind,
// und das Impressum nennt die Werte aus Dolibarr, wenn der Verein sie von dort übernimmt.

const settingsState = { value: {} };
vi.mock("@/hooks/usePublicSiteSettings", () => ({ usePublicSiteSettings: () => settingsState.value }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/Breadcrumbs", () => ({ Breadcrumbs: () => null }));

const { PrivacyPage, ImprintPage } = await import("./LegalPages");

const BASE = {
  club_name: "THE LION SQUAD", legal_name: "THE LION SQUAD - eSPORTS", contact_email: "office@example.test", privacy_contact_email: "dsgvo@example.test",
  street_address: "Teststraße 1", postal_code: "6410", city: "Testdorf", country: "Österreich", hosting_provider: "Eigenhosting", hosting_country: "Österreich",
  representative_name: "Otto Obmann", representative_role: "Obmann", zvr_number: "123456789", legal_ready: true,
};

beforeEach(() => { settingsState.value = { ...BASE }; });

test("ohne Dienste: kein Google-Login, kein Statistikdienst, kein Discord-Abschnitt, aber App und E-Mail", () => {
  settingsState.value = { ...BASE, privacy_facts: { email_provider: "none", analytics: "", google_login: false, discord: { webhooks: false, bot: false }, dolibarr: false, hosting: { provider: "Eigenhosting", country: "Österreich" } } };
  render(<MemoryRouter><PrivacyPage /></MemoryRouter>);
  expect(screen.getByTestId("privacy-no-google-login")).toBeInTheDocument();
  expect(screen.getByTestId("privacy-analytics")).toHaveTextContent("keinen Statistik- oder Tracking-Dienst");
  expect(screen.getByTestId("privacy-email")).toHaveTextContent("kein E-Mail-Versand");
  expect(screen.queryByTestId("privacy-discord-webhooks")).toBeNull();
  expect(screen.queryByTestId("privacy-dolibarr")).toBeNull();
  expect(screen.getByTestId("privacy-app")).toHaveTextContent("Crashlytics");
  expect(screen.getByTestId("privacy-recipients")).toHaveTextContent("eigener Infrastruktur des Vereins");
});

test("mit Diensten: Resend, Discord-Bot, Plausible, Dolibarr mit Rechnungen und Impressum aus Dolibarr", () => {
  settingsState.value = {
    ...BASE, legal_source: { dolibarr: true, fetched_at: "2026-09-23T10:00:00+00:00", fields: ["legal_name"] },
    privacy_facts: { email_provider: "resend", analytics: "plausible", google_login: true, discord: { webhooks: true, bot: true }, dolibarr: true, dolibarr_billing: true, twitch_embed: true, hosting: { provider: "Eigenhosting", country: "Österreich" } },
  };
  render(<MemoryRouter><PrivacyPage /></MemoryRouter>);
  expect(screen.getByTestId("privacy-google-login")).toHaveTextContent("Mit Google anmelden");
  expect(screen.getByTestId("privacy-email")).toHaveTextContent("Resend");
  expect(screen.getByTestId("privacy-discord-webhooks")).toBeInTheDocument();
  expect(screen.getByTestId("privacy-discord-bot")).toHaveTextContent("Anzahl");
  expect(screen.getByTestId("privacy-analytics")).toHaveTextContent("Plausible");
  expect(screen.getByTestId("privacy-dolibarr-billing")).toHaveTextContent("sieben Jahre");
  expect(screen.getByTestId("privacy-legal-source")).toBeInTheDocument();
  const recipients = screen.getByTestId("privacy-recipients");
  expect(recipients).toHaveTextContent("Resend, Inc.");
  expect(recipients).toHaveTextContent("Discord Inc.");
  expect(recipients).toHaveTextContent("Twitch");
  expect(recipients).toHaveTextContent("Plausible");
});

test("das Impressum zeigt die Werte, die die öffentlichen Einstellungen liefern – egal ob von Hand oder aus Dolibarr", () => {
  settingsState.value = { ...BASE, legal_name: "Testverein Löwen", representative_name: "Otto Obmann", legal_source: { dolibarr: true, fetched_at: "2026-09-23T10:00:00+00:00", fields: ["legal_name", "representative_name"] } };
  render(<MemoryRouter><ImprintPage /></MemoryRouter>);
  expect(screen.getByText("Testverein Löwen")).toBeInTheDocument();
  // Vertretungsbefugt und (als Rückfall) inhaltlich verantwortlich - zweimal derselbe Name.
  expect(screen.getAllByText("Otto Obmann").length).toBe(2);
});
