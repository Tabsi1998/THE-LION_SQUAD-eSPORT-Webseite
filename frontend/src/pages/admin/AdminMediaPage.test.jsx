import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Medien (#435, letzter Rest): die Detailansicht ist ein Seitenblatt mit den Aktionen in der Leiste
// unten - Vorschau, Angaben und „Verwendet in“ im Blatt, die Kacheln bleiben daneben sichtbar.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ API_BASE: "http://backend.test", api: apiMock, formatApiError: (d) => d || "Fehler", formatUploadError: () => "Fehler", uploadApi: { post: vi.fn() } }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ prepareImageForUpload: async (file) => file }));
const confirmMock = vi.fn(async () => true);
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/components/tls/UploadProgressPanel", () => ({ UploadProgressPanel: () => null }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useUploadProgress", () => ({ useUploadProgress: () => ({ items: [], start: () => {}, update: () => {}, finish: () => {}, fail: () => {}, dismiss: () => {} }) }));
vi.mock("@/lib/uploadDiagnostics", () => ({ logUploadClientFailure: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const AdminMediaPage = (await import("./AdminMediaPage")).default;

const ITEM = {
  filename: "loewe.png", ext: "png", url: "/api/static/uploads/loewe.png", size: 12345, mtime: "2026-09-23T10:00:00Z", media_scope: "branding",
  usage_count: 2, tracked: true, duplicate_count: 1, references: [
    { collection: "settings", id: "branding", field: "logo_url", place: "Einstellungen · Logo", label: "Branding" },
    { collection: "tournaments", id: "t-1", field: "award_images.1", place: "Turnier · Gewinnerbild Platz 1", label: "Cup" },
  ],
};
const UNUSED = { ...ITEM, filename: "frei.png", url: "/api/static/uploads/frei.png", usage_count: 0, references: [], is_unused: true };

beforeEach(() => {
  apiMock.get.mockImplementation(async (url) => {
    if (url.startsWith("/admin/media?")) return { data: [ITEM, UNUSED] };
    if (url === "/admin/media/audit") return { data: { summary: {} } };
    return { data: [] };
  });
});

test("die Kachel öffnet ein Seitenblatt mit Vorschau, Angaben, Verwendung und den Aktionen", async () => {
  render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);
  const tile = await screen.findByTestId("media-tile-loewe.png");
  expect(screen.queryByTestId("media-sheet")).toBeNull();
  fireEvent.click(tile);
  const sheet = screen.getByTestId("media-sheet");
  expect(screen.getByRole("dialog", { name: "loewe.png" })).toBeInTheDocument();
  expect(sheet).toHaveTextContent("Medien · Bild");
  expect(screen.getByTestId("media-sheet-preview")).toBeInTheDocument();
  expect(screen.getByTestId("media-sheet-references")).toHaveTextContent("Branding");
  // Die Verwendungsorte stehen lesbar da, nicht als Feldpfad.
  expect(screen.getByTestId("media-sheet-references")).toHaveTextContent("Turnier · Gewinnerbild Platz 1");
  expect(screen.getByTestId("media-sheet-references")).not.toHaveTextContent("award_images");
  expect(sheet).toHaveTextContent("http://backend.test/api/static/uploads/loewe.png");
  for (const id of ["media-rotate-left", "media-rotate-right", "media-copy-url", "media-delete"]) expect(screen.getByTestId(id)).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("media-sheet-close"));
  expect(screen.queryByTestId("media-sheet")).toBeNull();
  expect(screen.getByTestId("media-tile-loewe.png")).toBeInTheDocument();
});

test("eine verwendete Datei wird nur nach Warnung gelöscht, eine unbenutzte ohne", async () => {
  apiMock.delete.mockResolvedValue({ data: { ok: true, cleared_references: 2, text_references: 0 } });
  render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("media-tile-loewe.png"));
  fireEvent.click(screen.getByTestId("media-delete"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/media/loewe.png?force=true"));
  const warning = confirmMock.mock.calls.at(-1)[0];
  expect(warning.title).toBe("Verwendete Datei löschen?");
  expect(warning.description).toContain("Turnier · Gewinnerbild Platz 1");

  fireEvent.click(await screen.findByTestId("media-tile-frei.png"));
  fireEvent.click(screen.getByTestId("media-delete"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/media/frei.png"));
  expect(confirmMock.mock.calls.at(-1)[0].title).toBe("Datei endgültig löschen?");
});

test("Seiten, Filter und Suche fragt die Mediathek beim Server an (#2122)", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url.startsWith("/admin/media?")) return { data: { items: [ITEM], total: 130, total_size: 2048, limit: 60, offset: 0 } };
    if (url === "/admin/media/audit") return { data: { summary: {} } };
    return { data: [] };
  });
  render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);
  expect(await screen.findByTestId("media-page-label")).toHaveTextContent("Seite 1 von 3");
  expect(apiMock.get.mock.calls.map(([url]) => url)).toContain("/admin/media?paged=true&limit=60&offset=0&include_user_uploads=false&include_usage=true");

  fireEvent.click(screen.getByTestId("media-page-next"));
  await waitFor(() => expect(screen.getByTestId("media-page-label")).toHaveTextContent("Seite 2 von 3"));
  await waitFor(() => expect(apiMock.get.mock.calls.at(-1)[0]).toContain("offset=60"));
  // Die Prüfung liest alle Dateien - sie läuft beim Öffnen, nicht bei jedem Blättern.
  expect(apiMock.get.mock.calls.filter(([url]) => url === "/admin/media/audit")).toHaveLength(1);

  // Ein neuer Filter beginnt wieder vorne.
  fireEvent.change(screen.getByTestId("media-scope-filter"), { target: { value: "unused" } });
  await waitFor(() => expect(apiMock.get.mock.calls.some(([url]) => url.includes("scope=unused") && url.includes("offset=0"))).toBe(true));
  fireEvent.click(screen.getByTestId("media-filter-videos"));
  await waitFor(() => expect(apiMock.get.mock.calls.some(([url]) => url.includes("type=videos"))).toBe(true));
  fireEvent.change(screen.getByTestId("media-search"), { target: { value: "uralt" } });
  await waitFor(() => expect(apiMock.get.mock.calls.some(([url]) => url.includes("q=uralt"))).toBe(true));
});

