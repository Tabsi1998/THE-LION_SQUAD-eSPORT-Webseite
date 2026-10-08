import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// „Deine Unterlagen“ (#1255): nur die eigenen Schreiben aus der Vereinsakte, Ansehen im gemeinsamen Betrachter. Ohne
// Bindung der Weg über den Einladungscode; antwortet die Akte nicht, steht das da - statt einer leeren Liste.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ API: "https://api.test/api", api: apiMock }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/components/tls/DocumentViewer", () => ({
  DocumentViewer: ({ title, path, downloadPath }) => <div data-testid="viewer" data-path={path} data-download={downloadPath || ""}>{title}</div>,
}));

const { default: AccountDocumentsPage } = await import("./AccountDocumentsPage");

const OWN = [
  { id: "dolibarr-23", source: "dolibarr", personal: true, title: "Spendenbestätigung 2025", category: "letter", mime: "application/pdf", allow_download: true, created_at: "2026-09-01T10:00:00+00:00" },
  { id: "dolibarr-22", source: "dolibarr", personal: true, title: "Beitrittsbestätigung", category: "letter", mime: "application/pdf", allow_download: true, created_at: "2026-03-02T10:00:00+00:00" },
];

function mockApi(response) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/account/documents") {
      if (response instanceof Error) throw response;
      return { data: response };
    }
    return { data: [] };
  });
}

function renderPage() {
  return render(<MemoryRouter><AccountDocumentsPage /></MemoryRouter>);
}

beforeEach(() => vi.clearAllMocks());

test("die eigenen Unterlagen mit Herkunft; Ansehen öffnet den Betrachter mit Download", async () => {
  mockApi({ available: true, reason: null, text: "", documents: OWN });
  renderPage();
  const list = await screen.findByTestId("account-documents-list");
  expect(list).toHaveTextContent("Spendenbestätigung 2025");
  expect(list).toHaveTextContent("Beitrittsbestätigung");
  expect(screen.getByTestId("doc-source-dolibarr-23")).toHaveTextContent("Vereinsakte · nur für dich");
  fireEvent.click(screen.getByTestId("doc-view-dolibarr-23"));
  expect(screen.getByTestId("viewer")).toHaveAttribute("data-path", "/documents/dolibarr-23/view");
  expect(screen.getByTestId("viewer")).toHaveAttribute("data-download", "/documents/dolibarr-23/download");
  expect(screen.queryByTestId("account-documents-empty")).toBeNull();
});

test("ohne Bindung: der Weg über den Einladungscode", async () => {
  mockApi({ available: true, reason: "not_bound", text: "Dein Konto ist noch nicht verbunden.", documents: [] });
  renderPage();
  const empty = await screen.findByTestId("account-documents-empty");
  expect(empty).toHaveTextContent("Noch keine Unterlagen");
  expect(empty).toHaveTextContent("Einladungscode");
  expect(screen.getByTestId("account-documents-bind")).toHaveAttribute("href", "/members/membership");
});

test("verbunden, aber noch nichts abgelegt", async () => {
  mockApi({ available: true, reason: null, text: "", documents: [] });
  renderPage();
  const empty = await screen.findByTestId("account-documents-empty");
  expect(empty).toHaveTextContent("Noch keine Unterlagen");
  expect(empty).toHaveTextContent("sobald der Vorstand sie in der Vereinsakte für dich ablegt");
  expect(screen.queryByTestId("account-documents-bind")).toBeNull();
});

test("die Akte antwortet nicht oder der Abruf scheitert: das steht da", async () => {
  mockApi({ available: false, reason: "unreachable", text: "Die Vereinsakte antwortet gerade nicht. Bitte später noch einmal versuchen.", documents: [] });
  const { unmount } = renderPage();
  const empty = await screen.findByTestId("account-documents-empty");
  expect(empty).toHaveTextContent("Gerade nicht abrufbar");
  expect(empty).toHaveTextContent("antwortet gerade nicht");
  unmount();

  mockApi(new Error("offline"));
  renderPage();
  expect(await screen.findByTestId("account-documents-empty")).toHaveTextContent("Gerade nicht abrufbar");
});

test("kein Vereinsmitglied: ein Satz statt einer Liste", async () => {
  mockApi({ available: false, reason: "not_member", text: "Unterlagen aus der Vereinsakte gibt es für Vereinsmitglieder.", documents: [] });
  renderPage();
  const empty = await screen.findByTestId("account-documents-empty");
  expect(empty).toHaveTextContent("Keine Unterlagen");
  expect(empty).toHaveTextContent("für Vereinsmitglieder");
});
