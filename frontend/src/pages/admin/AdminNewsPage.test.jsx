import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    exportNewsCsv([{ ...POSTS[0], status_label: "Veröffentlicht", date_label: "01.08.2026" }]);
  } finally {
    globalThis.Blob = OriginalBlob;
    click.mockRestore();
  }
  expect(written).toContain("Titel;Adresse;Kategorie;Sichtbarkeit;Status;Datum");
  expect(written).toContain("Sommerfest;/news/sommerfest;Rückblick;Nur Vereinsmitglieder;Veröffentlicht;01.08.2026");
});
