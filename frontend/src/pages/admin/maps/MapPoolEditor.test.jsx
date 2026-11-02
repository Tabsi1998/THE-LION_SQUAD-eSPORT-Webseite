import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MapPoolEditor } from "./MapPoolEditor";

// Pool-Editor der Verwaltung (#1616): je Modus nur freigegebene Maps, Reihenfolge per Pfeil, Vorgabe des Spiels
// übernehmen, aus einer Quelle kopieren, Speichern mit Version. Nur erfundene Map-Namen.
const GAME = { id: "g1", name: "Probe Shooter", modes: [{ mode: "stellung", label: "Stellung" }, { mode: "snd", label: "Suchen & Zerstören" }] };
const LIBRARY = [
  { id: "hafen", name: "Hafenkante", modes: ["stellung", "snd"] },
  { id: "nebel", name: "Nebelwerk", modes: ["snd"] },
];
const ENTRY = {
  id: "p1", version: 3, origin: "tournament", saved_at: "2026-10-20T18:00:00Z", stale: false, outdated_map_ids: ["nebel"],
  modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: "nebel", name: "Nebelwerk alt" }, { map_id: "hafen", name: "Hafenkante" }] }],
};

function renderEditor(props = {}) {
  const onSave = vi.fn().mockResolvedValue(true);
  const onClear = vi.fn().mockResolvedValue(true);
  render(
    <MemoryRouter>
      <MapPoolEditor title="Map-Pool des Turniers" game={GAME} library={LIBRARY} entry={ENTRY} onSave={onSave} onClear={onClear} testId="pool" {...props} />
    </MemoryRouter>,
  );
  return { onSave, onClear };
}

test("bietet je Modus nur freigegebene Maps an, die gewählten zuerst in ihrer Reihenfolge", () => {
  renderEditor();
  const stellung = screen.getByTestId("pool-mode-stellung");
  expect(within(stellung).getAllByTestId(/pool-map-/).map((row) => row.dataset.mapId)).toEqual(["hafen"]);
  const snd = screen.getByTestId("pool-mode-snd");
  expect(within(snd).getAllByTestId(/pool-map-/).map((row) => row.dataset.mapId)).toEqual(["nebel", "hafen"]);
  expect(within(snd).getByText("2 von 2")).toBeInTheDocument();
  expect(screen.getByTestId("pool-status")).toHaveTextContent("Version 3");
  // Seit dem Speichern geändert - der Snapshot zeigt noch den alten Stand.
  expect(screen.getByTestId("pool-outdated")).toHaveTextContent("Nebelwerk alt");
  expect(screen.getByTestId("pool-save")).toBeDisabled();
});

// #2129, SP2: Bereinigter Modus und Maps ohne Modus - alles lesbar und benannt, nichts still gesperrt.
test("ein entfernter Modus im gespeicherten Pool bleibt benannt, Speichern nimmt ihn erst bewusst heraus", () => {
  const entry = { ...ENTRY, outdated_map_ids: [], modes: [...ENTRY.modes, { mode: "alt", label: "Alter Modus", maps: [{ map_id: "hafen", name: "Hafenkante" }] }] };
  const { onSave } = renderEditor({ entry });
  expect(screen.getByTestId("pool-old-groups")).toHaveTextContent("„Alter Modus“ (1)");
  expect(screen.getByTestId("pool-old-groups")).toHaveTextContent("gilt unverändert weiter");
  fireEvent.click(screen.getByTestId("pool-save"));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ modes: [{ mode: "snd", map_ids: ["nebel", "hafen"] }] }));
});

test("ein Pool von vor dem ersten Modus zeigt seinen Stand, ohne etwas zu verlieren", () => {
  const entry = { ...ENTRY, outdated_map_ids: [], modes: [{ mode: null, label: "Alle Maps", maps: [{ map_id: "hafen", name: "Hafenkante" }] }] };
  renderEditor({ entry });
  expect(screen.getByTestId("pool-old-groups")).toHaveTextContent("„Alle Maps“ (1)");
});

test("Maps ohne Modus nennt der Editor und führt zur Bibliothek", () => {
  renderEditor({ library: [...LIBRARY, { id: "glut", name: "Glutsenke", modes: [] }], libraryLink: true });
  expect(screen.getByTestId("pool-without-mode")).toHaveTextContent("1 Map hat noch keinen Modus");
  expect(within(screen.getByTestId("pool-without-mode")).getByRole("link", { name: "Zuordnen" })).toHaveAttribute("href", "/admin/games/g1/maps");
});

