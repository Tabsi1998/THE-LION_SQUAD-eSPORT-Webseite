import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Sperrliste der Season (#2218): sperren je Modus, an einer Waffe einzelne Aufsätze, Version mit expected_version, Hinweis aufs
// Regelwerk, Lesesicht ohne Schreibrecht. Nur erfundene Namen.
const apiMock = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler"), resolveMediaUrl: (url) => url || "" }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeasonLoadoutBansPanel } = await import("./SeasonLoadoutBansPanel");

const LIST = {
  id: "v2", version: 2, saved_at: "2026-11-01T10:00:00+00:00", stale: false, outdated_item_ids: ["w1"],
  entries: [
    { kind: "item", item_id: "w1", name: "Blitz 9", category: "waffen", category_label: "Waffen", role: "weapon", image_url: null, modes: [], mode_labels: [], attachments: [] },
    { kind: "item", item_id: "alt", name: "Altperk", category: "perks", category_label: "Perks", role: "item", image_url: null, modes: [], mode_labels: [], attachments: [] },
  ],
};
const BODY = {
  capabilities: ["season"],
  game: { id: "g1", name: "Probe Shooter", modes: [{ mode: "stellung", label: "Stellung", status: "active" }, { mode: "suchen", label: "Suchen", status: "active" }] },
  categories: [{ key: "waffen", label: "Waffen", role: "weapon" }, { key: "aufsaetze", label: "Aufsätze", role: "attachment" }, { key: "perks", label: "Perks", role: "item" }],
  library: [
    { id: "w1", category: "waffen", name: "Blitz 9", status: "active", weapon_ids: [] },
    { id: "w2", category: "waffen", name: "Donner 4", status: "active", weapon_ids: [] },
    { id: "a1", category: "aufsaetze", name: "Rotpunkt", status: "active", weapon_ids: ["w1"] },
    { id: "a2", category: "aufsaetze", name: "Griff", status: "active", weapon_ids: ["w1", "w2"] },
    { id: "a3", category: "aufsaetze", name: "Kompensator", status: "active", weapon_ids: [] },
    { id: "p1", category: "perks", name: "Leise Sohlen", status: "inactive", weapon_ids: [] },
  ],
  list: LIST,
  versions: [{ id: "v2", version: 2, entries: 2, cleared: false }, { id: "v1", version: 1, entries: 1, cleared: false }],
  rules: { uses_block: true, outdated: true, version: 3, admin_url: "/admin/leagues/rules/league_season/s1" },
  staffeln: 2,
};

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  for (const fn of Object.values(toastMock)) fn.mockReset();
  apiMock.get.mockResolvedValue({ data: BODY });
  apiMock.put.mockResolvedValue({ data: { version: 3, staffeln_to_sync: 2 } });
  apiMock.delete.mockResolvedValue({ data: { ok: true, staffeln_to_sync: 2 } });
});

function renderPanel(props = {}) {
  const onSaved = vi.fn();
  render(<MemoryRouter><SeasonLoadoutBansPanel seasonId="s1" canEdit onSaved={onSaved} {...props} /></MemoryRouter>);
  return onSaved;
}

test("Kopf, Hinweis aufs Regelwerk und was beim Speichern wegfällt", async () => {
  renderPanel();
  expect(await screen.findByTestId("season-bans-head")).toHaveTextContent("Version 2 · 2 Zeilen · 2 Staffeln bekommen Änderungen beim Übertragen.");
  const outdated = screen.getByTestId("season-bans-rules-outdated");
  expect(within(outdated).getByRole("link", { name: "Neue Version vorbereiten" })).toHaveAttribute("href", "/admin/leagues/rules/league_season/s1");
  expect(screen.getByTestId("season-bans-dropped")).toHaveTextContent("Altperk");
  expect(screen.getByTestId("season-bans-outdated")).toHaveTextContent("1 Eintrag");
  expect(screen.getByTestId("season-bans-library")).toHaveAttribute("href", "/admin/games/g1#ausruestung");
});

