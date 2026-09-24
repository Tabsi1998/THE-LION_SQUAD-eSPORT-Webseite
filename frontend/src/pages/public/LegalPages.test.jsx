import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Rechtstexte kommen als Abschnitte vom Backend (#545); hier zählt nur das Rendern: Abschnitte mit Anker,
// Absätze mit **fett** und Links (intern, Mail, extern), Listen, Begriff/Wert-Zeilen, freier Vereinstext,
// Hinweis bei unvollständigen Kontaktdaten. Was in den Abschnitten steht, prüft das Backend.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/Breadcrumbs", () => ({ Breadcrumbs: () => null }));

const { PrivacyPage, ImprintPage } = await import("./LegalPages");

const PRIVACY = {
  page: "privacy", title: "Datenschutzerklärung", intro: "Informationen zur Verarbeitung.", updated_at: "2026-09-01", legal_ready: true,
  sections: [
    { id: "controller", title: "Verantwortlicher", blocks: [{ type: "info", rows: [["Verantwortlicher", "Testverein Löwen"], ["Adresse", ["Teststraße 1", "6410 Testdorf"]], ["Datenschutz", "[dsgvo@example.test](mailto:dsgvo@example.test)"]] }] },
    { id: "account", title: "Konto und Anmeldung", blocks: [
      { type: "p", text: "Auf Wunsch mit einem **Passkey** (WebAuthn).", testid: "privacy-account" },
      { type: "p", text: "Eine Anmeldung über Google bieten wir nicht an.", testid: "privacy-no-google-login" },
    ] },
    { id: "recipients", title: "Empfänger", blocks: [{ type: "list", items: ["Hosting: eigener Infrastruktur des Vereins", "Discord Inc."], testid: "privacy-recipients" }] },
    { id: "account-deletion", title: "Konto löschen", blocks: [{ type: "p", text: "Unter [Meine Daten](/privacy-account) oder bei [www.dsb.gv.at](https://www.dsb.gv.at/)." }] },
    { id: "extra", title: "Ergänzende Datenschutzhinweise", blocks: [{ type: "text", text: "Zeile eins\nZeile zwei" }] },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/settings/public/legal/privacy") return { data: PRIVACY };
    if (url === "/settings/public/legal/imprint") {
      return { data: { page: "imprint", title: "Impressum", intro: "Anbieterkennzeichnung.", legal_ready: false, sections: [
        { id: "operator", title: "Medieninhaber und Betreiber", blocks: [{ type: "info", rows: [["Verein", "Testverein Löwen"]] }] },
        { id: "representation", title: "Vertretung", blocks: [{ type: "info", rows: [["Vertretungsbefugt", "Otto Obmann"], ["Inhaltlich verantwortlich", "Otto Obmann"]] }] },
      ] } };
    }
    throw new Error("unbekannt");
  });
});

test("die Datenschutzerklärung rendert Abschnitte, Anker, fett, Links, Listen, Zeilen und Vereinstext", async () => {
  render(<MemoryRouter><PrivacyPage /></MemoryRouter>);
  expect(await screen.findByTestId("privacy-account")).toContainHTML("<strong>Passkey</strong>");
  expect(screen.getByTestId("privacy-no-google-login")).toBeInTheDocument();
  expect(screen.getByTestId("privacy-recipients")).toHaveTextContent("eigener Infrastruktur des Vereins");
  expect(document.getElementById("account-deletion")).toHaveTextContent("Konto löschen");
  expect(screen.getByRole("link", { name: "Meine Daten" })).toHaveAttribute("href", "/privacy-account");
  const external = screen.getByRole("link", { name: "www.dsb.gv.at" });
  expect(external).toHaveAttribute("href", "https://www.dsb.gv.at/");
  expect(external).toHaveAttribute("target", "_blank");
  expect(screen.getByRole("link", { name: "dsgvo@example.test" })).toHaveAttribute("href", "mailto:dsgvo@example.test");
  expect(screen.getByText("Teststraße 1")).toBeInTheDocument();
  expect(screen.getByText("6410 Testdorf")).toBeInTheDocument();
  expect(screen.getByText(/Zeile eins/)).toHaveClass("whitespace-pre-line");
  expect(screen.getByText(/Stand: 01\.09\.2026/)).toBeInTheDocument();
  expect(screen.queryByTestId("legal-data-incomplete")).toBeNull();
});

test("das Impressum zeigt die gelieferten Werte und den Hinweis, wenn die Kontaktdaten unvollständig sind", async () => {
  render(<MemoryRouter><ImprintPage /></MemoryRouter>);
  expect(await screen.findByText("Testverein Löwen")).toBeInTheDocument();
  // Vertretungsbefugt und inhaltlich verantwortlich - zweimal derselbe Name.
  expect(screen.getAllByText("Otto Obmann").length).toBe(2);
  expect(screen.getByTestId("legal-data-incomplete")).toBeInTheDocument();
});