test("Drehen fragt nach, nennt die Stellen und übernimmt Adresse und Maße (#2122)", async () => {
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { url: "/api/static/uploads/loewe.png?v=7", size: 999, width: 500, height: 1000, updated_at: "2026-10-01T10:00:00Z" } });
  render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("media-tile-loewe.png"));

  confirmMock.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByTestId("media-rotate-right"));
  await waitFor(() => expect(confirmMock.mock.calls.at(-1)[0].title).toBe("Bild nach rechts drehen?"));
  expect(confirmMock.mock.calls.at(-1)[0].description).toContain("an 2 Stellen");
  expect(confirmMock.mock.calls.at(-1)[0].description).toContain("gespeicherten Ergebnissen");
  expect(apiMock.post).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId("media-rotate-left"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/media/loewe.png/rotate", { degrees: -90 }));
  expect(await screen.findByTestId("media-sheet-dimensions")).toHaveTextContent("500 × 1000 px");
  expect(screen.getByTestId("media-sheet")).toHaveTextContent("loewe.png?v=7");
});

test("Löschen: Zeigt der Server eine weitere Stelle, kommt die Rückfrage, gelöscht wird erst danach (#2122)", async () => {
  const taken = { response: { status: 409, data: { detail: "Die Datei wird noch gezeigt (Ergebnisblatt). Zum Löschen bitte bestätigen." } } };
  apiMock.delete.mockReset();
  apiMock.delete.mockRejectedValueOnce(taken);
  render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);

  // Abgelehnt: Die Datei bleibt, es gibt keinen zweiten Aufruf.
  confirmMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  fireEvent.click(await screen.findByTestId("media-tile-frei.png"));
  fireEvent.click(screen.getByTestId("media-delete"));
  await waitFor(() => expect(confirmMock.mock.calls.at(-1)[0].description).toContain("Ergebnisblatt"));
  expect(confirmMock.mock.calls.at(-1)[0].title).toBe("Verwendete Datei löschen?");
  expect(apiMock.delete).toHaveBeenCalledTimes(1);
  expect(await screen.findByTestId("media-tile-frei.png")).toBeInTheDocument();

  // Bestätigt: jetzt mit force.
  apiMock.delete.mockRejectedValueOnce(taken).mockResolvedValueOnce({ data: { ok: true } });
  fireEvent.click(screen.getByTestId("media-tile-frei.png"));
  fireEvent.click(screen.getByTestId("media-delete"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenLastCalledWith("/admin/media/frei.png?force=true"));
  expect(apiMock.delete).toHaveBeenCalledTimes(3);
});