test("je Modus sperren, an einer Waffe einzelne Aufsätze, speichern als neue Version", async () => {
  const onSaved = renderPanel();
  const blitz = await screen.findByTestId("season-bans-item-w1");
  // Blitz 9 nur noch in „Suchen“ gesperrt.
  fireEvent.click(within(blitz).getByLabelText("Suchen"));
  // An Donner 4 passt Griff (zugeordnet), Rotpunkt nicht, Kompensator ohne Waffe zu keiner (Obmann, 03.11.).
  fireEvent.click(screen.getByTestId("season-bans-open-w2"));
  const donner = screen.getByTestId("season-bans-attachments-w2");
  expect(within(donner).queryByLabelText("Rotpunkt an Donner 4 sperren")).not.toBeInTheDocument();
  expect(within(donner).queryByLabelText("Kompensator an Donner 4 sperren")).not.toBeInTheDocument();
  fireEvent.click(within(donner).getByLabelText("Griff an Donner 4 sperren"));
  // Inaktiv und nicht auf der Liste: nicht neu sperrbar.
  expect(screen.getByTestId("season-bans-toggle-p1")).toBeDisabled();
  fireEvent.click(screen.getByTestId("season-bans-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/loadout-bans", {
    expected_version: 2,
    entries: [
      { item_id: "w1", kind: "item", modes: ["suchen"], attachment_ids: [] },
      { item_id: "w2", kind: "attachments", modes: [], attachment_ids: ["a2"] },
    ],
  }));
  expect(onSaved).toHaveBeenCalledWith(2);
});

test("eine Waffe in allen Modi gesperrt bietet keine einzelnen Aufsätze an; ganz entsperren geht", async () => {
  renderPanel();
  await screen.findByTestId("season-bans-item-w1");
  expect(screen.queryByTestId("season-bans-open-w1")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("season-bans-toggle-w1"));
  expect(screen.getByTestId("season-bans-open-w1")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("season-bans-save"));
  expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("mindestens einen Eintrag"));
  expect(apiMock.put).not.toHaveBeenCalled();
});

test("Suche und „nur gesperrte“ grenzen die Bibliothek ein; Entfernen fragt nach", async () => {
  const onSaved = renderPanel();
  fireEvent.change(await screen.findByTestId("season-bans-search"), { target: { value: "donner" } });
  expect(screen.queryByTestId("season-bans-item-w1")).not.toBeInTheDocument();
  fireEvent.change(screen.getByTestId("season-bans-search"), { target: { value: "" } });
  fireEvent.click(screen.getByTestId("season-bans-only-banned"));
  expect(screen.getByTestId("season-bans-item-w1")).toBeInTheDocument();
  expect(screen.queryByTestId("season-bans-item-w2")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("season-bans-clear"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/leagues/seasons/s1/loadout-bans"));
  expect(onSaved).toHaveBeenCalledWith(2);
});

test("ohne Schreibrecht nur die Liste; Versionen lassen sich vergleichen", async () => {
  apiMock.get.mockImplementation(async (url) => (url.endsWith("/compare")
    ? { data: { same: false, added: [{ kind: "item", item_id: "w1", name: "Blitz 9", modes: ["alle Modi"], attachments: [] }], removed: [], changed: [] } }
    : { data: BODY }));
  renderPanel({ canEdit: false });
  expect(await screen.findByTestId("season-bans-view")).toHaveTextContent("Blitz 9");
  expect(screen.queryByTestId("season-bans-save")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("season-bans-compare-run"));
  expect(await screen.findByTestId("season-bans-compare-result")).toHaveTextContent("Neu gesperrt: Blitz 9 · alle Modi");
  expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/seasons/s1/loadout-bans/compare", { params: { base: "1", target: "2" } });
});

test("ohne Liste und ohne Ausrüstung: sagt, wo es weitergeht", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, list: null, versions: [], library: [], rules: { uses_block: false } } });
  renderPanel();
  expect(await screen.findByTestId("season-bans-head")).toHaveTextContent("Noch keine – alles ist erlaubt.");
  expect(screen.getByTestId("season-bans-empty-library")).toHaveTextContent("Probe Shooter");
  expect(screen.getByTestId("season-bans-rules-none")).toBeInTheDocument();
});

