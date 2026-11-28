import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { runAtTestClock } from "@/testClock";

// Feste Uhr (#1307): die Datums-Texte lassen das laufende Jahr weg und sagen „heute“/„morgen“.
runAtTestClock();

// News-Liste (#2122 NW4): Sichtbarkeit und Kategorie mit Namen statt Rohwert - in der Tabelle, den Filtern und der CSV.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const confirmMock = vi.fn(async () => true);
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));

const { default: AdminNewsPage, exportNewsCsv } = await import("./AdminNewsPage");

const META = { categories: [{ k: "club", l: "Verein" }], visibilities: [{ k: "public", l: "Öffentlich" }, { k: "members", l: "Nur Vereinsmitglieder" }] };
const POSTS = [
  { id: "n1", title: "Sommerfest", slug: "sommerfest", category: "recap", visibility: "members", published: true, published_at: "2026-08-01T10:00:00+00:00" },
];

beforeEach(() => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/news-meta") return { data: META };
    if (url === "/admin/news") return { data: POSTS };
    return { data: [] };
  });
});

test("Sichtbarkeit und Kategorie stehen als Begriff da", async () => {
  render(<MemoryRouter><AdminNewsPage /></MemoryRouter>);
  expect(await screen.findByTestId("news-visibility-n1")).toHaveTextContent("Nur Vereinsmitglieder");
  expect(screen.getByRole("cell", { name: "Rückblick" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Rückblick" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "recap" })).toBeNull();
});

test("CSV nennt Begriffe und die Adresse statt Rohwerten", async () => {
  let written = "";
  const OriginalBlob = globalThis.Blob;
  globalThis.Blob = class { constructor(parts) { written = parts.join(""); } };
  globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
  globalThis.URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    exportNewsCsv([{ ...POSTS[0], status_label: "Veröffentlicht", date_label: "01.08.2026" }]);
  } finally {
    globalThis.Blob = OriginalBlob;
    click.mockRestore();
  }
  expect(written).toContain("Titel;Adresse;Kategorie;Sichtbarkeit;Status;Datum");
  expect(written).toContain("Sommerfest;/news/sommerfest;Rückblick;Nur Vereinsmitglieder;Veröffentlicht;01.08.2026");
});

// Zurückziehen statt Löschen (#2122 NW3): was schon hinausging, wird zurückgezogen; nur nie öffentliche Entwürfe lassen
// sich löschen; Zurückgezogenes kommt mit „Wiederherstellen“ zurück.
test("Knöpfe je Stand: Zurückziehen, Löschen nur für Entwürfe, Wiederherstellen", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/news-meta") return { data: META };
    if (url === "/admin/news") return { data: [
      { ...POSTS[0], can_delete: false },
      { id: "n2", title: "Notiz", slug: "notiz", category: "club", visibility: "public", published: false, can_delete: true },
      { id: "n3", title: "Abgesagt", slug: "abgesagt", category: "club", visibility: "public", published: false, withdrawn_at: "2026-10-20T10:00:00+00:00", can_delete: false },
    ] };
    return { data: [] };
  });
  apiMock.post.mockResolvedValue({ data: {} });
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
  render(<MemoryRouter><AdminNewsPage /></MemoryRouter>);

  fireEvent.click(await screen.findByTestId("news-withdraw-n1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/news/n1/withdraw"));
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Beitrag zurückziehen?", confirmLabel: "Zurückziehen" }));
  expect(screen.queryByTestId("news-delete-n1")).toBeNull();

  fireEvent.click(screen.getByTestId("news-delete-n2"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/news/n2"));

  expect(screen.getByText("Zurückgezogen", { selector: "span" })).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("news-restore-n3"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/news/n3/restore"));
  expect(screen.getByTestId("news-view-n2")).toHaveTextContent("Vorschau");
  expect(screen.getByTestId("news-view-n1")).toHaveTextContent("Ansehen");
});
// Angeheftete News laufen ab (#1263): die Redaktion sieht das Ende - und wenn es vorbei ist.
test("die Liste nennt das Ende der Anheftung", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/news-meta") return { data: META };
    if (url === "/admin/news") return { data: [
      { ...POSTS[0], pinned: true, pinned_until: "2099-10-21", pin_active: true },
      { id: "n2", title: "Alt", slug: "alt", category: "club", visibility: "public", published: true, pinned: true, pinned_until: "2020-01-05", pin_active: false },
      { id: "n3", title: "Normal", slug: "normal", category: "club", visibility: "public", published: true },
    ] };
    return { data: [] };
  });
  render(<MemoryRouter><AdminNewsPage /></MemoryRouter>);
  expect(await screen.findByTestId("news-pin-n1")).toHaveTextContent("Angepinnt bis Mi 21. Oktober 2099");
  expect(screen.getByTestId("news-pin-n2")).toHaveTextContent("Anpinnen abgelaufen (bis So 5. Jänner 2020)");
  expect(screen.queryByTestId("news-pin-n3")).toBeNull();
});

// Kanal (#1532): ein kleines Schild nur bei „Nur App“ oder „Nur Website“ - alte News ohne Feld gelten als beides.
test("Schild für den Kanal in der Liste und Spalte in der CSV", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/news-meta") return { data: META };
    if (url === "/admin/news") return { data: [
      { ...POSTS[0] },
      { id: "n2", title: "App-Update", slug: "app-update", category: "club", visibility: "public", published: true, channels: ["app"] },
      { id: "n3", title: "Nur Web", slug: "nur-web", category: "club", visibility: "public", published: true, channels: ["web"] },
    ] };
    return { data: [] };
  });
  render(<MemoryRouter><AdminNewsPage /></MemoryRouter>);
  expect(await screen.findByTestId("news-channel-n2")).toHaveTextContent("Nur App");
  expect(screen.getByTestId("news-channel-n3")).toHaveTextContent("Nur Website");
  expect(screen.queryByTestId("news-channel-n1")).toBeNull();

  let written = "";
  const OriginalBlob = globalThis.Blob;
  globalThis.Blob = class { constructor(parts) { written = parts.join(""); } };
  globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
  globalThis.URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    exportNewsCsv([{ ...POSTS[0], status_label: "Veröffentlicht", date_label: "01.08.2026" }, { id: "n2", title: "App-Update", channels: ["app"] }]);
  } finally {
    globalThis.Blob = OriginalBlob;
    click.mockRestore();
  }
  expect(written).toContain("Status;Datum;Kanal");
  expect(written).toContain("01.08.2026;Website und App");
  expect(written).toContain("App-Update;;;Öffentlich;;;Nur App");
});
