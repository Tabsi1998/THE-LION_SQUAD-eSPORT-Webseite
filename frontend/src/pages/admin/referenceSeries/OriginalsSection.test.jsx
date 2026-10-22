import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Original-Bilder im Ergebnisblatt (#1933): hinzufügen, ziehen, einfügen; Art, Map, Quelle (nur https), öffentlich oder
// nur Verwaltung; Freigeben und Löschen nur für den Vorstand, Löschen mit Rückfrage. Nur erfundene Daten.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler") }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { OriginalsSection } = await import("./OriginalsSection");

const BASE = "/reference-series/admin/series/serie-1/rounds/r1/originals";
const item = (id, extra = {}) => ({
  id, round_id: "r1", kind: "race", map: null, source_url: null, public: true, state: "released", origin: "upload", width: 1600,
  height: 900, url: `/api${BASE}/${id}/file`, mine: false, shown: true, hidden_reason: null, ...extra,
});
const LIST = { items: [item("a"), item("b", { kind: "table", public: false, shown: false, hidden_reason: "admin_only" })],
  can_delete: true, max_mb: 50, default_kind: "race", kinds: ["qualifying", "sprint", "race", "scoreboard", "table", "other"] };

function png(name = "bild.png") {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
}

function setup(props = {}, list = LIST) {
  apiMock.get.mockResolvedValue({ data: list });
  apiMock.post.mockImplementation(async (url, file, { params }) => ({ data: item("neu", { kind: params.kind }) }));
  apiMock.patch.mockImplementation(async (url, body) => ({ data: { ...body } }));
  apiMock.delete.mockResolvedValue({ data: { deleted: "a" } });
  render(<OriginalsSection base={BASE} defaultKind="race" board canPublish {...props} />);
}

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

test("Liste mit Status, hinzufügen über das Dateifeld (am Handy Kamera oder Galerie)", async () => {
  setup();
  const rows = await screen.findAllByTestId("original-row");
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByTestId("original-status")).toHaveTextContent("Öffentlich zu sehen");
  expect(within(rows[1]).getByTestId("original-status")).toHaveTextContent("Nur Verwaltung");
  expect(within(rows[1]).getByRole("radio", { name: "Nur Verwaltung" })).toHaveAttribute("aria-checked", "true");
  const field = screen.getByTestId("original-file");
  expect(field).toHaveAttribute("accept", "image/png,image/jpeg,image/webp");
  expect(field).toHaveAttribute("multiple");
  const file = png();
  fireEvent.change(field, { target: { files: [file] } });
  await waitFor(() => expect(screen.getAllByTestId("original-row")).toHaveLength(3));
  expect(apiMock.post).toHaveBeenCalledWith(BASE, file, { params: { kind: "race", origin: "upload" }, headers: { "Content-Type": "image/png" } });
  // Falsches Format prüft schon der Browser.
  fireEvent.change(field, { target: { files: [new File(["x"], "a.gif", { type: "image/gif" })] } });
  expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("Nur PNG, JPG oder WebP"));
  expect(apiMock.post).toHaveBeenCalledTimes(1);
});

test("hierher ziehen oder einfügen lädt hoch", async () => {
  setup();
  const section = await screen.findByTestId("result-originals");
  const file = png("gezogen.png");
  fireEvent.dragOver(section, { dataTransfer: { types: ["Files"], files: [file] } });
  expect(section).toHaveAttribute("data-dragging", "true");
  fireEvent.drop(section, { dataTransfer: { types: ["Files"], files: [file] } });
  expect(section).not.toHaveAttribute("data-dragging");
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(BASE, file, expect.anything()));
  const pasted = png("eingefuegt.png");
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files: [pasted], items: [], getData: () => "" } });
  act(() => { screen.getByTestId("original-add").dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(BASE, pasted, expect.anything()));
});

test("Art, Map, Sichtbarkeit und Quelle speichern sofort; Quelle nur als https", async () => {
  setup();
  const [first] = await screen.findAllByTestId("original-row");
  fireEvent.change(within(first).getByTestId("original-kind"), { target: { value: "scoreboard" } });
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith(`${BASE}/a`, { kind: "scoreboard" }));
  fireEvent.change(within(first).getByTestId("original-map"), { target: { value: "2" } });
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith(`${BASE}/a`, { map: 2 }));
  fireEvent.click(within(first).getByRole("radio", { name: "Nur Verwaltung" }));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith(`${BASE}/a`, { public: false }));
  const source = within(first).getByTestId("original-source");
  fireEvent.change(source, { target: { value: "http://veranstalter.example/r1" } });
  fireEvent.blur(source);
  expect(within(first).getByRole("alert")).toHaveTextContent("https");
  expect(apiMock.patch).not.toHaveBeenCalledWith(`${BASE}/a`, { source_url: "http://veranstalter.example/r1" });
  fireEvent.change(source, { target: { value: "https://veranstalter.example/r1" } });
  fireEvent.blur(source);
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith(`${BASE}/a`, { source_url: "https://veranstalter.example/r1" }));
});

test("Vorstand: löschen nur nach Rückfrage, Entwürfe einzeln freigeben", async () => {
  setup({}, { ...LIST, items: [item("a"), item("d", { state: "draft", shown: false, hidden_reason: "draft" })] });
  const rows = await screen.findAllByTestId("original-row");
  expect(within(rows[0]).queryByTestId("original-release")).toBeNull();
  fireEvent.click(within(rows[1]).getByTestId("original-release"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith(`${BASE}/d`, { release: true }));
  fireEvent.click(within(rows[0]).getByTestId("original-delete"));
  expect(apiMock.delete).not.toHaveBeenCalled();
  fireEvent.click(within(rows[0]).getByTestId("original-delete-cancel"));
  fireEvent.click(within(rows[0]).getByTestId("original-delete"));
  fireEvent.click(within(rows[0]).getByTestId("original-delete-confirm"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith(`${BASE}/a`));
  await waitFor(() => expect(screen.getAllByTestId("original-row")).toHaveLength(1));
});

test("Captain: nur eigene Entwürfe sind änderbar, kein Freigeben und kein Löschen", async () => {
  setup({ board: false, canPublish: false }, { ...LIST, can_delete: false, items: [
    item("eigen", { state: "draft", mine: true, shown: false, hidden_reason: "draft" }), item("fremd", { mine: false }),
  ] });
  const rows = await screen.findAllByTestId("original-row");
  expect(within(rows[0]).getByTestId("original-kind")).not.toBeDisabled();
  expect(within(rows[0]).getByTestId("original-status")).toHaveTextContent("Entwurf – geht mit dem Ergebnis hinaus");
  expect(within(rows[1]).getByTestId("original-kind")).toBeDisabled();
  expect(screen.queryByTestId("original-delete")).toBeNull();
  expect(screen.queryByTestId("original-release")).toBeNull();
  expect(screen.getByTestId("result-originals")).toHaveTextContent("Deine Bilder sind Entwürfe");
});

test("ohne Bilder: ein ruhiger Hinweis statt einer leeren Liste", async () => {
  setup({}, { ...LIST, items: [] });
  expect(await screen.findByTestId("original-empty")).toHaveTextContent("Noch keine Original-Bilder");
});