// #2287: je Unterkategorie „Ganze Klasse sperren“, auch je Modus; Einträge der ganz gesperrten Klasse sind mitgesperrt.
const CLASSES = {
  ...BODY,
  categories: [
    { key: "waffen", label: "Waffen", role: "weapon", subcategories: [{ key: "schrot", label: "Schrotflinte", icon_url: null }, { key: "leer", label: "Raketenwerfer", icon_url: null }] },
    ...BODY.categories.slice(1).map((row) => ({ ...row, subcategories: [] })),
  ],
  library: [...BODY.library, { id: "s1", category: "waffen", subcategory: "schrot", name: "Hagel", status: "active", weapon_ids: [], weapon_class_ids: [] },
    { id: "a4", category: "aufsaetze", name: "Laser", status: "active", weapon_ids: [], weapon_class_ids: ["schrot"] }],
  list: { ...LIST, entries: [LIST.entries[0], { kind: "class", subcategory: "schrot", subcategory_label: "Schrotflinte", name: "Schrotflinte", category_label: "Waffen",
    modes: ["suchen"], mode_labels: ["Suchen"], items: [{ item_id: "s1", name: "Hagel" }], attachments: [] }], outdated_item_ids: [],
  class_new_items: [{ subcategory: "schrot", label: "Schrotflinte", names: ["Hagel"] }] },
};

test("ganze Klasse sperren: je Modus, in allen Modi mitgesperrt, leere Klasse angeboten", async () => {
  apiMock.get.mockResolvedValue({ data: CLASSES });
  renderPanel();
  const head = await screen.findByTestId("season-bans-class-schrot");
  expect(within(head).getByTestId("season-bans-class-schrot-toggle")).toBeChecked();
  expect(screen.getByTestId("season-bans-via-class-s1")).toHaveTextContent("Klasse gesperrt in Suchen");
  expect(screen.getByTestId("season-bans-class-new")).toHaveTextContent("Schrotflinte: Hagel");
  expect(screen.getByTestId("season-bans-class-leer")).toBeInTheDocument();
  expect(screen.getByTestId("season-bans-section-leer")).toHaveTextContent("gilt ab dem ersten");
  // Der Laser passt über die Klasse zu Hagel.
  fireEvent.click(screen.getByTestId("season-bans-open-s1"));
  expect(within(screen.getByTestId("season-bans-attachments-s1")).getByLabelText("Laser an Hagel sperren")).toBeInTheDocument();
  // In allen Modi: Hagel ist mitgesperrt und nicht mehr einzeln wählbar.
  fireEvent.click(within(head).getByLabelText("allen Modi"));
  expect(screen.getByTestId("season-bans-via-class-s1")).toHaveTextContent("Mit der ganzen Klasse gesperrt");
  expect(screen.getByTestId("season-bans-toggle-s1")).toBeDisabled();
  expect(screen.queryByTestId("season-bans-open-s1")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("season-bans-class-leer-toggle"));
  fireEvent.click(screen.getByTestId("season-bans-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/loadout-bans", {
    expected_version: 2,
    entries: [
      { kind: "class", subcategory: "schrot", modes: [], attachment_ids: [] },
      { kind: "class", subcategory: "leer", modes: [], attachment_ids: [] },
      { item_id: "w1", kind: "item", modes: [], attachment_ids: [] },
    ],
  }));
});

