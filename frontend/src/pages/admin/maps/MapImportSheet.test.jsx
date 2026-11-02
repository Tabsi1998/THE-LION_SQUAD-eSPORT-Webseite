import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// „Aus <Spiel> übernehmen“ (#2129, SP4) - nur erfundene Map-Namen.
const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { MapImportSheet, importResultText } = await import("./MapImportSheet");
const { toast } = await import("sonner");

const GAME = { id: "neu", name: "Teil 2" };
const SOURCES = [{ id: "alt", name: "Reihe: Teil 1", maps: 3, related: true }, { id: "fremd", name: "Anderes", maps: 1, related: false }];
const MAPS = {
  alt: [
    { id: "hafen", name: "Hafenkante", modes: ["Stellung"], exists: false },
    { id: "nebel", name: "Nebelwerk", modes: [], exists: false },
    { id: "glut", name: "Glutsenke", modes: ["Stellung"], exists: true },
  ],
  fremd: [{ id: "weit", name: "Weitland", modes: [], exists: false }],
};

beforeEach(() => {
  toast.success.mockClear();
  toast.error.mockClear();
  apiMock.post.mockReset();
  apiMock.get.mockImplementation(async (url) => {
    if (url.endsWith("/import-sources")) return { data: SOURCES };
    return { data: { maps: MAPS[url.split("/").pop()] } };
  });
});

test("wählt die nahe Version vor und hakt an, was fehlt - Vorhandenes bleibt gesperrt", async () => {
  render(<MapImportSheet game={GAME} onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByTestId("map-import-row-hafen")).toHaveTextContent("Stellung");
  expect(screen.getByRole("dialog", { name: "Aus Reihe: Teil 1 übernehmen" })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Hafenkante" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Glutsenke" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Glutsenke" })).not.toBeChecked();
  expect(screen.getByTestId("map-import-row-glut")).toHaveTextContent("schon da");
  expect(screen.getByTestId("map-import-row-nebel")).toHaveTextContent("ohne Modus");
  expect(screen.getByTestId("map-import-save")).toHaveTextContent("2 Maps übernehmen");
});

test("Übernehmen schickt die gewählten Maps und meldet das Ergebnis", async () => {
  apiMock.post.mockResolvedValue({ data: { created: [{ id: "x" }], skipped: [] } });
  const onDone = vi.fn();
  render(<MapImportSheet game={GAME} onClose={() => {}} onDone={onDone} />);
  fireEvent.click(await screen.findByRole("checkbox", { name: "Nebelwerk" }));
  fireEvent.submit(screen.getByTestId("map-import-sheet"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/games/neu/maps/import", { source_game_id: "alt", map_ids: ["hafen"] }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(toast.success).toHaveBeenCalledWith("1 Map übernommen.");
});

test("ein anderes Spiel lädt seine Maps neu; ohne Auswahl geht nichts", async () => {
  render(<MapImportSheet game={GAME} onClose={() => {}} onDone={() => {}} />);
  await screen.findByTestId("map-import-row-hafen");
  fireEvent.change(screen.getByTestId("map-import-source"), { target: { value: "fremd" } });
  expect(await screen.findByTestId("map-import-row-weit")).toBeInTheDocument();
  expect(screen.queryByTestId("map-import-row-hafen")).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Weitland" }));
  expect(screen.getByTestId("map-import-save")).toBeDisabled();
});

test("gibt es keine Quelle, sagt das Blatt das", async () => {
  apiMock.get.mockResolvedValue({ data: [] });
  render(<MapImportSheet game={GAME} onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByTestId("map-import-none")).toHaveTextContent("Kein anderes Spiel");
});

test("die Meldung nennt, was ausgelassen wurde und warum", () => {
  expect(importResultText({ created: [{}, {}], skipped: [] })).toBe("2 Maps übernommen.");
  expect(importResultText({ created: [], skipped: [{ reason: "Die Map gibt es schon." }] })).toBe("0 Maps übernommen. 1 ausgelassen: Die Map gibt es schon.");
});
