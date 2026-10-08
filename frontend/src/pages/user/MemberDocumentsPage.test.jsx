import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Vereinsdokumente im Mitgliederbereich (#324 Teil 1, #1255): für alle Mitglieder gleich - nur die Vereinsdokumente
// (scope=club); Unterlagen aus der Akte tragen ihre Herkunft. Die eigenen Schreiben stehen im Profil („Nur für dich“),
// ein Satz führt dorthin; ohne Bindung erklärt ein Hinweis den Weg über den Einladungscode.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ API: "https://api.test/api", api: apiMock }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/components/tls/DocumentViewer", () => ({ DocumentViewer: () => null }));

const { default: MemberDocumentsPage } = await import("./MemberDocumentsPage");

const DOCS = [
  { id: "d-1", title: "Hausordnung", category: "guideline", mime: "application/pdf", allow_download: true, view_url: "/api/documents/d-1/view" },
  { id: "dolibarr-3", source: "dolibarr", personal: false, title: "Protokoll Generalversammlung", category: "minutes", description: "unterschrieben · für Mitglieder · Kennung DOC03-1",
    mime: "application/pdf", allow_download: true, view_url: "/api/documents/dolibarr-3/view" },
];

function mockApi(identity) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/documents/meta") return { data: { categories: [{ k: "guideline", l: "Leitlinie" }] } };
    if (url === "/membership/me/identity") return { data: identity };
    if (String(url).startsWith("/documents")) return { data: DOCS };
    return { data: [] };
  });
}

beforeEach(() => vi.clearAllMocks());

test("verbunden: nur Vereinsdokumente, Unterlagen aus der Akte mit Herkunft, kein Hinweis", async () => {
  mockApi({ available: true, status: "bound", capabilities: ["documents"] });
  render(<MemoryRouter><MemberDocumentsPage /></MemoryRouter>);
  expect(await screen.findByTestId("doc-row-dolibarr-3")).toHaveTextContent("Protokolle");
  expect(screen.getByTestId("doc-source-dolibarr-3")).toHaveTextContent(/^Vereinsakte$/);
  expect(screen.getByTestId("doc-row-dolibarr-3")).toHaveTextContent("Kennung DOC03-1");
  expect(screen.queryByTestId("doc-source-d-1")).not.toBeInTheDocument();
  expect(screen.queryByTestId("docs-identity-hint")).not.toBeInTheDocument();
  expect(apiMock.get).toHaveBeenCalledWith("/documents", { params: { scope: "club" } });
  // Die eigenen Schreiben stehen im Profil - ein Satz führt dorthin.
  expect(screen.getByTestId("docs-own-hint").querySelector("a")).toHaveAttribute("href", "/account/documents");
});

test("ohne Bindung: der Hinweis führt zum Einladungscode", async () => {
  mockApi({ available: true, status: "none", capabilities: [] });
  render(<MemoryRouter><MemberDocumentsPage /></MemoryRouter>);
  const hint = await screen.findByTestId("docs-identity-hint");
  expect(hint).toHaveTextContent("Einladungscode unter Meine Mitgliedschaft");
  expect(hint.querySelector("a")).toHaveAttribute("href", "/members/membership");
});

test("ohne Live-Anbindung kein Hinweis; ein Filter fragt weiter nur die Vereinsdokumente", async () => {
  mockApi({ available: false, status: "none", capabilities: [] });
  render(<MemoryRouter><MemberDocumentsPage /></MemoryRouter>);
  await screen.findByTestId("doc-row-d-1");
  expect(screen.queryByTestId("docs-identity-hint")).not.toBeInTheDocument();
  fireEvent.click(await screen.findByTestId("docs-filter-guideline"));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/documents", { params: { scope: "club", category: "guideline" } }));
});