// #2299: an der Waffe nur die passenden Aufsätze je Slot, Modi je Aufsatz, „für die Klasse übernehmen“, „an allen Waffen sperren“.
const BY_SLOT = {
  ...BODY,
  categories: [
    { key: "waffen", label: "Waffen", role: "weapon", subcategories: [{ key: "sturm", label: "Sturmgewehr", icon_url: null }] },
    { key: "aufsaetze", label: "Aufsätze", role: "attachment", subcategories: [{ key: "optik", label: "Optik", icon_url: "/api/static/uploads/optik.png" }] },
  ],
  library: [
    { id: "w1", category: "waffen", subcategory: "sturm", name: "Blitz 9", status: "active", weapon_ids: [] },
    { id: "w2", category: "waffen", subcategory: "sturm", name: "Donner 4", status: "active", weapon_ids: [] },
    { id: "a1", category: "aufsaetze", subcategory: "optik", name: "Rotpunkt", status: "active", weapon_ids: [], weapon_class_ids: ["sturm"] },
    { id: "a2", category: "aufsaetze", name: "Griff", status: "active", weapon_ids: ["w1"], weapon_class_ids: [] },
    { id: "a3", category: "aufsaetze", subcategory: "optik", name: "Holo", status: "active", weapon_ids: [], weapon_class_ids: ["sturm"] },
  ],
  list: null,
  versions: [],
};

test("Aufsätze je Slot an der Waffe: je Aufsatz Modi, für die Klasse übernehmen, an allen Waffen sperren", async () => {
  apiMock.get.mockResolvedValue({ data: BY_SLOT });
  renderPanel();
  fireEvent.click(await screen.findByTestId("season-bans-open-w1"));
  const panel = screen.getByTestId("season-bans-attachments-w1");
  expect(within(panel).getAllByTestId("season-bans-slot-w1").map((slot) => slot.querySelector("p").textContent))
    .toEqual(["Ohne Unterkategorie", "Optik"]);
  fireEvent.click(within(panel).getByLabelText("Rotpunkt an Blitz 9 sperren"));
  fireEvent.click(within(screen.getByTestId("season-bans-attachment-w1-a1")).getByLabelText("Suchen"));
  fireEvent.click(within(panel).getByLabelText("Griff an Blitz 9 sperren"));
  expect(screen.getByTestId("season-bans-open-w1")).toHaveTextContent("3 Aufsätze · 2 gesperrt");

  fireEvent.click(screen.getByTestId("season-bans-copy-class-w1"));
  expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("Auf 1 weitere Waffe übernommen"));
  expect(screen.getByTestId("season-bans-open-w2")).toHaveTextContent("2 Aufsätze · 1 gesperrt");

  fireEvent.click(within(panel).getByLabelText("Holo an Blitz 9 sperren"));
  fireEvent.click(screen.getByTestId("season-bans-everywhere-w1-a3"));
  expect(within(screen.getByTestId("season-bans-attachment-w1-a3")).getByText("An allen Waffen gesperrt")).toBeInTheDocument();
  expect(screen.getByTestId("season-bans-attachment-toggle-w1-a3")).toBeDisabled();

  fireEvent.click(screen.getByTestId("season-bans-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/loadout-bans", {
    expected_version: 0,
    entries: [
      { item_id: "a3", kind: "item", modes: [], attachment_ids: [] },
      { item_id: "w1", kind: "attachments", modes: [], attachment_ids: ["a1", "a2"], attachment_modes: { a1: ["suchen"] } },
      { item_id: "w2", kind: "attachments", modes: ["suchen"], attachment_ids: ["a1"] },
    ],
  }));
});

test("Aufsätze ohne erlaubte Waffe werden genannt (Nr. 81)", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, unusable_attachments: [{ id: "a3", name: "Kompensator", reason: "keiner Waffe zugeordnet" },
    { id: "a1", name: "Rotpunkt", reason: "passt nur zu gesperrten Waffen" }] } });
  renderPanel();
  expect(await screen.findByTestId("season-bans-unusable")).toHaveTextContent("Kompensator (keiner Waffe zugeordnet), Rotpunkt (passt nur zu gesperrten Waffen)");
});