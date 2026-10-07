import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Kontakt vorbelegt (#1252, #1254): „Interesse melden“ an einer offenen Vorstandsfunktion und „Unterlagen anfordern“
// bringen Thema und Betreff über die Adresse mit.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/usePublicSiteSettings", () => ({ usePublicSiteSettings: () => ({}) }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const { default: ContactPage } = await import("./ContactPage");

beforeEach(() => {
  apiMock.get.mockResolvedValue({ data: [{ value: "general", label: "Allgemeine Anfrage" }, { value: "volunteer", label: "Mitarbeit im Verein" }, { value: "sponsorship", label: "Sponsoring" }] });
});

test("Thema und Betreff kommen aus der Adresse", async () => {
  render(<MemoryRouter initialEntries={[`/contact?topic=volunteer&subject=${encodeURIComponent("Interesse: Jugendreferent:in")}`]}><ContactPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("contact-topic")).toHaveValue("volunteer"));
  expect(screen.getByTestId("contact-subject")).toHaveValue("Interesse: Jugendreferent:in");
});

test("ohne Angaben bleibt es bei „Allgemeine Anfrage“ und leerem Betreff; Unsinn im Thema zählt nicht", async () => {
  render(<MemoryRouter initialEntries={["/contact?topic=<script>"]}><ContactPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("contact-topic")).toHaveValue("general"));
  expect(screen.getByTestId("contact-subject")).toHaveValue("");
});