test("Ungenutzte löschen: erst die Rückfrage mit Zahl und Größe, dann genau diese Dateien (#2122)", async () => {
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { ok: true, deleted: 2, skipped: 1, file_pending: 0 } });
  apiMock.get.mockImplementation(async (url) => {
    if (url.startsWith("/admin/media?")) return { data: { items: [UNUSED], total: 1 } };
    if (url === "/admin/media/audit") return { data: { unused: 3, summary: {} } };
    if (url === "/admin/media/unused") return { data: { count: 3, total_size: 2048, filenames: ["a.webp", "b.webp", "c.webp"], min_age_hours: 24 } };
    return { data: [] };
  });
  render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);

  confirmMock.mockResolvedValueOnce(false);
  fireEvent.click(await screen.findByTestId("media-cleanup-unused"));
  await waitFor(() => expect(confirmMock.mock.calls.at(-1)[0].title).toBe("3 ungenutzte Dateien löschen?"));
  expect(confirmMock.mock.calls.at(-1)[0].description).toContain("2.0 KB");
  expect(confirmMock.mock.calls.at(-1)[0].description).toContain("letzten 24 Stunden");
  expect(apiMock.post).not.toHaveBeenCalled();

  await waitFor(() => expect(screen.getByTestId("media-cleanup-unused")).toBeEnabled());
  fireEvent.click(screen.getByTestId("media-cleanup-unused"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/media/cleanup-unused", { filenames: ["a.webp", "b.webp", "c.webp"] }));
});

test("Ungenutzte löschen: Bei mehr als einer Runde nennt die Rückfrage genau, was dieser Klick löscht (#2122)", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url.startsWith("/admin/media?")) return { data: { items: [UNUSED], total: 1 } };
    if (url === "/admin/media/audit") return { data: { unused: 612, summary: {} } };
    if (url === "/admin/media/unused") return { data: { count: 612, total_size: 10 * 1024 * 1024, batch_size: 2048, filenames: Array.from({ length: 500 }, (_, i) => `f${i}.webp`), min_age_hours: 24 } };
    return { data: [] };
  });
  render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);
  confirmMock.mockResolvedValueOnce(false);
  fireEvent.click(await screen.findByTestId("media-cleanup-unused"));
  await waitFor(() => expect(confirmMock.mock.calls.at(-1)[0].title).toBe("Die ersten 500 von 612 ungenutzten Dateien löschen?"));
  const { description } = confirmMock.mock.calls.at(-1)[0];
  expect(description).toContain("2.0 KB");
  expect(description).not.toContain("10.00 MB");
  expect(description).toContain("weiteren Klick");
});

test("Duplikat ersetzen: fragt nach und nennt, was bleibt (#2122)", async () => {
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { ok: true, removed: 1, references: 3 } });
  const COPY = { ...ITEM, duplicate_count: 2, duplicate_filenames: ["loewe.png", "kopie.png"] };
  apiMock.get.mockImplementation(async (url) => {
    if (url.startsWith("/admin/media?")) return { data: { items: [COPY], total: 1 } };
    if (url === "/admin/media/audit") return { data: { summary: {} } };
    return { data: [] };
  });
  render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("media-tile-loewe.png"));
  fireEvent.click(screen.getByTestId("media-duplicate-keep"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/media/duplicates/replace", { keep: "loewe.png" }));
  expect(confirmMock.mock.calls.at(-1)[0].title).toBe("Kopie ersetzen?");
  expect(confirmMock.mock.calls.at(-1)[0].description).toContain("„loewe.png“ bleibt");
});