// #2129, SP3: Der Knopf heißt weiter „Vorgabe des Spiels“ und lädt den Standard-Pool, ohne ihn wie bisher alle aktiven Maps.
describe("Vorgabe des Spiels", () => {
  const DEFAULT = { id: "d1", version: 2, modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: "hafen", name: "Hafenkante" }] }] };
  const selected = (mode) => within(screen.getByTestId(`pool-mode-${mode}`)).getAllByRole("checkbox").filter((box) => box.checked).length;

  test("lädt den Standard-Pool", () => {
    renderEditor({ entry: null, defaultPool: DEFAULT });
    expect(screen.getByTestId("pool-defaults")).toHaveTextContent("Vorgabe des Spiels");
    expect(screen.getByTestId("pool-defaults")).toHaveAttribute("title", "Lädt den Standard-Pool des Spiels");
    fireEvent.click(screen.getByTestId("pool-defaults"));
    expect(selected("snd")).toBe(1);
    expect(selected("stellung")).toBe(0);
  });

  test("ohne Standard-Pool wie bisher alle aktiven Maps", () => {
    renderEditor({ entry: null });
    expect(screen.getByTestId("pool-defaults")).toHaveAttribute("title", "Lädt alle aktiven Maps des Spiels");
    fireEvent.click(screen.getByTestId("pool-defaults"));
    expect(selected("snd")).toBe(2);
    expect(selected("stellung")).toBe(1);
  });

  test("ist nichts aus dem Standard-Pool mehr wählbar, gelten ebenfalls alle aktiven", () => {
    renderEditor({ entry: null, defaultPool: { ...DEFAULT, modes: [{ mode: "snd", label: "S", maps: [{ map_id: "weg", name: "Weg" }] }] } });
    fireEvent.click(screen.getByTestId("pool-defaults"));
    expect(selected("snd")).toBe(2);
  });

  test("die Bibliothek selbst nennt den Knopf anders und braucht keine Vorlage", () => {
    renderEditor({ entry: null, defaultsLabel: "Alle aktiven Maps" });
    expect(screen.getByTestId("pool-defaults")).toHaveTextContent("Alle aktiven Maps");
  });
});

test("ein Spiel ohne Modi kennt keinen Hinweis auf fehlende Modi", () => {
  renderEditor({ game: { ...GAME, modes: [] }, library: [{ id: "glut", name: "Glutsenke", modes: [] }], entry: null });
  expect(screen.queryByTestId("pool-without-mode")).toBeNull();
  expect(screen.queryByTestId("pool-old-groups")).toBeNull();
});

test("Reihenfolge ändern und speichern schickt die Auswahl mit der geladenen Version", async () => {
  const { onSave } = renderEditor();
  fireEvent.click(screen.getByRole("button", { name: "Hafenkante in Suchen & Zerstören nach oben" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Hafenkante in Stellung" }));
  fireEvent.click(screen.getByTestId("pool-save"));
  expect(onSave).toHaveBeenCalledWith({
    modes: [{ mode: "stellung", map_ids: ["hafen"] }, { mode: "snd", map_ids: ["hafen", "nebel"] }],
    expected_version: 3,
  });
});

test("Vorgabe des Spiels übernimmt alle freigegebenen Maps, Kopieren nimmt die Auswahl einer Quelle", () => {
  const source = { key: "turnier", label: "Pool des Turniers", pool: { modes: [{ mode: "stellung", maps: [{ map_id: "hafen" }] }] } };
  renderEditor({ entry: null, sources: [source] });
  expect(screen.getByTestId("pool-status")).toHaveTextContent("Noch kein Pool");
  fireEvent.click(screen.getByTestId("pool-defaults"));
  expect(screen.getByRole("checkbox", { name: "Nebelwerk in Suchen & Zerstören" })).toBeChecked();
  fireEvent.change(screen.getByTestId("pool-copy"), { target: { value: "turnier" } });
  expect(screen.getByRole("checkbox", { name: "Nebelwerk in Suchen & Zerstören" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Hafenkante in Stellung" })).toBeChecked();
  expect(screen.getByTestId("pool-save")).toBeEnabled();
});

test("ohne Spiel oder ohne Maps sagt der Editor, was fehlt", () => {
  const { unmount } = render(<MemoryRouter><MapPoolEditor title="Pool" game={null} library={[]} entry={null} onSave={vi.fn()} testId="pool" /></MemoryRouter>);
  expect(screen.getByTestId("pool-no-game")).toHaveTextContent("Ohne Spiel");
  unmount();
  render(<MemoryRouter><MapPoolEditor title="Pool" game={GAME} library={[]} entry={null} onSave={vi.fn()} testId="pool" libraryLink /></MemoryRouter>);
  expect(screen.getByTestId("pool-no-maps")).toHaveTextContent("noch keine aktiven Maps");
  expect(screen.getByRole("link", { name: /Maps anlegen/ })).toHaveAttribute("href", "/admin/games/g1/maps");
});

test("ein Pool eines anderen Spiels gilt nicht mehr und wird so angezeigt", () => {
  renderEditor({ entry: { ...ENTRY, stale: true } });
  expect(screen.getByTestId("pool-stale")).toHaveTextContent("anderen Spiel");
});
