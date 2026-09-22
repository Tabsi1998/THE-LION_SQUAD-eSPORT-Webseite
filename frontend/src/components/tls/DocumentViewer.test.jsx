import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentViewer } from "./DocumentViewer";
import { clampPage, nextZoom, viewerErrorText } from "@/lib/pdfViewer";

// PDF-Betrachter (#325): Seiten, Zoom, Tastatur, Download nur wenn erlaubt, Fehler in Worten.
// pdf.js selbst läuft nicht in jsdom – ein Dokument-Double reicht, um die Bedienung zu prüfen.

vi.mock("@/lib/api", () => ({ API: "/api", api: { get: vi.fn() }, formatRequestError: (error, fallback) => error?.response?.data?.detail || fallback }));

function fakeDocument(pages = 3) {
  const page = { getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }), render: vi.fn(() => ({ promise: Promise.resolve() })) };
  return { numPages: pages, getPage: vi.fn(async () => page), destroy: vi.fn(), page };
}

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}));
});

test("Zoomstufen und Seitengrenzen", () => {
  expect(nextZoom(1, 1)).toBe(1.25);
  expect(nextZoom(1, -1)).toBe(0.8);
  expect(nextZoom(3, 1)).toBe(3);
  expect(nextZoom(0.6, -1)).toBe(0.6);
  expect(nextZoom(0.9, 1)).toBe(1.25);
  expect(clampPage(0, 5)).toBe(1);
  expect(clampPage(9, 5)).toBe(5);
  expect(clampPage(2, 0)).toBe(1);
});

test("Fehler stehen in Worten – abgelaufen, entzogen, weg, nicht erreichbar", () => {
  expect(viewerErrorText({ response: { status: 401 } })).toMatch(/Anmeldung ist abgelaufen/);
  expect(viewerErrorText({ response: { status: 403 } })).toMatch(/nicht \(mehr\) freigegeben/);
  expect(viewerErrorText({ response: { status: 404 } })).toMatch(/gibt es nicht mehr/);
  expect(viewerErrorText({ response: { status: 503, data: { detail: "Die Mitgliederverwaltung antwortet gerade nicht: x" } } })).toMatch(/antwortet gerade nicht/);
  expect(viewerErrorText({ name: "InvalidPDFException", message: "Invalid PDF structure" })).toMatch(/nicht als PDF lesen/);
});

test("Seiten blättern, zoomen, Tastatur – und der Download nur, wenn erlaubt", async () => {
  const user = userEvent.setup();
  const doc = fakeDocument(3);
  const open = vi.fn(async () => ({ document: doc, pages: 3, sha256: "abcdef0123456789abcdef" }));
  const onClose = vi.fn();
  render(<DocumentViewer path="/account/invoices/d-1/pdf" title="Rechnung FA-1" open={open} onClose={onClose} downloadPath="/account/invoices/d-1/pdf?download=1" />);
  expect(screen.getByTestId("document-viewer-loading")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId("document-viewer-pages")).toHaveTextContent("1 / 3"));
  expect(open).toHaveBeenCalledWith("/account/invoices/d-1/pdf");
  expect(screen.getByTestId("document-viewer-hash")).toHaveTextContent("abcdef0123456789");
  expect(screen.getByTestId("document-viewer-download")).toHaveAttribute("href", "/api/account/invoices/d-1/pdf?download=1");

  await user.click(screen.getByLabelText("Nächste Seite"));
  expect(screen.getByTestId("document-viewer-pages")).toHaveTextContent("2 / 3");
  await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
  expect(screen.getByTestId("document-viewer-pages")).toHaveTextContent("3 / 3");
  await user.click(screen.getByLabelText("Vergrößern"));
  expect(screen.getByTestId("document-viewer-zoom")).toHaveTextContent("125%");
  await waitFor(() => expect(doc.page.render).toHaveBeenCalled());
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalled();
});

test("ohne Download-Erlaubnis gibt es keinen Download-Knopf, und ein Fehler steht da", async () => {
  const open = vi.fn(async () => { throw { response: { status: 403 } }; });
  render(<DocumentViewer path="/documents/x/view" title="Statuten" open={open} onClose={() => {}} downloadPath={null} />);
  await waitFor(() => expect(screen.getByTestId("document-viewer-error")).toHaveTextContent("nicht (mehr) freigegeben"));
  expect(screen.queryByTestId("document-viewer-download")).toBeNull();
  expect(screen.queryByTestId("document-viewer-canvas")).toBeNull();
});