test("eine behaltene Kopie sagt in ihrer Zeile, warum sie noch da ist (#2122)", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url.startsWith("/admin/media?")) return { data: { items: [ITEM, { ...UNUSED, kept_for_results: true }], total: 2 } };
    if (url === "/admin/media/audit") return { data: { summary: {} } };
    return { data: [] };
  });
  render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);
  expect(await screen.findByTestId("media-kept-frei.png")).toHaveTextContent("wird noch von gespeicherten Ergebnissen gezeigt");
  expect(screen.queryByTestId("media-kept-loewe.png")).toBeNull();
});

test("die Mediathek spricht Deutsch statt Technik-Englisch (#2122)", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url.startsWith("/admin/media?")) return { data: { items: [{ ...UNUSED, media_scope: "legacy", tracked: false }], total: 1 } };
    if (url === "/admin/media/audit") return { data: { unused: 1, untracked: 1, by_scope: { legacy: 1 }, summary: {} } };
    return { data: [] };
  });
  const { container } = render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("media-tile-frei.png"));
  for (const word of ["Scope", "Legacy", "ngetrackt", "User-Medien", "Metadaten", "Referenz"]) {
    expect(container.textContent).not.toContain(word);
    expect(screen.getByTestId("media-sheet").textContent).not.toContain(word);
  }
  expect(screen.getByTestId("media-tile-frei.png")).toHaveTextContent("Ohne Zuordnung");
  expect(screen.getByTestId("media-tile-frei.png")).toHaveTextContent("nicht erfasst");
});

test("Original-Bilder der Serien (#1933) zählt die Mediathek mit - privat, ohne Kachel", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url.startsWith("/admin/media?")) return { data: [ITEM] };
    if (url === "/admin/media/audit") return { data: { summary: {}, reference_originals: { count: 5, bytes: 2.5 * 1024 * 1024 } } };
    return { data: [] };
  });
  render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);
  expect(await screen.findByTestId("media-reference-originals")).toHaveTextContent("5 Original-Bilder der Serien · 2.50 MB");
  expect(screen.queryByTestId("media-tile-reference")).toBeNull();
});
// Tastatur (#937): eine Kachel ist ein Knopf - per Tab erreichbar, Enter und Leertaste öffnen das Seitenblatt.
test("die Kachel ist ein Knopf: Enter und Leertaste öffnen das Seitenblatt", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);
  const tile = await screen.findByTestId("media-tile-loewe.png");
  expect(tile.tagName).toBe("BUTTON");
  expect(tile).toHaveAttribute("type", "button");
  tile.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("dialog", { name: "loewe.png" })).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("media-sheet-close"));
  screen.getByTestId("media-tile-frei.png").focus();
  await user.keyboard(" ");
  expect(screen.getByRole("dialog", { name: "frei.png" })).toBeInTheDocument();
});

// #937: vorgelesen wird kurz der Dateiname, Bereich, Hinweise, Größe und Nutzung kommen als Beschreibung; im Knopf
// stehen nur Spans (kein div in einem button).
test("die Kachel heißt wie die Datei, die Angaben stehen als Beschreibung daran", async () => {
  render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);
  const tile = await screen.findByTestId("media-tile-frei.png");
  expect(tile).toHaveAccessibleName("frei.png");
  expect(tile).toHaveAccessibleDescription(/ungenutzt/);
  expect(tile).toHaveAccessibleDescription(/0x genutzt/);
  expect(tile.querySelector("div")).toBeNull();
  expect(screen.getByRole("button", { name: "loewe.png" })).toBe(screen.getByTestId("media-tile-loewe.png"));
});
