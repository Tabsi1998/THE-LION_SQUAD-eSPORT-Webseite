import { categoryLabel, documentFileName, documentUrl, documentsDirectory, downloadErrorText, formatFileSize, invoiceFileName } from "./memberDocuments";

// Vereinsdokumente in der App (#341): private Dateien, klare Fehlertexte.

test("Dateiname im Cache: Kennung vorne, harmlose Zeichen, Endung aus Name oder Typ", () => {
  expect(documentFileName({ id: "d1", original_filename: "Statuten 2026 (final).pdf" })).toBe("d1-Statuten 2026 _final_.pdf");
  expect(documentFileName({ id: "d2", title: "Protokoll/März", mime: "application/pdf" })).toBe("d2-Protokoll_M_rz.pdf");
  expect(documentFileName({ id: "d3", original_filename: "../../etc/passwd" })).toBe("d3-passwd.bin");
  expect(documentFileName({ id: "d4", mime: "image/png" })).toBe("d4-dokument.png");
});

test("Adresse: view_url relativ zur API, absolute bleiben", () => {
  expect(documentUrl({ id: "d1", view_url: "/api/documents/d1/view" })).toMatch(/^https?:\/\/.+\/api\/documents\/d1\/view$/);
  expect(documentUrl({ id: "d1" })).toMatch(/\/api\/documents\/d1\/view$/);
  expect(documentUrl({ id: "d1", view_url: "https://cdn.example/x.pdf" })).toBe("https://cdn.example/x.pdf");
});

test("Fehlertexte sagen, woran es liegt", () => {
  expect(downloadErrorText(403)).toMatch(/Kein Zugriff/);
  expect(downloadErrorText(404)).toMatch(/fehlt auf dem Server/);
  expect(downloadErrorText(401)).toMatch(/neu an/);
  expect(downloadErrorText(503)).toMatch(/Server antwortet/);
  expect(downloadErrorText(undefined)).toMatch(/konnte nicht geladen/);
});

test("Kategorien und Größen lesbar", () => {
  expect(categoryLabel("minutes")).toBe("Protokolle");
  expect(categoryLabel("weird")).toBe("Dokument");
  expect(formatFileSize(512)).toBe("512 B");
  expect(formatFileSize(20480)).toBe("20 KB");
  expect(formatFileSize(1572864)).toBe("1,5 MB");
  expect(formatFileSize(null)).toBe("");
});

test("eigener Ordner im Cache; Belege heißen nach ihrer Nummer", () => {
  expect(documentsDirectory("file:///cache/")).toBe("file:///cache/member-documents/");
  expect(invoiceFileName({ key: "k1", ref: "RE-2026/0007", type: "standard", type_label: "Rechnung", status: "open", status_label: "offen" })).toBe("beleg-RE-2026_0007.pdf");
});
